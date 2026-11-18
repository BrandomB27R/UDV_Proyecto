// Detalle de la asignación: la pantalla central, la misma para todos los perfiles.
// Diseño compacto (mockup vinci-entrega): encabezado con la línea de estados como tira,
// un solo bloque "Te toca a ti" con cada requisito y su control en línea, columna
// derecha (instrucciones, historial, comentarios) y barra de acción fija abajo con el
// único botón principal. Los requisitos y su lógica vienen de flujo.js.
import { api, ApiError, descargarArchivo } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, icono, mensaje } from "../dom.js";
import {
  chipEstado, chipPrioridad, etiquetaTipo, fechaCorta, fechaHora, plazo, tamano, aInstante, ZONA,
} from "../formato.js";
import {
  lineaDeEstados, capacidades, formaDeEntrega, pasoActual, archivosPorIntento, archivosDelIntentoActual, envios, fraseHistorial,
} from "../flujo.js";
import { requerirSesion, perfiles, puedeRevisar, tieneRol } from "../sesion.js";
import { sinAcceso } from "../componentes.js";
import { leerVersion, abrirVersionDeAsignacion } from "../programa/api-programa.js";
import { avanceDe } from "../programa/secciones.js";

const TERMINADAS = ["submitted", "under_review", "approved", "closed", "cancelled"];
const EXITO = {
  start: "Iniciaste la tarea. Ya puedes preparar tu entrega.",
  submit: "Entregada. Quien revisa recibirá un aviso.",
  resubmit: "Reentregada. Quien revisa recibirá un aviso.",
  review: "Tomaste la entrega. Ahora puedes aprobarla o devolverla.",
  return: "Devuelta al docente con tu observación.",
  approve: "Entrega aprobada.",
  close: "Tarea cerrada.",
};
const ESPERA_GUARDADO_MS = 1200;     // el mensaje se guarda solo, un momento después de dejar de escribir

const raiz = document.getElementById("contenido");
const zonaCabecera = document.getElementById("cabecera-tarea");
const zonaAccion = document.getElementById("barra-accion");
const id = new URLSearchParams(location.search).get("id");
const yo = await requerirSesion();

const st = {
  a: null,
  nombres: { docente: null, revisor: null, creador: null },
  texto: "",                 // mensaje para quien revisa (borrador local)
  motivo: "",                // observación del revisor
  aviso: null,               // {tipo, texto} tras una acción
  avisoArchivo: null,        // estado de la última subida
  ocupado: false,
  programa: null,            // {version, avance} de la versión ligada (tareas de programa)
  guardado: { estado: "guardado", en: null },   // guardado | pendiente | guardando | error
};

// ── Carga ────────────────────────────────────────────────────
function seccionDeOrigen() {
  const p = perfiles(yo.roles);
  return p.docente && !puedeRevisar(yo) ? "mis-tareas" : puedeRevisar(yo) ? "por-revisar" : "inicio";
}

async function cargar() {
  try {
    st.a = await api(`/assignments/${id}`);
  } catch (e) {
    pintarError(e instanceof ApiError && e.status === 404 ? "Esta tarea no existe o ya no está disponible."
      : e instanceof ApiError && e.status === 403 ? "No tienes acceso a esta tarea." : e.message);
    return;
  }
  // Si había texto escrito sin guardar en esta misma asignación (por ejemplo, se adjuntó un
  // archivo mientras se escribía), se conserva: recargar no debe borrar lo que el docente escribió.
  const sinGuardarTexto = st.previo?.id === st.a.id && (st.texto || "") !== (st.previo.draft || "");
  if (!sinGuardarTexto) st.texto = st.a.draft_comment || "";
  st.previo = { id: st.a.id, draft: st.a.draft_comment || "" };
  // Texto con que empezó este intento: en una reentrega es el del intento devuelto.
  if (st.textoInicialDe !== `${st.a.id}:${st.a.last_return?.at || ""}`) {
    st.textoInicialDe = `${st.a.id}:${st.a.last_return?.at || ""}`;
    st.textoInicial = st.texto;
  }
  st.motivo = "";
  st.guardado.estado = sinGuardarTexto ? "pendiente" : "guardado";
  st.nombres = { docente: st.a.assignee_name || null, revisor: st.a.reviewer_name || null, creador: st.a.created_by_name || null };
  // Tarea de programa con versión ligada: su avance (secciones listas) decide si se puede entregar.
  st.programa = null;
  if (formaDeEntrega(st.a).programa && st.a.program_version?.id) {
    try {
      const v = await leerVersion(st.a.program_version.id);
      st.programa = { version: v, avance: avanceDe(v) };
    } catch { /* sin acceso a la versión: se muestra solo su estado */ }
  }
  tituloPestana(st.a.title);
  pintar();
}

