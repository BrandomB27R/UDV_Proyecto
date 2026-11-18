// Programa de curso: página propia de una versión.
// Encabezado fijo (curso, período, sede, versión, estado y selector de versión), línea de pasos con
// qué falta para avanzar, editor por secciones con guardado por sección, responsables y cambios.
// URL: /app/programa.html?version=ID[&asignacion=ID]
import { ApiError } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, icono, mensaje } from "../dom.js";
import { fechaCorta, fechaHora } from "../formato.js";
import { sinAcceso, textoDeError, todasLasPaginas, guardarAviso } from "../componentes.js";
import { api } from "../api.js";
import { requerirSesion, tieneRol } from "../sesion.js";
import {
  leerVersion, leerPrograma, leerCambios, guardarSeccion, transicionVersion, descargarPdf,
  accionesDeVersion, perfilesDeEgreso,
} from "../programa/api-programa.js";
import { SECCIONES, tituloSeccion, contenidoDe, crearEditor, lecturaSeccion, avanceDe } from "../programa/secciones.js";
import {
  lineaPrograma, resumenPasoPrograma, pasoPrograma, etiquetaEstadoPrograma, claseEstadoPrograma,
} from "../programa/flujo-programa.js";
import { cambiosLegibles } from "../programa/cambios.js";

const raiz = document.getElementById("contenido");
const params = new URLSearchParams(location.search);
const versionId = params.get("version");
const asignacionId = params.get("asignacion");
const yo = await requerirSesion();
montarBarra(yo, "programas");

const EXITO = {
  submit: "Programa enviado a revisión.", review: "Tomaste el programa para revisarlo.",
  return: "Programa devuelto con tu observación.", approve: "Programa aprobado. Falta que dirección lo autorice.",
  authorize: "Programa autorizado: ahora es la versión vigente.",
};

const st = {
  v: null, programa: null, versiones: [], acciones: new Set(),
  asignacion: null,             // la tarea de ?asignacion=, si quien mira puede verla
  cursos: null, perfiles: undefined,
  seccion: SECCIONES.find((s) => `#${s.id}` === location.hash)?.id || "general",
  editores: new Map(),          // seccion -> {editor, base, guardadoEn}
  motivo: "", aviso: null, ocupado: false,
  // #historial (desde la lista de programas) abre el historial; #cambios, la comparación.
  verCambios: location.hash === "#cambios", verHistorial: location.hash === "#historial",
};

// ── Carga ────────────────────────────────────────────────────
async function cargar() {
  try {
    st.v = await leerVersion(versionId);
  } catch (e) {
    tituloPestana("Programa de curso");
    await sinAcceso(raiz, "No se pudo abrir el programa",
      e instanceof ApiError && e.status === 404 ? "Este programa no existe o no tienes acceso a esa versión." : textoDeError(e, "No tienes acceso a este programa."));
  }
  try {
    const p = await leerPrograma(st.v.programa_id);
    st.programa = p.programa;
    st.versiones = [...(p.versiones || [])].sort((a, b) => b.numero_version - a.numero_version);
  } catch { st.versiones = [st.v]; }
  st.acciones = accionesDeVersion(st.v);
  if (asignacionId) st.asignacion = await api(`/assignments/${encodeURIComponent(asignacionId)}`).catch(() => null);
  st.editores.clear();
  if (st.acciones.has("edit")) await cargarCatalogos();
  const g = contenidoDe(st.v, "general");
  tituloPestana(`${g.codigo || st.programa?.codigo || "Programa"} · versión ${st.v.numero_version}`);
  pintar();
}

async function cargarCatalogos() {
  if (!st.cursos) st.cursos = (await todasLasPaginas(api, "/courses").catch(() => ({ data: [] }))).data || [];
  if (st.perfiles === undefined) st.perfiles = await perfilesDeEgreso().catch(() => []);
}

const editable = () => st.acciones.has("edit");

