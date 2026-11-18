// Tareas (coordinación), mockup vinci-tareas: tabla con avance por tarea, filtros y resumen.
// El avance de cada tarea viene en una sola consulta: GET /tasks?include=progress (PR #60).
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner } from "../dom.js";
import { etiquetaTipo, fechaDia, diasHasta } from "../formato.js";
import { vacio, sinAcceso, textoDeError, todasLasPaginas } from "../componentes.js";
import { requerirSesion } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "tareas");
tituloPestana("Tareas");

const SIN_PERMISO = "«Tareas» es de coordinación: ahí se crean las tareas y se sigue su avance.";
if (!(yo.roles || []).includes("coordinator")) await sinAcceso(raiz, "Tareas", SIN_PERMISO);

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const PENDIENTES = ["assigned", "in_progress", "returned"];
const DIAS_AVISO = 3;

// ── Datos ────────────────────────────────────────────────────
let tareas = [];
const tipos = new Map();
try {
  const [t, ty] = await Promise.all([todasLasPaginas(api, "/tasks?include=progress"), api("/task-types?per_page=100")]);
  tareas = t.data || [];
  for (const x of ty?.data || []) tipos.set(x.id, x);
} catch (e) {
  await sinAcceso(raiz, "Tareas", textoDeError(e, SIN_PERMISO));
}
for (const t of tareas) t._av = avance(t);

/** Conteos de una tarea a partir de progress: {total, done, to_review, overdue_pending, by_status, assignee_name, assignee_names}.
 *  nombres (todos los destinatarios, sin cancelados) se usa para buscar por docente. */
function avance(t) {
  const p = t.progress || {};
  const por = p.by_status || {};
  const n = (e) => Number(por[e]) || 0;
  const total = Number(p.total) || 0;                      // sin las canceladas
  const terminadas = Number(p.done) || 0;
  const pendientes = PENDIENTES.reduce((s, e) => s + n(e), 0);
  const entregas = Object.keys(por).some((e) => !["assigned", "in_progress", "cancelled"].includes(e) && n(e) > 0);
  return {
    total, terminadas, porRevisar: Number(p.to_review) || 0, pendientes, vencidas: Number(p.overdue_pending) || 0,
    dias: diasHasta(t.due_date), entregas, nombres: Array.isArray(p.assignee_names) ? p.assignee_names : (p.assignee_name ? [p.assignee_name] : []), todas: total > 0 && terminadas === total,
    leido: !!t.progress,
  };
}

/** "María García", "5 docentes" o "Todos los docentes · 12". */
function asignadaA(t) {
  const regla = t.recipient_rule || {};
  const av = t._av;
  const n = t.status === "draft" ? (regla.mode === "users" ? (regla.user_ids || []).length : null) : av.total;
  if (regla.mode === "all") return n != null ? `Todos los docentes · ${n}` : "Todos los docentes";
  if (regla.mode === "filter") return `Docentes de ${regla.unit || regla.campus}${n != null ? ` · ${n}` : ""}`;
  if (n === 1) return t.progress?.assignee_name || av.nombres[0] || "1 docente";
  return n != null ? `${n} docentes` : "Sin destinatarios";
}

/** Color de la fila: rojo si venció con pendientes, ámbar si vence en 3 días o menos con pendientes. */
function urgencia(t) {
  const av = t._av;
  if (t.status !== "published" || av.todas || !av.pendientes || av.dias == null) return "";
  if (av.dias < 0) return "vencida";
  if (av.dias <= DIAS_AVISO) return "por-vencer";
  return "";
}