function pintarError(texto) {
  tituloPestana("Tarea");
  poner(zonaCabecera);
  zonaAccion.hidden = true;
  raiz.classList.add("v-main");
  return sinAcceso(raiz, "No se pudo abrir la tarea", texto);
}

// ── Página ───────────────────────────────────────────────────
function pintar() {
  const aviso = st.aviso;
  st.aviso = null;           // se muestra una sola vez
  poner(zonaCabecera, cabecera());
  poner(raiz,
    aviso ? mensaje(aviso.tipo, aviso.texto) : null,
    h("div", { class: "d-cols" },
      bloquePrincipal(),
      h("aside", { class: "d-lado", "aria-label": "Instrucciones, historial y comentarios" },
        instrucciones(), historial(), comentarios())));
  refrescar();
}

/** Quien revisa: el designado; sin designado, quien creó la tarea (o la coordinación). */
function quienRevisa() {
  const a = st.a;
  if (a.reviewer_name) return a.reviewer_name;
  if (a.reviewer_id == null && a.created_by_name) return a.created_by_name;
  return "la coordinación";
}

// ── Encabezado compacto ──────────────────────────────────────
function cabecera() {
  const a = st.a;
  const c = capacidades(a);
  const p = plazo(a.due_at, { terminada: TERMINADAS.includes(a.status) });
  const [volver, href] = c.esDestinatario ? ["Mis tareas", RUTAS.misTareas]
    : puedeRevisar(yo) ? ["Por revisar", RUTAS.porRevisar] : ["Inicio", RUTAS.inicio];
  const curso = a.course_code ? [a.course_code, a.period_code].filter(Boolean).join(" · ") : null;
  const fechaTxt = p.texto.replace(/ de \d{4}/, "");     // "15 de diciembre · faltan 28 días"
  const [fecha, resto] = fechaTxt.split(" · ");
  const meta = [
    h("span", {}, "Vence el ", h("strong", {}, fecha), resto ? ` · ${resto}` : ""),
    h("span", {}, "Revisa ", h("strong", {}, quienRevisa())),
    c.esDestinatario ? null : h("span", {}, "Docente ", h("strong", {}, st.nombres.docente || "—")),
    curso ? h("span", {}, curso) : null,
  ].filter(Boolean);
  return h("div", { class: "d-cab" }, h("div", { class: "d-cab__in" },
    h("div", { class: "d-cab__fila" },
      h("div", { class: "d-cab__titulo" },
        h("a", { class: "d-volver", href }, `← ${volver}`),
        h("h1", { class: "d-cab__h1" }, a.title),
        h("span", { class: "d-etiqueta" }, etiquetaTipo(a.task_type)),
        chipPrioridad(a.priority),
        a.status === "cancelled" ? chipEstado(a.status) : null),
      h("p", { class: `d-cab__meta${p.estado ? ` d-cab__meta--${p.estado}` : ""}` },
        meta.flatMap((m, i) => (i ? [h("span", { class: "d-sep", "aria-hidden": "true" }, "·"), m] : [m])))),
    tira(),
    a.task_id != null && tieneRol(yo, "coordinator")
      ? h("a", { class: "d-cab__enlace", href: `/app/tarea.html?id=${encodeURIComponent(a.task_id)}` }, "Ver la tarea y el avance de todos los docentes")
      : null));
}

/** La línea de estados como tira delgada: barra de 4 px y etiqueta pequeña. */
function tira() {
  const pasos = lineaDeEstados(st.a);
  if (!pasos) return h("p", { class: "d-tira__cancelada" }, "Esta tarea fue cancelada por la coordinación.");
  return h("ol", { class: "d-tira", "aria-label": "Paso del flujo" }, pasos.map((p) => h("li", {
    class: `d-tira__paso${p.marca ? ` d-tira__paso--${p.marca}` : ""}`,
    "aria-current": p.marca === "actual" || p.marca === "desvio" ? "step" : null,
    title: p.dato || null,
  },
  h("span", { class: "d-tira__barra" }),
  h("span", { class: "d-tira__nombre" },
    p.marca === "hecho" ? [icono("check", 12, 3.5), h("span", { class: "v-sr" }, "Hecho: ")] : null,
    p.etiqueta,
    p.marca === "actual" ? h("span", { class: "d-tira__nota" }, " · paso actual") : null,
    p.marca === "desvio" ? h("span", { class: "d-tira__nota" }, " · corrige y reentrega") : null))));
}

// ── "Te toca a ti": un solo bloque ───────────────────────────
function claveLeida() {
  return `vinci_leida_${st.a.id}_${st.a.last_return?.at || ""}`;
}
function leyoDevolucion() {
  try { return sessionStorage.getItem(claveLeida()) === "1"; } catch { return false; }
}
function marcarLeida() {
  try { sessionStorage.setItem(claveLeida(), "1"); } catch { /* sin almacenamiento */ }
  st.leidaLocal = true;
}