// Abierta desde su tarea por el docente de esa asignación, con la tarea por entregar:
// enviar el programa también entrega la tarea (submit, o resubmit si se la devolvieron).
const ESTADOS_POR_ENTREGAR = ["in_progress", "returned"];
const conTarea = () => !!st.asignacion && st.asignacion.assignee_id === yo.id
  && ESTADOS_POR_ENTREGAR.includes(st.asignacion.status) && st.acciones.has("submit");

function editorDe(id) {
  if (!st.editores.has(id)) {
    const editor = crearEditor(id, contenidoDe(st.v, id), {
      cursos: st.cursos, perfiles: st.perfiles, versionId: st.v.id,
      alCambiar: () => { refrescarEstado(); },
    });
    st.editores.set(id, { editor, base: JSON.stringify(editor.valor()), guardadoEn: null });
  }
  return st.editores.get(id);
}
const sinGuardar = (id) => { const e = st.editores.get(id); return !!e && JSON.stringify(e.editor.valor()) !== e.base; };
const seccionesSinGuardar = () => SECCIONES.filter((s) => sinGuardar(s.id));

// Aviso al salir con cambios sin guardar.
window.addEventListener("beforeunload", (e) => {
  if (editable() && seccionesSinGuardar().length) { e.preventDefault(); e.returnValue = ""; }
});

// ── Página ───────────────────────────────────────────────────
let refrescarEstado = () => {};

function pintar() {
  const aviso = st.aviso;
  st.aviso = null;
  const ref = {};
  poner(raiz,
    rutaDeMigas(),
    cabecera(),
    aviso ? mensaje(aviso.tipo, aviso.texto) : null,
    st.verHistorial ? bloqueHistorial() : null,
    st.verCambios ? bloqueCambios() : null,
    linea(),
    ref.paso = h("div"),
    h("div", { class: "p-editor" },
      ref.nav = h("nav", { class: "p-secciones", "aria-label": "Secciones del programa" }),
      ref.seccion = h("div", { class: "p-seccion-zona" })),
    bloqueResponsables());

  refrescarEstado = () => {
    pintarNav(ref.nav);
    pintarPaso(ref.paso);
    pintarEstadoGuardado();
  };
  pintarSeccion(ref.seccion);
  refrescarEstado();
}

function rutaDeMigas() {
  const g = contenidoDe(st.v, "general");
  return h("nav", { class: "v-ruta", "aria-label": "Ruta" },
    asignacionId
      ? h("a", { href: RUTAS.asignacion(asignacionId) }, "Volver a la tarea")
      : h("a", { href: RUTAS.programas }, "Programas de curso"),
    h("span", { "aria-hidden": "true" }, "/"),
    h("span", { "aria-current": "page" }, `${g.codigo || ""} · versión ${st.v.numero_version}`));
}

