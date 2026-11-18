// Detalle de la asignación: la pantalla central, la misma para todos los perfiles.
import { api, ApiError, descargarArchivo } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, icono, mensaje } from "../dom.js";
import {
  chipEstado, chipPrioridad, etiquetaTipo, etiquetaEstado, fechaCorta, fechaHora, plazo, tamano,
} from "../formato.js";
import {
  LINEA, lineaDeEstados, capacidades, formaDeEntrega, pasoActual, archivosPorIntento, archivosDelIntentoActual, envios, fraseHistorial,
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

const raiz = document.getElementById("contenido");
const id = new URLSearchParams(location.search).get("id");
const yo = await requerirSesion();

const st = {
  a: null,
  nombres: { docente: null, revisor: null, creador: null },
  texto: "",                 // texto de la entrega (borrador local)
  motivo: "",                // observación del revisor
  aviso: null,               // {tipo, texto} tras una acción
  ocupado: false,
  programa: null,            // {version, avance} de la versión ligada (tareas de programa)
};

// (El arranque está al final del archivo: las constantes de más abajo deben existir antes.)

// ─────────────────────────────────────────────────────────────

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
  st.texto = st.a.draft_comment || "";
  // Texto con que empezó este intento: en una reentrega es el del intento devuelto.
  if (st.textoInicialDe !== `${st.a.id}:${st.a.last_return?.at || ""}`) {
    st.textoInicialDe = `${st.a.id}:${st.a.last_return?.at || ""}`;
    st.textoInicial = st.texto;
  }
  st.motivo = "";
  // Los nombres vienen en el detalle (assignee_name, reviewer_name, created_by_name).
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
  return sinAcceso(raiz, "No se pudo abrir la tarea", texto);
}

// ── Página completa ──────────────────────────────────────────
function pintar() {
  const a = st.a;
  const c = capacidades(a);
  const aviso = st.aviso;
  st.aviso = null;           // se muestra una sola vez
  poner(raiz,
    rutaDeMigas(c),
    aviso ? mensaje(aviso.tipo, aviso.texto) : null,
    cabecera(c),
    linea(),
    h("div", { class: "v-cols" },
      h("div", { class: "v-cols__main" },
        tarjetaPaso(),
        instrucciones(),
        entrega(c),
        comentarios(c),
        devolucionAnterior()),
      h("aside", { class: "v-cols__lado" }, historial())));
}

function rutaDeMigas(c) {
  const p = perfiles(yo.roles);
  const [texto, href] = c.esDestinatario ? ["Mis tareas", RUTAS.misTareas]
    : puedeRevisar(yo) ? ["Por revisar", RUTAS.porRevisar] : ["Inicio", RUTAS.inicio];
  return h("nav", { class: "v-ruta", "aria-label": "Ruta" },
    h("a", { href }, texto), h("span", { "aria-hidden": "true" }, "/"),
    h("span", { "aria-current": "page" }, etiquetaTipo(st.a.task_type)));
}

/** Quien revisa: el designado; sin designado, quien creó la tarea (o la coordinación). */
function quienRevisa() {
  const a = st.a;
  if (a.reviewer_name) return a.reviewer_name;
  if (a.reviewer_id == null && a.created_by_name) return `${a.created_by_name} (sin revisor designado)`;
  return "Coordinación";
}