function ctxPaso() {
  return {
    texto: st.texto,
    textoCambiado: (st.texto || "").trim() !== (st.textoInicial || "").trim(),
    motivo: st.motivo,
    leyoDevolucion: st.leidaLocal || leyoDevolucion(),
    nombres: st.nombres,
    programa: st.programa,
  };
}

const filas = new Map();          // id de requisito -> {marca, estado, detalle}
let encabezadoBloque = null;      // {eyebrow, titulo, resumen}

function bloquePrincipal() {
  const p = pasoActual(st.a, yo, ctxPaso());
  filas.clear();
  const eyebrow = h("p", { class: "v-eyebrow" }, p.eyebrow);
  const titulo = h("h2", { id: "t-paso", class: "d-bloque__h2" }, p.titulo);
  const resumen = h("p", { class: "d-bloque__resumen" }, p.resumen || "");
  resumen.hidden = !p.resumen;
  encabezadoBloque = { eyebrow, titulo, resumen };

  const c = capacidades(st.a);
  const cuerpo = [];
  if (p.requisitos.length) {
    // Primero los obligatorios, después los opcionales (orden estable; la lógica es de flujo.js).
    const peso = (r) => (r.obligatorio || r.estado === "pendiente" ? 0 : 1);
    const enOrden = p.requisitos.map((r, i) => [r, i]).sort((x, y) => peso(x[0]) - peso(y[0]) || x[1] - y[1]).map((x) => x[0]);
    cuerpo.push(h("ul", { class: "v-req d-req" }, enOrden.map(filaRequisito)));
  } else {
    // No le toca a quien mira: la misma estructura, con la entrega a la vista.
    if (st.a.status === "returned") cuerpo.push(observacion());
    cuerpo.push(entregaLectura(c.esDestinatario ? "Tu entrega" : "La entrega"));
  }
  const anterior = devolucionAnterior(p);
  return h("section", { class: `d-bloque ${p.turno === "tuyo" ? "d-bloque--tuyo" : "d-bloque--espera"}`, "aria-labelledby": "t-paso" },
    h("div", { class: "d-bloque__cab" }, eyebrow, titulo),
    resumen,
    cuerpo,
    intentosAnteriores(p),
    anterior);
}

/** Cada requisito con su control en línea. Los textos vienen de flujo.js. */
function filaRequisito(r) {
  const marca = h("span", { class: `v-req__marca v-req__marca--${r.estado}`, "aria-hidden": "true" });
  const estado = h("span", { class: "v-req__estado" });
  const detalle = h("span", { class: "v-req__detalle" });
  filas.set(r.id, { marca, estado, detalle });
  pintarMarca({ marca, estado, detalle }, r);

  let control = null;
  let enLinea = false;      // el control reemplaza el detalle (que en flujo.js dice "abajo")
  if (r.id === "leer") { control = [observacion(), botonLeida()]; enLinea = true; }
  if (r.id === "texto") { control = campoMensaje(); enLinea = true; }
  if (r.id === "archivo") { control = adjuntos(); enLinea = true; }
  if (r.id === "programa") control = controlPrograma(r);
  if (r.id === "tomar" || r.id === "revisar") { control = entregaLectura(null); enLinea = r.id === "revisar"; }
  if (r.id === "motivo") control = campoMotivo();
  if (enLinea) detalle.hidden = true;

  return h("li", { class: `d-req__fila d-req__fila--${r.id}` },
    marca,
    h("div", { class: "v-req__cuerpo" },
      h("span", { class: "v-req__titulo" }, r.titulo, " ", estado),
      detalle,
      control));
}

function pintarMarca(f, r) {
  f.marca.className = `v-req__marca v-req__marca--${r.estado}`;
  poner(f.marca, r.estado === "hecho" ? icono("check", 14, 3.5) : null);
  f.estado.className = `v-req__estado${r.estado === "pendiente" ? " v-req__estado--pendiente" : r.estado === "hecho" ? " v-req__estado--hecho" : ""}`;
  const txt = r.estado === "hecho" ? (r.nota ? `${r.nota}, listo` : "listo") : r.estado === "pendiente" ? (r.nota || "pendiente") : (r.nota || "opcional");
  f.estado.textContent = `· ${txt}`;
  if (!f.detalle.hidden) f.detalle.textContent = r.detalle || "";
}

/** Recalcula lo que depende de lo escrito (marcas, encabezado del bloque y barra) sin repintar los controles. */
function refrescar() {
  const p = pasoActual(st.a, yo, ctxPaso());
  const ids = p.requisitos.map((r) => r.id);
  if (ids.length !== filas.size || ids.some((x) => !filas.has(x))) { pintar(); return; }
  for (const r of p.requisitos) pintarMarca(filas.get(r.id), r);
  if (encabezadoBloque) {
    encabezadoBloque.titulo.textContent = p.titulo;
    encabezadoBloque.resumen.textContent = p.resumen || "";
    encabezadoBloque.resumen.hidden = !p.resumen;
  }
  pintarBarra(p);
}