function cabecera() {
  const v = st.v;
  const g = contenidoDe(v, "general");
  const pdf = ["authorized", "superseded"].includes(v.estado);
  // Si el PDF falla, aviso de error destacado bajo los botones del encabezado.
  const zonaPdf = h("div", { class: "p-cabecera__aviso" });
  const selector = h("select", { id: "selector-version", "aria-label": "Versión", class: v.estado === "authorized" ? "p-opcion--autorizada" : null, onchange: (e) => {
    location.assign(`/app/programa.html?version=${encodeURIComponent(e.target.value)}${asignacionId ? `&asignacion=${encodeURIComponent(asignacionId)}` : ""}`);
  } }, st.versiones.map((x) => h("option", { value: String(x.id), selected: x.id === v.id, class: x.estado === "authorized" ? "p-opcion--autorizada" : "p-opcion" },
    `Versión ${x.numero_version} · ${periodoDe(x)} · ${etiquetaEstadoPrograma(x.estado)}`)));
  return h("header", { class: "p-cabecera" },
    h("div", { class: "p-cabecera__titulo" },
      h("p", { class: "v-eyebrow" }, "Programa de curso"),
      h("h1", { class: "p-cabecera__h1" }, `${g.codigo || st.programa?.codigo || ""} · ${g.asignatura || st.programa?.asignatura || "Programa"}`),
      h("dl", { class: "p-cabecera__datos" },
        dato("Período", g.ciclo || "—"), dato("Sede", g.sede || st.programa?.sede || "—"),
        dato("Versión", String(v.numero_version)),
        h("div", {}, h("dt", {}, "Estado"), h("dd", {}, h("span", { class: `v-chip v-chip--${claseEstadoPrograma(v.estado)}` }, etiquetaEstadoPrograma(v.estado)))))),
    h("div", { class: "p-cabecera__acciones" },
      st.versiones.length > 1 ? h("div", { class: "v-campo p-selector" }, h("label", { for: "selector-version", class: "v-sr" }, "Versión"), selector) : null,
      st.versiones.length > 1 ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", "aria-expanded": String(st.verHistorial), "aria-controls": "historial-versiones",
        onclick: () => { alternarHistorial(!st.verHistorial); } }, st.verHistorial ? "Ocultar historial" : `Historial (${st.versiones.length})`) : null,
      v.version_origen_id || st.versiones.length > 1 ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", "aria-expanded": String(st.verCambios),
        onclick: () => { st.verCambios = !st.verCambios; pintar(); } }, st.verCambios ? "Ocultar cambios" : "Ver cambios") : null,
      pdf ? h("button", { type: "button", class: "v-btn v-btn--chico", onclick: async (e) => {
        e.target.disabled = true; poner(zonaPdf);
        try { await descargarPdf(v.id, `${g.codigo || "programa"}-version-${v.numero_version}.pdf`); }
        catch (err) { poner(zonaPdf, mensaje("error", `No se pudo descargar el PDF: ${err.message}`)); }
        e.target.disabled = false;
      } }, "Descargar PDF") : null,
      zonaPdf));
}

const dato = (dt, dd) => h("div", {}, h("dt", {}, dt), h("dd", {}, dd));
const periodoDe = (x) => x?.secciones?.general?.contenido?.ciclo || `período ${x?.periodo_id ?? ""}`.trim();

function linea() {
  const pasos = lineaPrograma(st.v);
  const lista = () => h("ol", {}, pasos.map((p) => h("li", {
    class: `v-paso${p.marca ? ` v-paso--${p.marca}` : ""}`, "aria-current": p.marca === "actual" || p.marca === "desvio" ? "step" : null },
    h("span", { class: "v-paso__barra" }),
    h("span", { class: "v-paso__nombre" }, p.marca === "hecho" ? icono("check", 18, 3) : null, p.etiqueta,
      p.marca === "hecho" ? h("span", { class: "v-sr" }, " (hecho)") : null),
    p.dato ? h("span", { class: "v-paso__dato" }, p.dato) : null)));
  return h("section", { class: "v-card v-linea", "aria-label": "Paso del programa" },
    st.v.estado === "superseded" ? h("p", { class: "v-msg v-msg--info" }, "Esta versión fue reemplazada por otra autorizada más reciente. Se conserva para consulta.") : null,
    h("div", { class: "v-linea__lista" }, lista()),
    h("div", { class: "v-linea__movil" },
      h("div", { class: "v-linea__mini", "aria-hidden": "true" }, pasos.map((p) => h("span", { class: `v-linea__seg${p.marca ? ` v-linea__seg--${p.marca}` : ""}` }))),
      h("p", { class: "v-linea__actual" }, resumenPasoPrograma(st.v.estado)),
      h("details", { class: "v-linea__todos" }, h("summary", {}, "Ver todos los pasos"), lista())));
}