function cabecera(c) {
  const a = st.a;
  const p = plazo(a.due_at, { terminada: TERMINADAS.includes(a.status) });
  const curso = a.course_code ? [a.course_code, a.course_name].filter(Boolean).join(" · ") : null;
  // Coordinación puede saltar al seguimiento de la tarea completa.
  const verTarea = a.task_id != null && tieneRol(yo, "coordinator")
    ? h("a", { class: "v-enlace-tarea", href: `/app/tarea.html?id=${encodeURIComponent(a.task_id)}` }, "Ver la tarea y el avance de todos los docentes")
    : null;
  return h("div", { class: "v-cabecera" },
    h("div", { class: "v-fila" },
      h("span", { class: "v-eyebrow" }, etiquetaTipo(a.task_type)),
      chipPrioridad(a.priority),
      chipEstado(a.status)),
    h("h1", { class: "v-h1" }, a.title),
    h("dl", { class: "v-datos" },
      c.esDestinatario ? null : dato("Docente", st.nombres.docente || "—"),
      curso ? dato("Curso", curso) : null,
      a.period_code ? dato("Período", a.period_code) : null,
      dato("Fecha límite", p.texto, p.estado === "vencida" ? "v-vencida" : p.estado === "por-vencer" ? "v-por-vencer" : ""),
      dato("Revisa", quienRevisa())),
    verTarea);
}

const dato = (dt, dd, clase = "") => h("div", {}, h("dt", {}, dt), h("dd", { class: clase || null }, dd));

function linea() {
  const pasos = lineaDeEstados(st.a);
  if (!pasos) {
    return h("section", { class: "v-card v-linea", "aria-label": "Paso del flujo" },
      h("p", { class: "v-linea__cancelada" }, "Esta tarea fue cancelada por la coordinación."));
  }
  const listaPasos = () => h("ol", {}, pasos.map((p) => h("li", {
    class: `v-paso${p.marca ? ` v-paso--${p.marca}` : ""}`,
    "aria-current": p.marca === "actual" || p.marca === "desvio" ? "step" : null,
  },
  h("span", { class: "v-paso__barra" }),
  h("span", { class: "v-paso__nombre" }, p.marca === "hecho" ? icono("check", 18, 3) : null, p.etiqueta,
    p.marca === "hecho" ? h("span", { class: "v-sr" }, " (hecho)") : null),
  p.dato ? h("span", { class: "v-paso__dato" }, p.dato) : null)));

  // Teléfono (< 600 px): solo el paso actual, con la línea completa plegada.
  const resumen = resumenDePaso(st.a.status);
  const movil = h("div", { class: "v-linea__movil" },
    h("div", { class: "v-linea__mini", "aria-hidden": "true" },
      pasos.map((p) => h("span", { class: `v-linea__seg${p.marca ? ` v-linea__seg--${p.marca}` : ""}` }))),
    h("p", { class: "v-linea__actual" }, resumen),
    h("details", { class: "v-linea__todos" }, h("summary", {}, "Ver todos los pasos"), listaPasos()));

  return h("section", { class: "v-card v-linea", "aria-label": "Paso del flujo" },
    h("div", { class: "v-linea__lista" }, listaPasos()),
    movil);
}

/** "Paso 3 de 6 · Entregada"; la devuelta no ocupa un lugar en la línea. */
function resumenDePaso(estado) {
  if (estado === "returned") return "Devuelta · corrige y vuelve a entregar";
  const i = LINEA.indexOf(estado);
  return i < 0 ? etiquetaEstado(estado) : `Paso ${i + 1} de ${LINEA.length} · ${etiquetaEstado(estado)}`;
}

