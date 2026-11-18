// Seguimiento de una tarea (coordinación): avance por estado, una fila por docente,
// cerrar las aprobadas, publicar o cancelar un borrador y cancelar lo no iniciado.
import { api, ApiError } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { chipEstado, chipPrioridad, plazo, fechaCorta, fechaHora, PRIORIDADES } from "../formato.js";
import { barraAvance, vacio, todasLasPaginas, tomarAviso, sinAcceso, textoDeError, botonVolver } from "../componentes.js";
import { requerirSesion } from "../sesion.js";

const raiz = document.getElementById("contenido");
const id = new URLSearchParams(location.search).get("id");
const yo = await requerirSesion();
montarBarra(yo, "tareas");

const ATENCION = ["submitted", "under_review", "returned", "in_progress", "assigned", "approved", "closed", "cancelled"];
const st = { tarea: null, tipo: null, asignaciones: [], resumen: null, aviso: tomarAviso() };

async function cargar() {
  try {
    st.tarea = await api(`/tasks/${encodeURIComponent(id)}`);
  } catch (e) {
    tituloPestana("Tarea");
    await sinAcceso(raiz, "No se pudo abrir la tarea",
      e instanceof ApiError && e.status === 404 ? "Esta tarea no existe o fue eliminada." : textoDeError(e, SIN_PERMISO));
  }
  const [tipos, asig] = await Promise.all([
    api("/task-types?per_page=100").catch(() => ({ data: [] })),
    st.tarea.status === "draft" ? Promise.resolve({ data: [], summary: null }) : todasLasPaginas(api, `/tasks/${st.tarea.id}/assignments`),
  ]);
  st.tipo = (tipos.data || []).find((x) => x.id === st.tarea.type_id) || null;
  st.asignaciones = asig.data || [];
  st.resumen = asig.summary || null;
  tituloPestana(st.tarea.title);
  pintar();
}

const conTu = (uid, n) => (n && uid === yo.id ? `${n} (tú)` : n);

function destinatarios(regla) {
  if (!regla) return "Sin definir";
  if (regla.mode === "all") return "Todos los docentes";
  if (regla.mode === "users") {
    // Publicada: los nombres salen de las asignaciones. En borrador solo se sabe cuántos son.
    const porId = new Map(st.asignaciones.map((x) => [x.assignee_id, x.assignee_name]));
    const n = (regla.user_ids || []).map((u) => porId.get(u)).filter(Boolean);
    return n.length ? (n.length <= 3 ? n.join(", ") : `${n.length} docentes elegidos`) : `${(regla.user_ids || []).length} docentes elegidos`;
  }
  if (regla.mode === "filter") return ["Docentes de", regla.unit || regla.campus].join(" ");
  return "Sin definir";
}

function pintar() {
  const t = st.tarea;
  const aviso = st.aviso;
  st.aviso = null;
  const p = plazo(t.due_date, { terminada: t.status !== "published" });
  poner(raiz,
    botonVolver({ texto: "Tareas", href: RUTAS.tareas }),
    aviso ? mensaje(aviso.tipo, aviso.texto) : null,
    h("div", { class: "v-cabecera" },
      h("div", { class: "v-fila" },
        h("span", { class: "v-eyebrow" }, st.tipo?.name || "Tarea"),
        PRIORIDADES[t.priority] ? chipPrioridad(t.priority) : null,
        chipEstado(t.status)),
      h("h1", { class: "v-h1" }, t.title),
      h("dl", { class: "v-datos" },
        t.course_code ? dato("Curso", [t.course_code, t.course_name].filter(Boolean).join(" · ")) : null,
        t.period_code ? dato("Período", t.period_code) : null,
        dato("Fecha límite", p.texto),
        dato("Revisa", t.reviewer_id != null ? conTu(t.reviewer_id, t.reviewer_name) || "Revisor designado" : `${conTu(t.created_by, t.created_by_name) || "Coordinación"} (sin revisor designado)`),
        dato("Destinatarios", destinatarios(t.recipient_rule)),
        dato("Creada por", conTu(t.created_by, t.created_by_name) || "Coordinación"))),
    t.status === "draft" ? bloqueBorrador() : null,
    t.status !== "draft" ? bloqueAvance() : null,
    h("section", { class: "v-card", "aria-labelledby": "t-inst" },
      h("h2", { id: "t-inst", class: "v-h2" }, "Instrucciones"),
      h("p", { class: "v-texto" }, t.description || "Sin instrucciones adicionales."),
      st.tipo ? h("p", { class: "v-nota" }, st.tipo.requires_evidence
        ? "Este tipo de tarea exige adjuntar un archivo para entregar."
        : "En este tipo de tarea adjuntar archivos es opcional.") : null),
    t.status === "published" ? bloqueCancelar() : null);
}