// ── Controles en línea ───────────────────────────────────────
function observacion() {
  const r = st.a.last_return;
  if (!r) return null;
  return h("div", { class: "v-devolucion d-observacion", role: "note" },
    h("p", { class: "d-observacion__titulo" }, "Observación del revisor"),
    h("p", { class: "v-texto" }, r.comment || "Sin comentario."),
    h("p", { class: "v-nota" }, [r.actor, fechaCorta(r.at)].filter(Boolean).join(" · ")));
}

function botonLeida() {
  if (st.leidaLocal || leyoDevolucion()) return null;
  const b = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { marcarLeida(); b.remove(); refrescar(); } }, "Ya la leí");
  return h("div", { class: "v-acciones" }, b);
}

// Mensaje para quien revisa: se guarda solo (al dejar de escribir y al salir del campo).
let temporizador = null;
let indicador = null;
const hora = (d) => d.toLocaleTimeString("es-GT", { timeZone: ZONA, hour: "numeric", minute: "2-digit" });

function pintarIndicador() {
  if (!indicador) return;
  const g = st.guardado;
  indicador.className = `d-guardado d-guardado--${g.estado}`;
  indicador.textContent = g.estado === "guardando" ? "Guardando…"
    : g.estado === "pendiente" ? "Sin guardar"
      : g.estado === "error" ? "No se pudo guardar"
        : g.en ? `Guardado ${hora(g.en)}` : (st.texto ? "Guardado" : "");
}

async function guardarTexto() {
  clearTimeout(temporizador);
  const a = st.a;
  if (!capacidades(a).editarEntrega) return;
  if ((st.texto || "") === (a.draft_comment || "")) {
    if (st.guardado.estado === "pendiente") { st.guardado.estado = "guardado"; pintarIndicador(); }
    return;
  }
  const valor = st.texto;
  st.guardado.estado = "guardando";
  pintarIndicador();
  try {
    await api(`/assignments/${a.id}/submission-draft`, { method: "PUT", body: { comment: valor } });
    a.draft_comment = valor;
    if (st.previo) st.previo.draft = valor;
    st.guardado = { estado: st.texto === valor ? "guardado" : "pendiente", en: new Date() };
  } catch {
    st.guardado.estado = "error";
  }
  pintarIndicador();
  refrescar();
}

function campoMensaje() {
  const forma = formaDeEntrega(st.a);
  indicador = h("span", { class: "d-guardado", role: "status" });
  const ta = h("textarea", {
    id: "texto-entrega", rows: 3, maxlength: 5000, value: st.texto, "aria-describedby": "ayuda-texto",
    "aria-label": forma.textoObligatorio ? "Escribe tu entrega" : "Mensaje para quien revisa",
    placeholder: forma.textoObligatorio ? "Escribe aquí tu respuesta." : "Por ejemplo: agregué el diplomado de este año y las dos publicaciones nuevas.",
    oninput: (e) => {
      st.texto = e.target.value;
      st.guardado.estado = "pendiente";
      pintarIndicador();
      clearTimeout(temporizador);
      temporizador = setTimeout(guardarTexto, ESPERA_GUARDADO_MS);
      refrescar();
    },
    onblur: () => guardarTexto(),
  });
  pintarIndicador();
  return h("div", { class: "d-mensaje" },
    h("div", { class: "d-mensaje__cab" }, indicador),
    ta,
    h("span", { id: "ayuda-texto", class: "v-campo__ayuda" }, "Se guarda solo mientras escribes. Puedes corregirlo hasta que entregues."));
}