// ── Filtros ──────────────────────────────────────────────────
const GRUPOS = [
  { id: "published", texto: "Publicadas" },
  { id: "draft", texto: "Borradores" },
  { id: "cancelled", texto: "Canceladas" },
];
const MOSTRAR = {
  todas: { texto: "Todas", ok: () => true },
  revisar: { texto: "Con entregas por revisar", ok: (t) => t._av.porRevisar > 0 },
  vencidas: { texto: "Con vencidas", ok: (t) => t._av.vencidas > 0 },
  terminadas: { texto: "Terminadas", ok: (t) => t._av.todas },
};
const frac = (t) => (t._av.total ? t._av.terminadas / t._av.total : 0);
const ORDENAR = {
  fecha: { texto: "Fecha límite", cmp: (a, b) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")) },
  recientes: { texto: "Más recientes", cmp: (a, b) => String(b.created_at).localeCompare(String(a.created_at)) },
  avance: { texto: "Avance (menor primero)", cmp: (a, b) => frac(a) - frac(b) },
};
const st = { grupo: GRUPOS.find((g) => `#${g.id}` === location.hash)?.id || "published", buscar: "", tipo: "", mostrar: "todas", ordenar: "fecha" };

const puedeCrear = (yo.roles || []).includes("coordinator");
const zonaPestanas = h("div", { class: "pn-filtros", role: "group", "aria-label": "Estado de la tarea" });
const zonaResumen = h("div");
const zonaTabla = h("div");
const control = (id, etiqueta, nodo) => h("div", { class: "v-campo tr-control" }, h("label", { for: id }, etiqueta), nodo);
const sel = (id, opciones, valor, alCambiar) => h("select", { id, onchange: (e) => alCambiar(e.target.value) },
  Object.entries(opciones).map(([v, t]) => h("option", { value: v, selected: v === valor }, t)));
const opcionesTipo = { "": "Todos los tipos", ...Object.fromEntries([...tipos.values()].map((t) => [String(t.id), t.name])) };

poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("div", { class: "v-cabecera", style: "gap: 6px" },
      h("h1", { class: "v-h1" }, "Tareas"),
      h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, "Lo que coordinación asignó y cómo va cada tarea.")),
    puedeCrear ? h("a", { class: "v-btn", href: RUTAS.nuevaTarea }, "Nueva tarea") : null),
  h("section", { class: "v-card tr-card", "aria-label": "Tareas" },
    zonaPestanas,
    h("div", { class: "tr-controles" },
      control("buscar", "Buscar", h("input", { id: "buscar", type: "search", placeholder: "Título, curso o docente", autocomplete: "off",
        oninput: (e) => { st.buscar = e.target.value.trim().toLowerCase(); pintarTabla(); } })),
      control("f-tipo", "Tipo", sel("f-tipo", opcionesTipo, st.tipo, (v) => { st.tipo = v; pintarTabla(); })),
      control("f-mostrar", "Mostrar", sel("f-mostrar", Object.fromEntries(Object.entries(MOSTRAR).map(([k, v]) => [k, v.texto])), st.mostrar, (v) => { st.mostrar = v; pintarTabla(); })),
      control("f-orden", "Ordenar por", sel("f-orden", Object.fromEntries(Object.entries(ORDENAR).map(([k, v]) => [k, v.texto])), st.ordenar, (v) => { st.ordenar = v; pintarTabla(); }))),
    zonaResumen,
    zonaTabla));
pintarPestanas();
pintarTabla();

function pintarPestanas() {
  poner(zonaPestanas, GRUPOS.map((g) => h("button", {
    type: "button", class: "pn-filtro", "aria-pressed": String(g.id === st.grupo),
    onclick: () => { st.grupo = g.id; history.replaceState(null, "", `#${g.id}`); pintarPestanas(); pintarTabla(); },
  }, g.texto, " ", h("span", { class: "pn-filtro__n" }, String(tareas.filter((t) => t.status === g.id).length)))));
}

function pintarResumen() {
  const pub = tareas.filter((t) => t.status === "published");
  const cuenta = (f) => pub.filter(f).length;
  poner(zonaResumen, st.grupo !== "published" ? null : h("p", { class: "tr-resumen" },
    h("span", {}, h("strong", {}, String(pub.length)), ` ${pub.length === 1 ? "tarea publicada" : "tareas publicadas"}`),
    h("span", {}, h("strong", { class: "tr-n--terminada" }, String(cuenta((t) => t._av.todas))), " terminadas"),
    h("span", {}, h("strong", { class: "tr-n--revisar" }, String(cuenta((t) => t._av.porRevisar > 0))), " con entregas por revisar"),
    h("span", {}, h("strong", { class: "tr-n--vencida" }, String(cuenta((t) => t._av.vencidas > 0))), " con docentes vencidos")));
}

function coincide(t) {
  if (t.status !== st.grupo) return false;
  if (st.tipo && String(t.type_id) !== st.tipo) return false;
  if (!MOSTRAR[st.mostrar].ok(t)) return false;
  if (!st.buscar) return true;
  return [t.title, t.course_code, t.course_name, ...t._av.nombres].filter(Boolean).join(" ").toLowerCase().includes(st.buscar);
}