const dato = (dt, dd) => h("div", {}, h("dt", {}, dt), h("dd", {}, dd));

// ── Borrador ─────────────────────────────────────────────────
function bloqueBorrador() {
  const zona = h("div", { "aria-live": "polite" });
  const sinDestinatarios = !st.tarea.recipient_rule;
  const publicar = h("button", { type: "button", class: "v-btn", disabled: sinDestinatarios, onclick: async () => {
    publicar.disabled = true;
    try {
      const r = await api(`/tasks/${st.tarea.id}/publish`, { method: "POST" });
      st.aviso = { tipo: "ok", texto: `Tarea publicada: ${r.assignments_created} ${r.assignments_created === 1 ? "docente recibió" : "docentes recibieron"} su aviso.` };
      await cargar();
    } catch (e) { poner(zona, mensaje("error", e.message)); publicar.disabled = false; }
  } }, "Publicar");
  return h("section", { class: "v-card v-card--foco", "aria-labelledby": "t-borr" },
    h("p", { class: "v-eyebrow" }, "Borrador"),
    h("h2", { id: "t-borr", class: "v-h1", style: "font-size: 24px" }, "Todavía no se publica"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" },
      sinDestinatarios ? "Falta elegir a quién va dirigida. Termínala en el formulario y publícala."
        : "Los docentes no la ven hasta que se publique. Al publicarla, a cada uno le llega su aviso."),
    h("div", { class: "v-acciones" },
      publicar,
      h("a", { class: "v-btn v-btn--sec", href: `${RUTAS.nuevaTarea}?borrador=${encodeURIComponent(st.tarea.id)}` }, "Editar el borrador"),
      botonCancelar("Descartar borrador", "El borrador se elimina. No se puede deshacer.", zona)),
    zona);
}

// ── Avance por docente ───────────────────────────────────────
function bloqueAvance() {
  const filas = [...st.asignaciones].sort((a, b) => ATENCION.indexOf(a.status) - ATENCION.indexOf(b.status)
    || String(a.assignee_name).localeCompare(String(b.assignee_name)));
  const aprobadas = filas.filter((x) => x.status === "approved");
  const zona = h("div", { "aria-live": "polite" });
  const cerrarTodas = aprobadas.length > 1 ? h("button", { type: "button", class: "v-btn v-btn--sec", onclick: async (e) => {
    e.target.disabled = true;
    const r = await Promise.allSettled(aprobadas.map((x) => api(`/assignments/${x.id}/close`, { method: "POST" })));
    const ok = r.filter((x) => x.status === "fulfilled").length;
    const fallo = r.find((x) => x.status === "rejected");
    st.aviso = fallo ? { tipo: "error", texto: `Se cerraron ${ok} de ${aprobadas.length}. ${fallo.reason.message}` }
      : { tipo: "ok", texto: `Se cerraron ${ok} asignaciones aprobadas.` };
    await cargar();
  } }, `Cerrar las ${aprobadas.length} aprobadas`) : null;

  return h("section", { class: "v-card", "aria-labelledby": "t-av" },
    h("h2", { id: "t-av", class: "v-h2" }, "Avance por docente"),
    barraAvance(st.resumen?.by_status),
    filas.length ? h("ul", { class: "v-docentes" }, filas.map((x) => filaDocente(x, zona))) : vacio("Esta tarea no tiene asignaciones."),
    zona,
    cerrarTodas ? h("div", { class: "v-acciones" }, cerrarTodas) : null);
}