// ── "Qué toca ahora" ─────────────────────────────────────────
function claveLeida() {
  const r = st.a.last_return;
  return `vinci_leida_${st.a.id}_${r?.at || ""}`;
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

let refrescarPaso = () => {};

function tarjetaPaso() {
  const p0 = pasoActual(st.a, yo, ctxPaso());
  const titulo = h("h2", { id: "t-paso", class: "v-h1", style: "font-size: 24px" });
  const eyebrow = h("p", { class: "v-eyebrow" });
  const resumen = h("p", { class: "v-texto", style: "color: var(--v-muted-2)" });
  const lista = h("ul", { class: "v-req" });
  const botones = h("div", { class: "v-acciones" });
  const errorAccion = h("div", { "aria-live": "polite" });

  let campoMotivo = null;
  if (p0.conMotivo) {
    const ta = h("textarea", {
      id: "motivo", rows: 3, maxlength: 2000, value: st.motivo,
      placeholder: "Por ejemplo: falta la bibliografía actualizada de la unidad 3.",
      oninput: (e) => { st.motivo = e.target.value; e.target.removeAttribute("aria-invalid"); refrescarPaso(); },
    });
    campoMotivo = h("div", { class: "v-campo" },
      h("label", { for: "motivo" }, "Observación para el docente"),
      ta,
      h("span", { class: "v-campo__ayuda" }, "Obligatoria para devolver. Al aprobar es opcional y queda en el historial."));
  }

  const tarjeta = h("section", { class: `v-card ${p0.turno === "tuyo" ? "v-card--foco" : "v-card--espera"}`, "aria-labelledby": "t-paso" },
    h("div", { class: "v-cabecera", style: "gap: 8px" }, eyebrow, titulo, resumen),
    observacionVigente(), lista, campoMotivo, botones, errorAccion);

  refrescarPaso = () => {
    const p = pasoActual(st.a, yo, ctxPaso());
    eyebrow.textContent = p.eyebrow;
    titulo.textContent = p.titulo;
    resumen.textContent = p.resumen || "";
    resumen.hidden = !p.resumen;
    poner(lista, p.requisitos.map(filaRequisito));
    lista.hidden = !p.requisitos.length;
    poner(botones,
      p.principal ? boton(p.principal, "v-btn") : null,
      p.secundaria ? boton(p.secundaria, "v-btn v-btn--sec v-btn--peligro") : null,
      ...[p.principal, p.secundaria].filter((b) => b && !b.habilitada && b.motivo).map((b) => h("span", { class: "v-nota" }, b.motivo)));
    botones.hidden = !p.principal;
  };

  const boton = (b, clase) => h("button", {
    type: "button", class: clase, disabled: !b.habilitada || st.ocupado,
    onclick: () => ejecutar(b.accion, errorAccion),
  }, b.etiqueta);

  refrescarPaso();
  return tarjeta;
}

function filaRequisito(r) {
  const marca = h("span", { class: `v-req__marca v-req__marca--${r.estado}`, "aria-hidden": "true" },
    r.estado === "hecho" ? icono("check", 14, 3.5) : null);
  const estadoTxt = r.estado === "hecho" ? "listo" : r.estado === "pendiente" ? (r.nota || "pendiente") : (r.nota || "opcional");
  let accion = null;
  if (r.id === "leer" && r.estado !== "hecho") {
    accion = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { marcarLeida(); refrescarPaso(); } }, "Ya la leí");
  }
  let extra = null;
  if (r.id === "programa") {
    const pv = st.a.program_version;
    if (pv?.id) {
      accion = h("a", { class: "v-btn v-btn--chico", href: RUTAS.programa(pv.id, st.a.id) }, r.estado === "hecho" ? "Ver el programa" : "Continuar el programa");
    } else {
      const zona = h("span", { class: "v-req__detalle", role: "status" });
      const boton = h("button", { type: "button", class: "v-btn v-btn--chico", onclick: async () => {
        boton.disabled = true; boton.textContent = "Abriendo…"; zona.textContent = "";
        try {
          const v = await abrirVersionDeAsignacion(st.a.id);
          location.assign(RUTAS.programa(v.id, st.a.id));
        } catch (e) {
          // 422: la tarea no tiene curso y período; 409: no hay versión de la cual partir.
          // 404 genérico de FastAPI: la ruta todavía no está en el backend.
          zona.textContent = e.status === 404 && /^not found$/i.test(e.message)
            ? "Abrir el programa desde la tarea todavía no está disponible. Avisa a coordinación."
            : e.message;
          boton.disabled = false; boton.textContent = "Completar el programa";
        }
      } }, "Completar el programa");
      accion = boton;
      extra = zona;
    }
  }
  const barraAvance = r.avance != null
    ? h("div", { class: "v-req__avance", role: "img", "aria-label": r.detalle }, h("span", { style: `width: ${Math.round(r.avance * 100)}%` }))
    : null;
  return h("li", {},
    marca,
    h("div", { class: "v-req__cuerpo" },
      h("span", { class: "v-req__titulo" }, r.titulo, " ",
        h("span", { class: `v-req__estado${r.estado === "pendiente" ? " v-req__estado--pendiente" : ""}` }, `· ${estadoTxt}`)),
      r.detalle ? h("span", { class: "v-req__detalle" }, r.detalle) : null, barraAvance, extra),
    accion ? h("div", { class: "v-req__accion" }, accion) : null);
}