// ── Qué toca ahora ───────────────────────────────────────────
let campoMotivo = null;
function pintarPaso(zona) {
  const avance = avanceDe(st.v);
  const responsable = contenidoDe(st.v, "responsables")?.docente || null;
  const p = pasoPrograma(st.v, { acciones: st.acciones, avance, sinGuardar: seccionesSinGuardar().map((s) => s.titulo), motivo: st.motivo, responsable, conTarea: conTarea() });
  // El campo de observación se conserva entre repintados para no perder el foco.
  if (p.conMotivo && !campoMotivo) {
    campoMotivo = h("div", { class: "v-campo" },
      h("label", { for: "motivo" }, "Observación para quien elaboró el programa"),
      h("textarea", { id: "motivo", rows: 3, maxlength: 2000, value: st.motivo, oninput: (e) => { st.motivo = e.target.value; e.target.removeAttribute("aria-invalid"); pintarPaso(zona); } }),
      h("span", { class: "v-campo__ayuda" }, "Obligatoria para devolver. Al aprobar es opcional."));
  }
  const errores = zona.querySelector(".p-paso-error") || h("div", { class: "p-paso-error", "aria-live": "polite" });
  const tarjeta = zona.firstElementChild?.classList.contains("v-card") ? zona.firstElementChild : null;
  const boton = (b, clase) => h("button", { type: "button", class: clase, disabled: !b.habilitada || st.ocupado, onclick: () => ejecutar(b.accion, errores) }, b.etiqueta);
  const contenido = [
    h("div", { class: "v-cabecera", style: "gap: 8px" },
      h("p", { class: "v-eyebrow" }, p.eyebrow),
      h("h2", { class: "v-h1", style: "font-size: 24px" }, p.titulo),
      p.resumen ? h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, p.resumen) : null),
    p.requisitos.length ? h("ul", { class: "v-req" }, p.requisitos.map(filaRequisito)) : null,
    p.conMotivo ? campoMotivo : null,
    p.principal ? h("div", { class: "v-acciones" },
      boton(p.principal, "v-btn"),
      p.secundaria ? boton(p.secundaria, "v-btn v-btn--sec v-btn--peligro") : null,
      ...[p.principal, p.secundaria].filter((b) => b && !b.habilitada && b.motivo).map((b) => h("span", { class: "v-nota" }, b.motivo))) : null,
    errores,
  ];
  const clase = `v-card ${p.turno === "tuyo" ? "v-card--foco" : "v-card--espera"}`;
  // Repintar quita y vuelve a poner el campo de observación: se le devuelve el foco y el cursor.
  const activo = document.activeElement;
  const enMotivo = activo?.id === "motivo" ? [activo.selectionStart, activo.selectionEnd] : null;
  if (tarjeta) { tarjeta.className = clase; poner(tarjeta, contenido); } else poner(zona, h("section", { class: clase, "aria-label": "Qué toca ahora" }, contenido));
  if (enMotivo) { const t = document.getElementById("motivo"); t?.focus(); t?.setSelectionRange(...enMotivo); }
}

function filaRequisito(r) {
  return h("li", {},
    h("span", { class: `v-req__marca v-req__marca--${r.estado}`, "aria-hidden": "true" }, r.estado === "hecho" ? icono("check", 14, 3.5) : null),
    h("div", { class: "v-req__cuerpo" },
      h("span", { class: "v-req__titulo" }, r.titulo, " ",
        h("span", { class: `v-req__estado${r.estado === "pendiente" ? " v-req__estado--pendiente" : ""}` },
          `· ${r.estado === "hecho" ? "listo" : r.nota || r.estado}`)),
      r.detalle ? h("span", { class: "v-req__detalle" }, r.detalle) : null));
}

async function ejecutar(accion, zonaError) {
  if (st.ocupado) return;
  if (accion === "return" && !st.motivo.trim()) {
    poner(zonaError, mensaje("error", "Para devolver el programa escribe la observación."));
    document.getElementById("motivo")?.setAttribute("aria-invalid", "true");
    return;
  }
  st.ocupado = true;
  poner(zonaError);
  const entregar = accion === "submit" && conTarea();
  if (entregar) refrescarEstado();     // botón deshabilitado mientras se envía
  try {
    await transicionVersion(st.v.id, accion, ["return", "approve"].includes(accion) ? st.motivo.trim() || null : null);
    if (entregar) return await entregarTarea();
    st.aviso = { tipo: "ok", texto: EXITO[accion] || "Listo." };
    st.motivo = ""; campoMotivo = null;
    st.ocupado = false;
    await cargar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    st.ocupado = false;
    // 409: por ejemplo, quien elaboró la versión no puede aprobarla. Se muestra el mensaje tal cual.
    poner(zonaError, mensaje("error", e.message));
  }
}