// Archivos: se suben y se vinculan al elegirlos o arrastrarlos.
const extensionDe = (nombre) => (/\.([a-z0-9]{1,8})$/i.exec(nombre || "")?.[1] || "").toLowerCase();
const sinExtension = (n) => String(n || "Archivo").replace(/\.[a-z0-9]{1,8}$/i, "");
function nombreDeArchivo(descripcion, ext) {
  const limpio = descripcion.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${limpio || "archivo"}.${ext || "pdf"}`;
}

function adjuntos() {
  const a = st.a;
  const forma = formaDeEntrega(a);
  const exts = forma.extensiones.length ? forma.extensiones : ["pdf"];
  const lista = [...new Set(exts.map((e) => (e === "jpeg" ? "jpg" : e).toUpperCase()))];
  const listaTxt = lista.length === 1 ? `Solo ${lista[0]}` : `${lista.join(", ")}`;
  const actuales = archivosDelIntentoActual(a);
  const estado = h("div", { "aria-live": "polite" },
    st.avisoArchivo ? mensaje(st.avisoArchivo.tipo, st.avisoArchivo.texto) : null);
  st.avisoArchivo = null;

  const input = h("input", { id: "archivo", type: "file", class: "v-sr", accept: exts.map((e) => `.${e}`).join(","), tabindex: "-1",
    onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) subir(f); } });
  const desc = h("input", { id: "desc-archivo", type: "text", maxlength: 120, autocomplete: "off", class: "d-zona__desc",
    "aria-label": "Descripción del archivo (opcional)", placeholder: "Para qué es (opcional): Rúbrica de la unidad 2" });
  const elegir = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => input.click() },
    actuales.length ? "Elegir otro archivo" : "Elegir archivo");
  const zona = h("div", { class: "d-zona" },
    h("div", { class: "d-zona__fila" }, elegir, desc),
    h("span", { class: "d-zona__ayuda" },
      `o arrástralo aquí. Se sube al elegirlo. ${listaTxt}, máximo ${forma.maxMb} MB.`,
      forma.noAceptadas.length ? ` Por ahora no se aceptan: ${forma.noAceptadas.map((x) => x.toUpperCase()).join(", ")}.` : ""),
    input);

  for (const ev of ["dragenter", "dragover"]) zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add("d-zona--encima"); });
  for (const ev of ["dragleave", "drop"]) zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove("d-zona--encima"); });
  zona.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) subir(f); });

  async function subir(f) {
    const ext = extensionDe(f.name);
    if (!exts.includes(ext)) { poner(estado, mensaje("error", `Ese tipo de archivo no se acepta aquí. ${listaTxt}.`)); return; }
    if (f.size > forma.maxMb * 1024 * 1024) { poner(estado, mensaje("error", `El archivo supera el límite de ${forma.maxMb} MB.`)); return; }
    // La descripción va como nombre del archivo (la API todavía no guarda una aparte; NOTAS_BACKEND.md).
    const descripcion = desc.value.trim() || sinExtension(f.name);
    elegir.disabled = true;
    zona.classList.add("d-zona--subiendo");
    poner(estado, h("p", { class: "v-msg v-msg--info", role: "status" }, `Subiendo «${descripcion}»…`));
    try {
      const fd = new FormData();
      fd.append("file", f, nombreDeArchivo(descripcion, ext));
      const subido = await api("/files", { method: "POST", form: fd });
      await api(`/assignments/${a.id}/files`, { method: "POST", body: { file_id: String(subido.file_id), name: descripcion } });
      st.avisoArchivo = { tipo: "ok", texto: `Archivo adjunto: ${descripcion}.` };
      await cargar();
    } catch (err) {
      poner(estado, mensaje("error", `No se pudo adjuntar «${descripcion}»: ${err.message}`));
      elegir.disabled = false;
      zona.classList.remove("d-zona--subiendo");
    }
  }

  return h("div", { class: "d-adjuntos" },
    actuales.length ? h("ul", { class: "d-archivos" }, actuales.map((f) => filaArchivo(f, true))) : null,
    zona, estado);
}

function filaArchivo(f, actual = false) {
  const zona = h("span", { class: "d-archivo__error", role: "status" });
  const ext = extensionDe(f.name);
  const subido = aInstante(f.uploaded_at);
  return h("li", { class: `d-archivo${actual ? " d-archivo--actual" : ""}` },
    h("span", { class: `d-archivo__tipo d-archivo__tipo--${ext || "otro"}`, "aria-hidden": "true" }, (ext || "?").toUpperCase()),
    h("div", { class: "d-archivo__info" },
      h("span", { class: "d-archivo__nombre" }, sinExtension(f.name)),
      h("span", { class: "d-archivo__dato", title: fechaHora(f.uploaded_at) },
        [tamano(f.size), subido ? `subido ${actual ? "a las" : "el"} ${actual ? hora(subido) : fechaCorta(f.uploaded_at)}` : null].filter(Boolean).join(" · ")),
      zona),
    h("button", { type: "button", class: "d-enlace", onclick: async (e) => {
      e.target.disabled = true;
      zona.textContent = "";
      try { await descargarArchivo(f.file_id, f.name); } catch (err) { zona.textContent = err.message; }
      e.target.disabled = false;
    } }, "Descargar"));
}

const ESTADOS_PROGRAMA = { draft: "borrador", submitted: "enviada", under_review: "en revisión", returned: "devuelta", approved: "aprobada", authorized: "autorizada", superseded: "reemplazada" };

function controlPrograma(r) {
  const pv = st.a.program_version;
  const barra = r.avance != null
    ? h("div", { class: "v-req__avance", role: "img", "aria-label": r.detalle }, h("span", { style: `width: ${Math.round(r.avance * 100)}%` }))
    : null;
  if (pv?.id) {
    return h("div", { class: "d-control" }, barra,
      h("div", { class: "v-acciones" }, h("a", { class: "v-btn v-btn--sec v-btn--chico", href: RUTAS.programa(pv.id, st.a.id) },
        r.estado === "hecho" ? "Ver el programa" : "Continuar el programa")));
  }
  const zona = h("span", { class: "v-req__detalle", role: "status" });
  const boton = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: async () => {
    boton.disabled = true; boton.textContent = "Abriendo…"; zona.textContent = "";
    try {
      const v = await abrirVersionDeAsignacion(st.a.id);
      location.assign(RUTAS.programa(v.id, st.a.id));
    } catch (e) {
      // 422: la tarea no tiene curso y período; 409: no hay versión de la cual partir.
      zona.textContent = e.message;
      boton.disabled = false; boton.textContent = "Completar el programa";
    }
  } }, "Completar el programa");
  return h("div", { class: "d-control" }, h("div", { class: "v-acciones" }, boton), zona);
}

function campoMotivo() {
  const ta = h("textarea", {
    id: "motivo", rows: 3, maxlength: 2000, value: st.motivo, "aria-label": "Observación para el docente",
    placeholder: "Por ejemplo: falta la bibliografía actualizada de la unidad 3.",
    oninput: (e) => { st.motivo = e.target.value; e.target.removeAttribute("aria-invalid"); refrescar(); },
  });
  return h("div", { class: "d-mensaje" }, ta,
    h("span", { class: "v-campo__ayuda" }, "Obligatoria para devolver. Al aprobar es opcional y queda en el historial."));
}

/** La entrega enviada: el texto y los archivos del último intento, y el programa si aplica. */
function entregaLectura(titulo) {
  const a = st.a;
  const forma = formaDeEntrega(a);
  const n = envios(a);
  const intento = (a.attempts || []).find((x) => Number(x.number) === n);
  const archivos = archivosPorIntento(a).find((g) => g.intento === n)?.archivos || [];
  const pv = a.program_version;
  if (!n && !pv) return titulo ? h("p", { class: "v-nota" }, "Todavía no hay entrega.") : null;
  return h("div", { class: "d-entrega" },
    titulo ? h("p", { class: "d-entrega__titulo" }, titulo) : null,
    n ? h("div", { class: "v-intento" },
      h("p", { class: "v-intento__titulo" }, `Intento ${n}${intento?.created_at ? ` · ${fechaCorta(intento.created_at)}` : ""}`),
      h("p", { class: "v-texto" }, intento?.text || "Sin mensaje."),
      archivos.length ? h("ul", { class: "d-archivos" }, archivos.map((f) => filaArchivo(f))) : (forma.archivos ? h("p", { class: "v-nota" }, "Sin archivos.") : null)) : null,
    forma.programa && pv?.id ? h("div", { class: "d-programa" },
      h("span", {}, `Programa del curso · versión ${pv.number} (${ESTADOS_PROGRAMA[pv.status] || pv.status})`),
      h("a", { class: "v-btn v-btn--sec v-btn--chico", href: RUTAS.programa(pv.id, a.id) }, "Ver el programa")) : null);
}

/** Intentos ya enviados antes del actual, plegados al final del bloque. */
function intentosAnteriores(p) {
  const a = st.a;
  const n = envios(a);
  // Quien está entregando no tiene "último enviado" en pantalla; los demás ya ven el último arriba.
  const preparando = p.requisitos.some((r) => r.id === "texto" || r.id === "archivo");
  const hasta = preparando ? n : n - 1;
  if (hasta < 1) return null;
  const textos = new Map((a.attempts || []).map((x) => [Number(x.number), x]));
  const archivos = new Map(archivosPorIntento(a).map((g) => [g.intento, g.archivos]));
  const nums = [];
  for (let i = hasta; i >= 1; i--) nums.push(i);
  return h("details", { class: "d-plegable" },
    h("summary", {}, preparando ? `Intentos enviados (${nums.length})` : `Intentos anteriores (${nums.length})`),
    nums.map((num) => h("div", { class: "v-intento" },
      h("p", { class: "v-intento__titulo" }, `Intento ${num}${textos.get(num)?.created_at ? ` · ${fechaCorta(textos.get(num).created_at)}` : ""}`),
      h("p", { class: "v-texto" }, textos.get(num)?.text || "Sin mensaje."),
      (archivos.get(num) || []).length ? h("ul", { class: "d-archivos" }, archivos.get(num).map((f) => filaArchivo(f))) : null)));
}

/** Devolución de un intento anterior: plegada al final del bloque. */
function devolucionAnterior(p) {
  const r = st.a.last_return;
  if (!r || st.a.status === "returned") return null;
  return h("details", { class: "d-plegable" },
    h("summary", {}, "Última devolución"),
    h("p", { class: "v-texto" }, r.comment || "Sin comentario."),
    h("p", { class: "v-nota" }, [r.actor, fechaCorta(r.at)].filter(Boolean).join(" · ")));
}

// ── Barra de acción fija ─────────────────────────────────────
const FALTA = {
  leer: () => "marcar la observación como leída",
  programa: () => "completar el programa",
  texto: () => "escribir tu entrega",
  motivo: () => "escribir la observación",
  archivo: () => (st.a.status === "returned" ? "adjuntar un archivo nuevo" : "adjuntar el archivo"),
};
const LISTO = {
  start: "Lista para empezar", submit: "Todo listo para entregar", resubmit: "Todo listo para reentregar",
  review: "La entrega espera tu revisión", approve: "Decide sobre la entrega", return: "Devuelve la entrega con tu observación",
  close: "Lista para cerrar",
};

function resumenEntrega() {
  const a = st.a;
  const forma = formaDeEntrega(a);
  const partes = [];
  if (forma.programa && st.programa) partes.push(`programa ${st.programa.avance.listas === st.programa.avance.total ? "completo" : "incompleto"}`);
  if (forma.archivos) {
    const n = archivosDelIntentoActual(a).length;
    partes.push(n ? `${n} ${n === 1 ? "archivo adjunto" : "archivos adjuntos"}` : "sin archivos");
  }
  partes.push(!st.texto.trim() ? "sin mensaje" : st.guardado.estado === "guardado" ? "mensaje guardado" : "mensaje sin guardar");
  return partes.join(" · ");
}

function detalleListo(accion) {
  const destino = quienRevisa();
  switch (accion) {
    case "start": return "Al iniciarla pasa a «En curso» y puedes preparar tu entrega aquí mismo.";
    case "submit":
    case "resubmit": return `${capital(resumenEntrega())}. Al entregar pasa a revisión de ${destino}.`;
    case "review": return "Al tomarla pasa a «En revisión»; el docente lo verá.";
    case "approve": return st.motivo.trim() ? "Tu observación quedará en el historial." : "Si falta algo, escribe la observación y devuélvela.";
    case "return": return "El docente la verá como observación.";
    case "close": return "Al cerrarla queda terminada con su historial completo.";
    default: return "";
  }
}
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

let zonaErrorAccion = null;
function pintarBarra(p) {
  if (!p.principal) { zonaAccion.hidden = true; document.body.classList.remove("d-con-accion"); return; }
  zonaAccion.hidden = false;
  document.body.classList.add("d-con-accion");
  const b = p.principal;
  const faltan = p.requisitos.filter((r) => r.estado === "pendiente" && FALTA[r.id] && !(b.accion === "approve" && r.id === "motivo"));
  const titulo = b.habilitada ? LISTO[b.accion] || "Listo"
    : `Falta ${faltan.map((r) => FALTA[r.id]()).join(" y ") || "completar los requisitos"}`;
  const detalle = b.habilitada ? detalleListo(b.accion)
    : ["submit", "resubmit"].includes(b.accion) ? `${capital(resumenEntrega())}. Al entregar pasa a revisión de ${quienRevisa()}.`
      : b.motivo || "";
  const boton = (x, clase) => h("button", {
    type: "button", class: clase, disabled: !x.habilitada || st.ocupado,
    title: !x.habilitada && x.motivo ? x.motivo : null,
    onclick: () => ejecutar(x.accion),
  }, x.etiqueta);
  zonaErrorAccion = zonaErrorAccion || h("div", { class: "d-accion__error", "aria-live": "assertive" });
  poner(zonaAccion, h("div", { class: "d-accion__in" },
    zonaErrorAccion,
    h("div", { class: "d-accion__fila" },
      h("div", { class: "d-accion__texto" },
        h("span", { class: `d-accion__titulo${b.habilitada ? "" : " d-accion__titulo--falta"}` }, titulo),
        detalle ? h("span", { class: "d-accion__detalle" }, detalle) : null),
      h("div", { class: "d-accion__botones" },
        p.secundaria ? boton(p.secundaria, "v-btn v-btn--sec v-btn--peligro") : null,
        boton(b, "v-btn d-accion__principal")))));
}

async function ejecutar(accion) {
  if (st.ocupado) return;
  st.ocupado = true;
  refrescar();
  poner(zonaErrorAccion);
  try {
    if (accion === "submit" || accion === "resubmit") await guardarTexto();
    if ((accion === "submit" || accion === "resubmit") && st.guardado.estado === "error") throw new Error("No se pudo guardar tu mensaje. Revisa tu conexión e intenta de nuevo.");
    const body = ["return", "approve"].includes(accion) && st.motivo.trim() ? { comment: st.motivo.trim() } : {};
    await api(`/assignments/${st.a.id}/${accion}`, { method: "POST", body });
    st.aviso = { tipo: "ok", texto: EXITO[accion] || "Listo." };
    st.ocupado = false;
    zonaErrorAccion = null;
    await cargar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    st.ocupado = false;
    let texto = e.message;
    if (e instanceof ApiError && e.status === 422 && e.campo === "file") texto = "Este tipo de tarea exige un archivo en este intento. Adjúntalo y vuelve a intentarlo.";
    if (e instanceof ApiError && e.status === 422 && e.campo === "comment") {
      texto = "Para devolver la entrega escribe la observación.";
      document.getElementById("motivo")?.setAttribute("aria-invalid", "true");
    }
    if (e instanceof ApiError && e.status === 409) texto = `${e.message} Recarga para ver el estado actual.`;
    refrescar();
    poner(zonaErrorAccion, mensaje("error", texto),
      e instanceof ApiError && e.status === 409 ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { st.aviso = null; zonaErrorAccion = null; cargar(); } }, "Recargar") : null);
  }
}

// Aviso al salir con el mensaje sin guardar (y se intenta guardar).
window.addEventListener("beforeunload", (e) => {
  if (st.a && capacidades(st.a).editarEntrega && (st.texto || "") !== (st.a.draft_comment || "")) {
    guardarTexto();
    e.preventDefault();
    e.returnValue = "";
  }
});

// ── Columna derecha ──────────────────────────────────────────
function instrucciones() {
  return h("section", { class: "d-tarjeta", "aria-labelledby": "t-inst" },
    h("h2", { id: "t-inst", class: "d-tarjeta__h2" }, "Instrucciones"),
    h("p", { class: "d-tarjeta__texto" }, st.a.instructions || "Esta tarea no trae instrucciones adicionales."),
    st.a.created_by_name ? h("p", { class: "v-nota" }, `Asignada por ${st.a.created_by_name}.`) : null);
}

function historial() {
  const items = [...(st.a.history || [])].reverse();
  return h("section", { class: "d-tarjeta", "aria-labelledby": "t-hist" },
    h("h2", { id: "t-hist", class: "d-tarjeta__h2" }, "Historial"),
    items.length
      ? h("ol", { class: "v-hist d-hist" }, items.map((x) => h("li", {},
        h("span", { class: "v-hist__que" }, fraseHistorial(x)),
        x.comment && x.new_status !== "assigned" ? h("span", { class: "v-hist__nota" }, `«${x.comment}»`) : null,
        h("span", { class: "v-hist__cuando", title: fechaHora(x.at) }, fechaCorta(x.at)))))
      : h("p", { class: "v-nota" }, "Sin movimientos todavía."));
}

function comentarios() {
  const a = st.a;
  const c = capacidades(a);
  const lista = a.comments || [];
  const zona = h("div", { "aria-live": "polite" });
  let abrir = null;
  let form = null;
  if (c.comentar && a.status !== "cancelled") {
    const ta = h("textarea", { id: "comentario", rows: 3, maxlength: 5000, "aria-label": "Nuevo comentario", placeholder: "Una pregunta o aclaración. No cambia el estado de la tarea." });
    const btn = h("button", { type: "submit", class: "v-btn v-btn--sec v-btn--chico" }, "Comentar");
    form = h("form", { class: "d-comentar", hidden: true }, ta, h("div", { class: "v-acciones" }, btn));
    abrir = h("button", { type: "button", class: "d-enlace", "aria-expanded": "false", onclick: () => {
      form.hidden = false; abrir.hidden = true; ta.focus();
    } }, "Escribir un comentario");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const texto = ta.value.trim();
      if (!texto) { poner(zona, mensaje("error", "Escribe el comentario.")); ta.focus(); return; }
      btn.disabled = true;
      try {
        await api(`/assignments/${a.id}/comments`, { method: "POST", body: { text: texto } });
        st.aviso = { tipo: "ok", texto: "Comentario publicado." };
        await cargar();
      } catch (err) { poner(zona, mensaje("error", err.message)); btn.disabled = false; }
    });
  }
  return h("section", { class: "d-tarjeta", "aria-labelledby": "t-com" },
    h("h2", { id: "t-com", class: "d-tarjeta__h2" }, "Comentarios"),
    lista.length
      ? h("ul", { class: "v-comentarios" }, lista.map((x) => h("li", { class: "v-comentario" },
        h("div", { class: "v-comentario__cab" },
          h("strong", {}, Number(x.author_id ?? x.author) === yo.id ? "Tú" : x.author_name || "Usuario"),
          x.created_at ? h("span", { class: "v-comentario__fecha", title: fechaHora(x.created_at) }, fechaCorta(x.created_at)) : null),
        h("p", {}, x.text))))
      : h("p", { class: "v-nota" }, "Sin comentarios todavía."),
    abrir, form, zona);
}

// ── Arranque ─────────────────────────────────────────────────
montarBarra(yo, seccionDeOrigen());
if (!id || !/^\d+$/.test(id)) {
  pintarError("Falta indicar qué tarea abrir.");
} else {
  await cargar();
}