async function ejecutar(accion, zonaError) {
  if (st.ocupado) return;
  st.ocupado = true;
  refrescarPaso();
  poner(zonaError);
  try {
    if ((accion === "submit" || accion === "resubmit")) await guardarTextoSiCambio();
    const body = ["return", "approve"].includes(accion) && st.motivo.trim() ? { comment: st.motivo.trim() } : {};
    await api(`/assignments/${st.a.id}/${accion}`, { method: "POST", body });
    st.aviso = { tipo: "ok", texto: EXITO[accion] || "Listo." };
    st.ocupado = false;
    await cargar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    st.ocupado = false;
    let texto = e.message;
    if (e instanceof ApiError && e.status === 422 && e.campo === "file") texto = "Este tipo de tarea exige un archivo en este intento. Adjúntalo y vuelve a intentarlo.";
    if (e instanceof ApiError && e.status === 422 && e.campo === "comment") {
      texto = "Para devolver la entrega escribe el motivo.";
      document.getElementById("motivo")?.setAttribute("aria-invalid", "true");
    }
    if (e instanceof ApiError && e.status === 409) texto = `${e.message} Recarga para ver el estado actual.`;
    poner(zonaError, mensaje("error", texto),
      e instanceof ApiError && e.status === 409 ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { st.aviso = null; cargar(); } }, "Recargar") : null);
    refrescarPaso();
  }
}

// ── Bloques de contenido ─────────────────────────────────────
/** Observación vigente: va dentro del bloque "Te toca a ti", antes de los requisitos. */
function observacionVigente() {
  const r = st.a.last_return;
  if (!r || st.a.status !== "returned") return null;
  return h("div", { class: "v-devolucion", role: "note", "aria-labelledby": "t-dev" },
    h("h3", { id: "t-dev", class: "v-h2" }, "Observación del revisor"),
    h("p", { class: "v-texto" }, r.comment || "Sin comentario."),
    h("p", { class: "v-nota" }, [r.actor, fechaCorta(r.at)].filter(Boolean).join(" · ")));
}

/** Devolución de un intento anterior: al final y siempre plegada. */
function devolucionAnterior() {
  const r = st.a.last_return;
  if (!r || st.a.status === "returned") return null;
  return h("details", { class: "v-card v-plegable" },
    h("summary", { class: "v-h2" }, "Última devolución"),
    h("p", { class: "v-texto" }, r.comment || "Sin comentario."),
    h("p", { class: "v-nota" }, [r.actor, fechaCorta(r.at)].filter(Boolean).join(" · ")));
}

function instrucciones() {
  return h("section", { class: "v-card", "aria-labelledby": "t-inst" },
    h("h2", { id: "t-inst", class: "v-h2" }, "Instrucciones"),
    h("p", { class: "v-texto" }, st.a.instructions || "Esta tarea no trae instrucciones adicionales."),
    st.a.created_by_name ? h("p", { class: "v-nota" }, `Asignada por ${st.a.created_by_name}.`) : null);
}

async function guardarTextoSiCambio() {
  const a = st.a;
  if (!capacidades(a).editarEntrega) return;
  if (archivosDelIntentoActual(a).length) return;     // el texto ya quedó con el primer archivo
  if ((st.texto || "") === (a.draft_comment || "")) return;
  await api(`/assignments/${a.id}/submission-draft`, { method: "PUT", body: { comment: st.texto } });
  a.draft_comment = st.texto;
}