/** Segundo paso de «Enviar a revisión y entregar la tarea»: el programa ya se envió. Siempre vuelve a la tarea. */
async function entregarTarea() {
  const a = st.asignacion;
  const accion = a.status === "returned" ? "resubmit" : "submit";
  try {
    await api(`/assignments/${encodeURIComponent(a.id)}/${accion}`, { method: "POST", body: {} });
    guardarAviso({ asignacion: a.id, tipo: "ok", texto: accion === "resubmit" ? "Programa enviado a revisión y tarea reentregada." : "Programa enviado a revisión y tarea entregada." });
  } catch (e) {
    guardarAviso({ asignacion: a.id, tipo: "aviso", enfocarEntrega: true,
      texto: `El programa se envió, pero falta entregar la tarea. ${e.message ? `${e.message.replace(/\.?$/, ".")} ` : ""}Usa el botón «${accion === "resubmit" ? "Reentregar" : "Entregar"}».` });
  }
  location.assign(RUTAS.asignacion(a.id));
}

// ── Secciones ────────────────────────────────────────────────
function pintarNav(nav) {
  const avance = avanceDe(st.v);
  poner(nav,
    h("p", { class: "p-secciones__avance" }, `${avance.listas} de ${avance.total} secciones listas`),
    h("div", { class: "p-secciones__barra", role: "img", "aria-label": `${avance.listas} de ${avance.total} secciones listas` },
      h("span", { style: `width: ${Math.round((avance.listas / avance.total) * 100)}%` })),
    h("ol", {}, avance.estados.map((s) => {
      const pendiente = sinGuardar(s.id);
      return h("li", {}, h("button", {
        type: "button", class: `p-secciones__item${s.id === st.seccion ? " p-secciones__item--actual" : ""}`,
        "aria-current": s.id === st.seccion ? "true" : null,
        onclick: () => irA(s.id),
      },
      h("span", {}, s.titulo),
      h("span", { class: `p-marca ${pendiente ? "p-marca--guardar" : s.ok ? "p-marca--ok" : "p-marca--falta"}` },
        pendiente ? "Sin guardar" : s.ok ? "Lista" : "Falta")));
    })));
}

function irA(id) {
  st.seccion = id;
  history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
  pintarSeccion(document.querySelector(".p-seccion-zona"));
  refrescarEstado();
  document.getElementById("t-seccion")?.focus();
}

let estadoGuardado = null;
function pintarEstadoGuardado() {
  if (!estadoGuardado) return;
  const e = st.editores.get(st.seccion);
  if (!editable()) { estadoGuardado.textContent = ""; return; }
  estadoGuardado.textContent = sinGuardar(st.seccion) ? "Cambios sin guardar"
    : e?.guardadoEn ? `Guardado ${fechaCorta(e.guardadoEn)}` : "Sin cambios";
  estadoGuardado.className = `p-guardado${sinGuardar(st.seccion) ? " p-guardado--pendiente" : ""}`;
}