function pintarTabla() {
  pintarResumen();
  const filas = tareas.filter(coincide).sort(ORDENAR[st.ordenar].cmp);
  if (!filas.length) {
    const hay = tareas.some((t) => t.status === st.grupo);
    poner(zonaTabla, vacio(hay ? "Ninguna tarea coincide con los filtros." : { published: "No hay tareas publicadas.", draft: "No hay borradores.", cancelled: "No hay tareas canceladas." }[st.grupo],
      !hay && st.grupo !== "cancelled" && puedeCrear ? { texto: "Crear una tarea", href: RUTAS.nuevaTarea } : null));
    return;
  }
  poner(zonaTabla, h("table", { class: "pn-tabla tr-tabla" },
    h("caption", { class: "v-sr" }, `Tareas: ${GRUPOS.find((g) => g.id === st.grupo).texto.toLowerCase()}`),
    h("thead", {}, h("tr", {}, ["Tarea", "Asignada a", "Avance", "Fecha límite"].map((x) => h("th", { scope: "col" }, x)),
      h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
    h("tbody", {}, filas.map(fila))));
}

function fila(t) {
  const tipo = tipos.get(t.type_id);
  const sub = [tipo?.name || etiquetaTipo(""), t.course_code, t.period_code].filter(Boolean).join(" · ");
  const u = urgencia(t);
  const href = `/app/tarea.html?id=${encodeURIComponent(t.id)}`;
  const accion = t.status === "draft" ? "Abrir borrador" : "Ver avance";
  return h("tr", { class: `pn-fila${u ? ` pn-fila--${u}` : ""}` },
    h("td", { "data-etiqueta": "Tarea" }, h("div", { class: "pn-tarea" }, h("a", { href }, t.title), sub ? h("span", {}, sub) : null)),
    h("td", { "data-etiqueta": "Asignada a" }, h("strong", {}, asignadaA(t))),
    h("td", { "data-etiqueta": "Avance" }, celdaAvance(t)),
    h("td", { "data-etiqueta": "Fecha límite" }, celdaFecha(t)),
    h("td", { class: "pn-accion" }, h("a", { href, "aria-label": `${accion}: ${t.title}` }, accion)));
}

function celdaAvance(t) {
  const av = t._av;
  if (t.status === "draft") return h("span", { class: "v-nota" }, "Borrador · sin publicar");
  if (!av.leido) return h("span", { class: "v-nota" }, "No se pudo leer el avance.");
  const notas = [];
  if (av.porRevisar) notas.push(h("span", { class: "tr-n--revisar" }, `${av.porRevisar} por revisar`));
  if (av.vencidas) notas.push(h("span", { class: "tr-n--vencida" }, plural(av.vencidas, "vencida", "vencidas")));
  const texto = notas.length ? notas.flatMap((x, i) => (i ? [" · ", x] : [x]))
    : av.todas ? "Todas terminadas" : !av.entregas ? "Sin entregas todavía" : "Sin entregas por revisar";
  return h("div", { class: "tr-avance" },
    h("div", { class: "tr-avance__fila" },
      h("div", { class: "tr-avance__barra", role: "img", "aria-label": `${av.terminadas} de ${av.total} terminadas` },
        h("span", { style: `width: ${av.total ? Math.round((av.terminadas / av.total) * 100) : 0}%` })),
      h("span", { class: "tr-avance__n" }, `${av.terminadas} de ${av.total}`)),
    h("span", { class: "tr-avance__nota" }, texto));
}

function celdaFecha(t) {
  const av = t._av;
  const u = urgencia(t);
  const d = av.dias;
  const rel = d == null ? "" : t.status === "published" && av.todas ? "terminada"
    : d < 0 ? `venció hace ${plural(-d, "día", "días")}` : d === 0 ? "vence hoy" : d === 1 ? "vence mañana" : `faltan ${d} días`;
  return h("div", { class: "tr-fecha" },
    h("strong", {}, fechaDia(t.due_date)),
    rel ? h("span", { class: `tr-fecha__rel${u ? ` tr-fecha__rel--${u}` : ""}` }, rel) : null);
}