function entrega(c) {
  const a = st.a;
  const forma = formaDeEntrega(a);
  const propia = c.esDestinatario;
  const editable = c.editarEntrega;
  const actuales = archivosDelIntentoActual(a);
  const textoBloqueado = editable && actuales.length > 0;
  const zona = h("div", { "aria-live": "polite" });

  const bloques = [];
  if (forma.programa) {
    const pv = a.program_version;
    bloques.push(h("div", { class: "v-programa" },
      h("p", { class: "v-texto" }, pv
        ? `Programa del curso: ${pv.name || "versión"} · versión ${pv.number} (${ESTADOS_PROGRAMA[pv.status] || pv.status}).`
        : "Esta entrega se hace en el programa del curso."),
      // Quien entrega tiene el enlace en "Te toca a ti"; los demás (revisión, coordinación) lo tienen aquí.
      pv?.id && !(propia && editable) ? h("a", { class: "v-btn v-btn--sec v-btn--chico", href: RUTAS.programa(pv.id, a.id) }, "Ver el programa") : null));
  }
  if (editable) {
    const ta = h("textarea", {
      id: "texto-entrega", rows: 4, maxlength: 5000, value: st.texto, disabled: textoBloqueado,
      placeholder: "Por ejemplo: actualicé la bibliografía y reorganicé la unidad 3.",
      oninput: (e) => { st.texto = e.target.value; refrescarPaso(); },
    });
    bloques.push(h("div", { class: "v-campo" },
      h("label", { for: "texto-entrega" }, forma.textoObligatorio ? "Tu respuesta" : "Texto para quien revisa"),
      ta,
      textoBloqueado
        ? h("span", { class: "v-campo__ayuda" }, "El texto quedó guardado junto con el primer archivo de este intento.")
        : h("span", { class: "v-campo__ayuda" }, forma.archivos ? "Se guarda al entregar. Si vas a adjuntar archivos, escríbelo antes." : "Se guarda al entregar.")));
    if (!textoBloqueado) {
      bloques.push(h("div", { class: "v-acciones" },
        h("button", { type: "button", class: "v-btn v-btn--sec", onclick: async (e) => {
          e.target.disabled = true;
          try {
            await api(`/assignments/${a.id}/submission-draft`, { method: "PUT", body: { comment: st.texto } });
            a.draft_comment = st.texto;
            poner(zona, mensaje("ok", `Borrador guardado · ${fechaCorta(new Date())}`));
          } catch (err) { poner(zona, mensaje("error", err.message)); }
          e.target.disabled = false;
        } }, "Guardar borrador")));
    }
    if (forma.archivos) bloques.push(formularioAdjuntar(zona, forma));
  }
  bloques.push(zona);
  bloques.push(listaIntentos(editable));

  return h("section", { class: "v-card", "aria-labelledby": "t-ent" },
    h("h2", { id: "t-ent", class: "v-h2" }, propia ? "Tu entrega" : "La entrega"),
    bloques);
}

const ESTADOS_PROGRAMA = { draft: "borrador", submitted: "enviada", under_review: "en revisión", returned: "devuelta", approved: "aprobada", authorized: "autorizada", superseded: "reemplazada" };

const extensionDe = (nombre) => (/\.([a-z0-9]{1,8})$/i.exec(nombre || "")?.[1] || "").toLowerCase();