function filaDocente(x, zona) {
  const p = plazo(x.due_date, { terminada: !["assigned", "in_progress", "returned"].includes(x.status) });
  const cerrar = x.status === "approved" ? h("button", { type: "button", class: "v-btn v-btn--chico", onclick: async (e) => {
    e.target.disabled = true;
    try {
      await api(`/assignments/${x.id}/close`, { method: "POST" });
      st.aviso = { tipo: "ok", texto: `Cerrada la asignación de ${x.assignee_name}.` };
      await cargar();
    } catch (err) { poner(zona, mensaje("error", err.message)); e.target.disabled = false; }
  } }, "Cerrar") : null;
  return h("li", { class: "v-docente" },
    h("div", { class: "v-docente__quien" },
      h("span", { class: "v-docente__nombre" }, x.assignee_name || "Docente"),
      h("span", { class: "v-docente__dato" }, [x.unit || x.campus, p.estado === "vencida" ? "vencida" : null].filter(Boolean).join(" · "))),
    h("div", { class: "v-docente__estado" }, chipEstado(x.status),
      h("span", { class: "v-docente__dato", title: fechaHora(x.last_change_at) }, `Último cambio ${fechaCorta(x.last_change_at)}`)),
    h("div", { class: "v-docente__acciones" },
      cerrar,
      h("a", { class: "v-btn v-btn--sec v-btn--chico", href: RUTAS.asignacion(x.id) },
        ["submitted", "under_review"].includes(x.status) ? "Revisar" : "Ver detalle")));
}

// ── Cancelar ─────────────────────────────────────────────────
function bloqueCancelar() {
  const zona = h("div", { "aria-live": "polite" });
  const noIniciadas = st.asignaciones.filter((x) => x.status === "assigned").length;
  if (!noIniciadas) return null;
  return h("details", { class: "v-card v-plegable" },
    h("summary", { class: "v-h2" }, "Cancelar la tarea"),
    h("p", { class: "v-texto" }, `Se cancelan solo las asignaciones que no se han iniciado (${noIniciadas}). Las que ya avanzaron siguen su curso.`),
    h("div", { class: "v-acciones" }, botonCancelar("Cancelar las no iniciadas", null, zona)),
    zona);
}

function botonCancelar(texto, confirmar, zona) {
  const motivo = h("input", { type: "text", id: `motivo-cancelar`, maxlength: 300, placeholder: "Motivo (opcional)" });
  const confirmarBtn = h("button", { type: "button", class: "v-btn v-btn--peligro v-btn--chico", onclick: async () => {
    confirmarBtn.disabled = true;
    try {
      const r = await api(`/tasks/${st.tarea.id}/cancel`, { method: "POST", body: motivo.value.trim() ? { reason: motivo.value.trim() } : {} });
      if (st.tarea.status === "draft") { location.replace(`${RUTAS.tareas}#draft`); return; }
      const n = (r.cancelled_assignments || []).length;
      st.aviso = { tipo: "ok", texto: `Se cancelaron ${n} ${n === 1 ? "asignación" : "asignaciones"}.` };
      await cargar();
    } catch (e) { poner(zona, mensaje("error", e.message)); confirmarBtn.disabled = false; }
  } }, "Sí, cancelar");
  const caja = h("div", { class: "v-confirmar", hidden: true },
    confirmar ? h("p", { class: "v-nota" }, confirmar) : null,
    h("div", { class: "v-campo" }, h("label", { for: "motivo-cancelar" }, "Motivo"), motivo),
    h("div", { class: "v-acciones" }, confirmarBtn,
      h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { caja.hidden = true; abrir.hidden = false; } }, "No")));
  const abrir = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--peligro", onclick: () => { caja.hidden = false; abrir.hidden = true; motivo.focus(); } }, texto);
  return h("div", { class: "v-cabecera", style: "gap: 12px" }, abrir, caja);
}

// ── Arranque ─────────────────────────────────────────────────
const SIN_PERMISO = "El seguimiento de las tareas es de coordinación.";
if (!(yo.roles || []).some((r) => ["coordinator", "authority", "admin"].includes(r))) {
  await sinAcceso(raiz, "Seguimiento de la tarea", SIN_PERMISO);
} else if (!id || !/^\d+$/.test(id)) {
  await sinAcceso(raiz, "Seguimiento de la tarea", "Falta indicar qué tarea abrir.");
} else {
  await cargar();
}