function pintarSeccion(zona) {
  const i = SECCIONES.findIndex((s) => s.id === st.seccion);
  const s = SECCIONES[i];
  const est = avanceDe(st.v).estados[i];
  const errorZona = h("div", { "aria-live": "polite" });
  estadoGuardado = h("span", { class: "p-guardado", role: "status" });
  let cuerpo;
  let guardar = null;
  if (editable()) {
    const e = editorDe(s.id);
    cuerpo = e.editor.nodo;
    guardar = h("button", { type: "button", class: "v-btn", onclick: async () => {
      const fallo = e.editor.error();
      if (fallo) { poner(errorZona, mensaje("error", fallo)); return; }
      guardar.disabled = true; guardar.textContent = "Guardando…";
      try {
        const valor = e.editor.valor();
        const nueva = await guardarSeccion(st.v.id, s.id, valor);
        if (nueva?.secciones) st.v = { ...st.v, ...nueva };
        e.base = JSON.stringify(valor);
        e.guardadoEn = new Date();
        poner(errorZona);
      } catch (err) {
        // La API dice qué falló; se informa la sección y no se sigue.
        poner(errorZona, mensaje("error", `No se guardó «${s.titulo}»: ${err.message}`));
      }
      guardar.disabled = false; guardar.textContent = "Guardar sección";
      refrescarEstado();
    } }, "Guardar sección");
  } else {
    cuerpo = lecturaSeccion(s.id, contenidoDe(st.v, s.id), { versionId: st.v.id });
  }
  const anterior = i > 0 ? SECCIONES[i - 1] : null;
  const siguiente = i < SECCIONES.length - 1 ? SECCIONES[i + 1] : null;
  poner(zona, h("section", { class: "v-card p-seccion", "aria-labelledby": "t-seccion" },
    h("div", { class: "p-seccion__cab" },
      h("div", {},
        h("p", { class: "v-eyebrow" }, `Sección ${i + 1} de ${SECCIONES.length}`),
        h("h2", { id: "t-seccion", class: "v-h1", style: "font-size: 24px", tabindex: "-1" }, s.titulo)),
      h("span", { class: `p-marca ${est.ok ? "p-marca--ok" : "p-marca--falta"}` }, est.ok ? "Lista" : "Falta")),
    !est.ok && est.detalle ? h("p", { class: "v-nota" }, est.detalle) : null,
    cuerpo,
    errorZona,
    h("div", { class: "p-seccion__pie" },
      h("div", { class: "v-acciones" }, guardar, estadoGuardado),
      h("div", { class: "v-acciones" },
        anterior ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => irA(anterior.id) }, `← ${anterior.titulo}`) : null,
        siguiente ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => irA(siguiente.id) }, `${siguiente.titulo} →`) : null))));
  pintarEstadoGuardado();
}

// ── Responsables (aparte; editable solo por coordinación) ────
function bloqueResponsables() {
  const r = contenidoDe(st.v, "responsables") || {};
  const puede = editable() && tieneRol(yo, "coordinator");
  const d = (dt, dd) => h("div", {}, h("dt", {}, dt), h("dd", {}, dd || "—"));
  if (!puede) {
    return h("section", { class: "v-card", "aria-labelledby": "t-resp" },
      h("h2", { id: "t-resp", class: "v-h2" }, "Responsables"),
      h("dl", { class: "v-datos" }, d("Docente responsable", r.docente), d("Coordinación", r.coordinador), d("Revisión", r.revisor), d("Decanatura", r.decanatura), d("Autorizó", r.autoridad)));
  }
  const val = { coordinador: r.coordinador || "", decanatura: r.decanatura || "" };
  const zona = h("div", { "aria-live": "polite" });
  const campo = (id, etq, k) => h("div", { class: "v-campo" }, h("label", { for: id }, etq),
    h("input", { id, type: "text", maxlength: 200, value: val[k], oninput: (e) => { val[k] = e.target.value; } }));
  return h("section", { class: "v-card", "aria-labelledby": "t-resp" },
    h("h2", { id: "t-resp", class: "v-h2" }, "Responsables"),
    h("dl", { class: "v-datos" }, d("Docente responsable", r.docente), d("Revisión", r.revisor), d("Autorizó", r.autoridad)),
    h("div", { class: "v-dos" }, campo("resp-coord", "Coordinación (nombre para el PDF)", "coordinador"), campo("resp-dec", "Decanatura (nombre para el PDF)", "decanatura")),
    h("div", { class: "v-acciones" }, h("button", { type: "button", class: "v-btn v-btn--sec", onclick: async (e) => {
      e.target.disabled = true;
      try {
        const nueva = await guardarSeccion(st.v.id, "responsables", { coordinador: val.coordinador.trim() || null, decanatura: val.decanatura.trim() || null });
        if (nueva?.secciones) st.v = { ...st.v, ...nueva };
        poner(zona, mensaje("ok", `Responsables guardados · ${fechaCorta(new Date())}`));
      } catch (err) { poner(zona, mensaje("error", err.message)); }
      e.target.disabled = false;
    } }, "Guardar responsables")),
    zona);
}