function nombreDeArchivo(descripcion, ext) {
  const limpio = descripcion.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${limpio || "archivo"}.${ext || "pdf"}`;
}

function formularioAdjuntar(zona, forma) {
  const a = st.a;
  const exts = forma.extensiones.length ? forma.extensiones : ["pdf"];
  const lista = [...new Set(exts.map((e) => (e === "jpeg" ? "jpg" : e).toUpperCase()))].join(", ");
  const archivo = h("input", { id: "archivo", type: "file", accept: exts.map((e) => `.${e}`).join(",") });
  const desc = h("input", { id: "desc-archivo", type: "text", maxlength: 120, placeholder: "Por ejemplo: Rúbrica de la unidad 2", autocomplete: "off" });
  const enviar = h("button", { type: "submit", class: "v-btn v-btn--sec" }, "Adjuntar archivo");
  const reentrega = a.status === "returned";
  const nota = forma.archivoObligatorio
    ? (reentrega ? "Este tipo de tarea exige un archivo nuevo en cada intento." : "Este tipo de tarea exige al menos un archivo.")
    : "Adjuntar archivos es opcional en este tipo de tarea.";
  const noAceptadas = forma.noAceptadas.length ? ` Por ahora no se aceptan: ${forma.noAceptadas.map((e) => e.toUpperCase()).join(", ")}.` : "";

  const form = h("form", { class: "v-adjuntar", novalidate: true },
    h("div", { class: "v-campo" },
      h("label", { for: "archivo" }, `Archivo (${lista})`),
      archivo,
      h("span", { class: "v-campo__ayuda" }, `${nota} Máximo ${forma.maxMb} MB.${noAceptadas}`)),
    h("div", { class: "v-campo" },
      h("label", { for: "desc-archivo" }, "¿Para qué es este archivo?"),
      desc),
    h("div", { class: "v-acciones" }, enviar));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = archivo.files?.[0];
    const d = desc.value.trim();
    const ext = extensionDe(f?.name);
    archivo.removeAttribute("aria-invalid");
    desc.removeAttribute("aria-invalid");
    const malo = (texto, el = archivo) => { el.setAttribute("aria-invalid", "true"); el.focus(); poner(zona, mensaje("error", texto)); };
    if (!f) return malo("Elige un archivo.");
    if (!exts.includes(ext)) return malo(`Ese tipo de archivo no se acepta aquí. Usa: ${lista}.`);
    if (f.size > forma.maxMb * 1024 * 1024) return malo(`El archivo supera el límite de ${forma.maxMb} MB.`);
    if (d.length < 3) return malo("Escribe para qué es el archivo (al menos 3 letras).", desc);
    enviar.disabled = true;
    enviar.textContent = "Subiendo…";
    try {
      // El primer archivo del intento crea la entrega con el texto del borrador: se guarda antes.
      await guardarTextoSiCambio();
      const fd = new FormData();
      // La descripción todavía no se guarda al vincular: se sube con ella como nombre (NOTAS_BACKEND.md).
      fd.append("file", f, nombreDeArchivo(d, ext));
      const subido = await api("/files", { method: "POST", form: fd });
      await api(`/assignments/${a.id}/files`, { method: "POST", body: { file_id: String(subido.file_id), name: d } });
      st.aviso = { tipo: "ok", texto: `Archivo adjunto: ${d}.` };
      await cargar();
    } catch (err) {
      poner(zona, mensaje("error", err.message));
      enviar.disabled = false;
      enviar.textContent = "Adjuntar archivo";
    }
  });
  return form;
}

const sinExtension = (n) => String(n || "Archivo").replace(/\.[a-z0-9]{1,8}$/i, "");

/** Intentos enviados (texto, fecha y archivos) y el que está en preparación. */
function listaIntentos(editable) {
  const a = st.a;
  const n = envios(a);
  const textos = new Map((a.attempts || []).map((x) => [Number(x.number), x]));
  const archivos = new Map(archivosPorIntento(a).map((g) => [g.intento, g.archivos]));
  const numeros = [...new Set([...textos.keys(), ...archivos.keys()])].sort((x, y) => y - x);
  if (!numeros.length) return h("p", { class: "v-nota" }, editable ? "Todavía no has adjuntado archivos." : "Todavía no hay entrega.");
  return h("div", { class: "v-cabecera", style: "gap: 16px" },
    h("h3", { class: "v-campo__etq", style: "font-size: 13px; font-weight: 700; color: var(--v-navy)" }, "Intentos"),
    numeros.map((num) => {
      const t = textos.get(num);
      const fs = archivos.get(num) || [];
      const enPreparacion = num > n;
      const etiqueta = `Intento ${num}${enPreparacion ? " · en preparación" : num === n ? " · último enviado" : ""}${!enPreparacion && t?.created_at ? ` · ${fechaCorta(t.created_at)}` : ""}`;
      return h("div", { class: "v-intento" },
        h("p", { class: "v-intento__titulo" }, etiqueta),
        // El texto del intento en preparación es el borrador que está arriba.
        !enPreparacion ? h("p", { class: "v-texto" }, t?.text || "Sin texto.") : null,
        fs.length ? h("ul", { class: "v-archivos" }, fs.map(filaArchivo)) : h("p", { class: "v-nota" }, "Sin archivos."));
    }));
}

function filaArchivo(f) {
  const zona = h("span", { class: "v-archivo__dato", role: "status" });
  const nombre = sinExtension(f.name);
  const ext = extensionDe(f.name);
  return h("li", { class: "v-archivo" },
    h("div", { class: "v-archivo__info" },
      h("span", { class: "v-archivo__nombre" }, nombre),
      h("span", { class: "v-archivo__dato", title: fechaHora(f.uploaded_at) },
        [ext ? ext.toUpperCase() : null, fechaCorta(f.uploaded_at), tamano(f.size)].filter(Boolean).join(" · ")),
      zona),
    h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: async (e) => {
      e.target.disabled = true;
      zona.textContent = "";
      try { await descargarArchivo(f.file_id, f.name || nombre); }
      catch (err) { zona.textContent = err.message; }
      e.target.disabled = false;
    } }, "Descargar"));
}

function comentarios(c) {
  const a = st.a;
  const lista = a.comments || [];
  const zona = h("div", { "aria-live": "polite" });
  let form = null;
  if (c.comentar && a.status !== "cancelled") {
    const ta = h("textarea", { id: "comentario", rows: 2, maxlength: 5000, placeholder: "Escribe una pregunta o aclaración. No cambia el estado de la tarea." });
    const btn = h("button", { type: "submit", class: "v-btn v-btn--sec" }, "Comentar");
    form = h("form", { class: "v-cabecera", style: "gap: 12px" },
      h("div", { class: "v-campo" }, h("label", { for: "comentario" }, "Nuevo comentario"), ta),
      h("div", { class: "v-acciones" }, btn));
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
  return h("section", { class: "v-card", "aria-labelledby": "t-com" },
    h("h2", { id: "t-com", class: "v-h2" }, "Comentarios"),
    lista.length
      ? h("ul", { class: "v-comentarios" }, lista.map((x) => h("li", { class: "v-comentario" },
        h("div", { class: "v-comentario__cab" },
          h("strong", {}, Number(x.author_id ?? x.author) === yo.id ? "Tú" : x.author_name || "Usuario"),
          x.created_at ? h("span", { class: "v-comentario__fecha", title: fechaHora(x.created_at) }, fechaCorta(x.created_at)) : null),
        h("p", {}, x.text))))
      : h("p", { class: "v-nota" }, "Todavía no hay comentarios."),
    form, zona);
}

function historial() {
  const items = [...(st.a.history || [])].reverse();
  return h("section", { class: "v-card v-card--lado", "aria-labelledby": "t-hist" },
    h("h2", { id: "t-hist", class: "v-h2" }, "Historial"),
    items.length
      ? h("ol", { class: "v-hist" }, items.map((x) => h("li", {},
        h("span", { class: "v-hist__que" }, fraseHistorial(x)),
        x.comment && x.new_status !== "assigned" ? h("span", { class: "v-hist__nota" }, `«${x.comment}»`) : null,
        h("span", { class: "v-hist__cuando", title: fechaHora(x.at) }, fechaCorta(x.at)))))
      : h("p", { class: "v-nota" }, "Sin movimientos todavía."));
}

// ── Arranque ─────────────────────────────────────────────────
montarBarra(yo, seccionDeOrigen());
if (!id || !/^\d+$/.test(id)) {
  pintarError("Falta indicar qué tarea abrir.");
} else {
  await cargar();
}