// ── Historial de versiones ───────────────────────────────────
const urlVersion = (id, hash = "") =>
  `/app/programa.html?version=${encodeURIComponent(id)}${asignacionId ? `&asignacion=${encodeURIComponent(asignacionId)}` : ""}${hash}`;

function alternarHistorial(abrir) {
  st.verHistorial = abrir;
  if (!abrir && location.hash === "#historial") history.replaceState(null, "", `${location.pathname}${location.search}`);
  pintar();
  if (abrir) irAlHistorial();
}

function irAlHistorial() {
  desplazarA(document.getElementById("historial-versiones"));
  document.getElementById("t-historial")?.focus({ preventScroll: true });
}

/** Lleva un bloque arriba, debajo de la barra y del encabezado si están fijos. */
function desplazarA(el) {
  if (!el) return;
  const fijos = [document.getElementById("barra"), document.querySelector(".p-cabecera")]
    .filter((x) => x && ["sticky", "fixed"].includes(getComputedStyle(x).position))
    .reduce((t, x) => t + x.offsetHeight, 0);
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - fijos - 12) });
}

/** Tabla de todas las versiones, de la más nueva a la más vieja. st.versiones ya viene ordenada así. */
function bloqueHistorial() {
  const masVieja = st.versiones[st.versiones.length - 1];
  const zonaError = h("div", { "aria-live": "polite" });
  const codigo = contenidoDe(st.v, "general").codigo || st.programa?.codigo || "programa";
  const filas = st.versiones.map((x) => {
    const actual = x.id === st.v.id;
    const conPdf = ["authorized", "superseded"].includes(x.estado);
    const conCambios = !!x.version_origen_id || x.id !== masVieja.id;
    const pdf = conPdf ? h("button", { type: "button", class: "v-enlace", onclick: async (e) => {
      e.currentTarget.disabled = true; const b = e.currentTarget; poner(zonaError);
      try { await descargarPdf(x.id, `${codigo}-version-${x.numero_version}.pdf`); }
      catch (err) { poner(zonaError, mensaje("error", `No se pudo descargar el PDF de la versión ${x.numero_version}: ${err.message}`)); }
      b.disabled = false;
    } }, "PDF", h("span", { class: "v-sr" }, ` de la versión ${x.numero_version}`)) : null;
    const cambios = !conCambios ? null : actual
      ? h("button", { type: "button", class: "v-enlace", "aria-expanded": String(st.verCambios),
        onclick: () => { st.verCambios = !st.verCambios; pintar(); if (st.verCambios) desplazarA(document.getElementById("t-cambios")?.closest("section")); } },
        st.verCambios ? "Ocultar cambios" : "Ver cambios")
      : h("a", { class: "v-enlace", href: urlVersion(x.id, "#cambios") }, "Ver cambios", h("span", { class: "v-sr" }, ` de la versión ${x.numero_version}`));
    const autorizada = x.autorizado_en && ["authorized", "superseded"].includes(x.estado) ? fechaCorta(x.autorizado_en) : "—";
    return h("tr", { class: actual ? "p-historial__actual" : null, "aria-current": actual ? "true" : null },
      h("th", { scope: "row", "data-etq": "Versión" }, `Versión ${x.numero_version}`, actual ? h("span", { class: "p-historial__aqui" }, " · abierta") : null),
      h("td", { "data-etq": "Período" }, periodoDe(x)),
      h("td", { "data-etq": "Estado" }, h("span", { class: `v-chip v-chip--${claseEstadoPrograma(x.estado)}` }, etiquetaEstadoPrograma(x.estado))),
      h("td", { "data-etq": "Elaboró" }, contenidoDe(x, "responsables")?.docente || "—"),
      h("td", { "data-etq": "Autorizada el" }, autorizada),
      h("td", {}, h("div", { class: "p-historial__acciones" },
        actual ? null : h("a", { class: "v-enlace", href: urlVersion(x.id) }, "Abrir", h("span", { class: "v-sr" }, ` la versión ${x.numero_version}`)),
        pdf, cambios)));
  });
  return h("section", { id: "historial-versiones", class: "v-card p-historial", "aria-labelledby": "t-historial" },
    h("div", { class: "p-historial__cab" },
      h("h2", { id: "t-historial", class: "v-h2", tabindex: "-1" }, "Historial de versiones"),
      h("button", { type: "button", class: "v-enlace", onclick: () => alternarHistorial(false) }, "Ocultar historial")),
    h("p", { class: "v-nota" }, `${st.versiones.length} versiones, de la más nueva a la más vieja. La vigente es la última autorizada; el PDF existe solo para las autorizadas y las reemplazadas.`),
    h("div", { class: "p-historial__marco" },
      h("table", { class: "v-tabla-lectura p-historial__tabla" },
        h("thead", {}, h("tr", {}, ["Versión", "Período", "Estado", "Elaboró", "Autorizada el"].map((t) => h("th", { scope: "col" }, t)),
          h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acciones")))),
        h("tbody", {}, filas))),
    zonaError);
}

// ── Cambios frente a la versión anterior ─────────────────────
function bloqueCambios() {
  const zona = h("section", { class: "v-card", "aria-labelledby": "t-cambios" },
    h("h2", { id: "t-cambios", class: "v-h2" }, "Cambios frente a la versión anterior"),
    h("p", { class: "v-cargando" }, "Cargando cambios…"));
  leerCambios(st.v.id).then((r) => {
    const grupos = cambiosLegibles(r);
    const anterior = st.versiones.find((x) => x.id === r.version_anterior);
    poner(zona,
      h("h2", { id: "t-cambios", class: "v-h2" }, "Cambios frente a la versión anterior"),
      !r.version_anterior ? h("p", { class: "v-nota" }, "Es la primera versión del programa: no hay con qué compararla.")
        : h("p", { class: "v-nota" }, [
          `Comparada con la versión ${anterior?.numero_version ?? ""}`,
          anterior ? ` · ${periodoDe(anterior)} (${etiquetaEstadoPrograma(anterior.estado)})` : "",
          r.version_anterior === st.v.version_origen_id ? ", de la que se copió esta versión." : ", la anterior del mismo período.",
        ].join("")),
      r.version_anterior && !grupos.length ? h("p", { class: "v-texto" }, "No hay diferencias de contenido.") : null,
      grupos.map((g) => h("div", { class: "p-cambios" },
        h("h3", { class: "p-cambios__titulo" }, g.titulo),
        h("ul", { class: "p-cambios__lista" }, g.cambios.map((c) => h("li", {},
          h("span", { class: "p-cambios__campo" }, c.etiqueta),
          h("span", { class: "p-cambios__antes" }, h("span", { class: "v-sr" }, "Antes: "), c.anterior),
          h("span", { class: "p-cambios__ahora" }, h("span", { class: "v-sr" }, "Ahora: "), c.actual)))))));
  }).catch((e) => poner(zona, h("h2", { class: "v-h2" }, "Cambios frente a la versión anterior"), mensaje("error", e.message)));
  return zona;
}

// ── Arranque ─────────────────────────────────────────────────
if (!versionId || !/^\d+$/.test(versionId)) {
  await sinAcceso(raiz, "Programa de curso", "Falta indicar qué versión abrir. Ábrela desde «Programas de curso».");
} else {
  await cargar();
  // Llegó desde «y N anteriores» o desde «Ver cambios» de otra versión. El id del bloque no
  // coincide con el ancla (#historial) para que el navegador no salte solo, sin descontar la barra.
  await document.fonts?.ready;
  if (st.verHistorial) irAlHistorial();
  else if (st.verCambios) desplazarA(document.getElementById("t-cambios")?.closest("section"));
}
// El encabezado fijo va debajo de la barra: su alto cambia con el ancho.
const barra = document.getElementById("barra");
const fijarAlto = () => document.documentElement.style.setProperty("--alto-barra", `${barra.offsetHeight}px`);
fijarAlto();
new ResizeObserver(fijarAlto).observe(barra);
