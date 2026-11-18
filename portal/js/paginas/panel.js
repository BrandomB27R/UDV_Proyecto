// Panel de cumplimiento (coordinación, dirección, administración y auditoría), mockup vinci-panel.
// Cuatro indicadores; una sola tabla "Requieren atención" (por revisar + vencidas + por vencer, con
// filtros); y "Por docente". Fuentes: /dashboard, /review-queue, /tasks y /tasks/{id}/assignments.
import { api } from "../api.js";
import { montarBarra, puedeVerPanel } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { chipEstado, etiquetaTipo, fechaCorta, fechaHora, fechaDia, diasHasta, diasDesde, haceDias } from "../formato.js";
import { sinAcceso, textoDeError, todasLasPaginas } from "../componentes.js";
import { requerirSesion, puedeRevisar, tieneRol } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "panel");
tituloPestana("Panel");

const SIN_PERMISO = "El panel de cumplimiento es para coordinación, dirección, administración y auditoría.";
if (!puedeVerPanel(yo)) await sinAcceso(raiz, "Panel", SIN_PERMISO);

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const PENDIENTES = ["assigned", "in_progress", "returned"];

// ── Datos ────────────────────────────────────────────────────
let d;
try {
  d = await api("/dashboard?limit=100");
} catch (e) {
  await sinAcceso(raiz, "Panel", textoDeError(e, SIN_PERMISO));
}
// La cola de revisión y las tareas no las pueden leer todos los perfiles del panel: se decide por los
// roles de /me antes de pedirlas (G4: revisión, coordinación o admin; G3: coordinación, revisión o dirección).
const puedeListarTareas = tieneRol(yo, "coordinator", "reviewer", "authority");
const [cola, tareasR, tiposR] = await Promise.all([
  puedeRevisar(yo) ? todasLasPaginas(api, "/review-queue").catch(() => null) : Promise.resolve(null),
  puedeListarTareas ? todasLasPaginas(api, "/tasks?status=published").catch(() => null) : Promise.resolve(null),
  api("/task-types?per_page=100").catch(() => ({ data: [] })),
]);
const tipos = new Map((tiposR.data || []).map((t) => [t.id, t.name]));
const tareas = new Map((tareasR?.data || []).map((t) => [t.id, t]));
// Una llamada por tarea publicada para "Por docente" (NOTAS_BACKEND.md: se ahorra con una ruta agregada).
const asignaciones = tareasR
  ? (await Promise.all([...tareas.keys()].map((id) => todasLasPaginas(api, `/tasks/${id}/assignments`).then((r) => r.data || []).catch(() => [])))).flat()
  : null;

const porEstado = d.assignments?.by_state || {};
const n = (e) => Number(porEstado[e]) || 0;
const totalPorRevisar = n("submitted") + n("under_review");
const c = d.compliance || {};
const pct = c.percentage == null ? null : Number(c.percentage);

const subtitulo = (taskId, codigoTipo) => {
  const t = tareas.get(taskId);
  const tipo = t ? tipos.get(t.type_id) : codigoTipo ? etiquetaTipo(codigoTipo) : null;
  return [tipo, t?.course_code].filter(Boolean).join(" · ");
};

// ── Requieren atención ──────────────────────────────────────
const revisar = (cola?.data || []).filter((x) => ["submitted", "under_review"].includes(x.status)).map((x) => {
  const dias = diasDesde(x.submitted_at) ?? 0;
  return { clase: "revisar", orden: -dias, etiqueta: `Por revisar · ${haceDias(dias)}`, accion: "Revisar",
    aid: x.id, titulo: x.title, sub: [etiquetaTipo(x.task_type), x.course_code].filter(Boolean).join(" · "),
    docente: x.teacher, estado: x.status, fecha: x.due_at };
}).sort((a, b) => a.orden - b.orden);
const vencidas = (d.overdue?.items || []).map((x) => {
  const dias = -(diasHasta(x.due_date) ?? 0);
  return { clase: "vencida", orden: -dias, etiqueta: dias <= 0 ? "Vence hoy" : `Vencida hace ${plural(dias, "día", "días")}`, accion: "Abrir",
    aid: x.assignment_id, titulo: x.task_title, sub: subtitulo(x.task_id), docente: x.user_name || x.user_email, estado: x.state, fecha: x.due_date };
}).sort((a, b) => a.orden - b.orden);
const porVencer = (d.due_soon?.items || []).map((x) => {
  const dias = diasHasta(x.due_date) ?? 0;
  return { clase: "por-vencer", orden: dias, etiqueta: dias <= 0 ? "Vence hoy" : dias === 1 ? "Vence mañana" : `Vence en ${dias} días`, accion: "Abrir",
    aid: x.assignment_id, titulo: x.task_title, sub: subtitulo(x.task_id), docente: x.user_name || x.user_email, estado: x.state, fecha: x.due_date };
}).sort((a, b) => a.orden - b.orden);

const FILTROS = [
  { id: "todas", texto: "Todas", filas: [...revisar, ...vencidas, ...porVencer] },
  { id: "revisar", texto: "Por revisar", filas: revisar, clase: "revisar" },
  { id: "vencidas", texto: "Vencidas", filas: vencidas, clase: "vencida" },
  { id: "por-vencer", texto: "Por vencer", filas: porVencer, clase: "por-vencer" },
];
let filtro = FILTROS.find((x) => `#${x.id}` === location.hash)?.id || "todas";

// ── Por docente ─────────────────────────────────────────────
function porDocente() {
  const m = new Map();
  const de = (id, nombre) => {
    if (!m.has(id)) m.set(id, { nombre, asignadas: asignaciones ? 0 : null, vencidas: 0, porVencer: 0, porRevisar: 0, terminadas: asignaciones ? 0 : null });
    const x = m.get(id);
    if (!x.nombre && nombre) x.nombre = nombre;
    return x;
  };
  for (const a of asignaciones || []) {
    if (a.status === "cancelled") continue;
    const x = de(a.assignee_id, a.assignee_name);
    x.asignadas += 1;
    if (["approved", "closed"].includes(a.status)) x.terminadas += 1;
    if (!cola && ["submitted", "under_review"].includes(a.status)) x.porRevisar += 1;
  }
  for (const it of d.overdue?.items || []) de(it.user_id, it.user_name).vencidas += 1;
  for (const it of d.due_soon?.items || []) de(it.user_id, it.user_name).porVencer += 1;
  for (const q of revisar) { const x = (cola?.data || []).find((y) => y.id === q.aid); if (x) de(x.assignee_id, x.teacher).porRevisar += 1; }
  return [...m.values()].sort((a, b) => b.vencidas - a.vencidas || b.porVencer - a.porVencer || b.porRevisar - a.porRevisar
    || String(a.nombre).localeCompare(String(b.nombre)));
}

// ── Pintado ──────────────────────────────────────────────────
const tablaAtencion = h("div");
poner(raiz,
  h("div", { class: "pn-cab" },
    h("h1", { class: "v-h1" }, "Panel de cumplimiento"),
    h("p", { class: "v-nota", title: fechaHora(d.generated_at) }, `Actualizado: ${fechaCorta(d.generated_at)} · cuenta las asignaciones publicadas, sin las canceladas`)),
  h("section", { class: "v-indicadores", "aria-label": "Indicadores" },
    indicador("Cumplimiento", pct == null ? "—" : `${pct.toLocaleString("es-GT", { maximumFractionDigits: 1 })} %`,
      c.expected ? `${c.completed} de ${c.expected} asignaciones ya entregadas` : "Todavía no hay asignaciones"),
    indicador("Vencidas", String(d.overdue?.total ?? 0), "Pendientes con la fecha límite pasada", "alerta"),
    indicador("Por vencer", String(d.due_soon?.total ?? 0), `Vencen en los próximos ${d.due_soon_days ?? 3} días`, "aviso"),
    indicador("Por revisar", String(totalPorRevisar), "Entregadas o en revisión", "revisar")),
  h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-atencion" },
    h("div", { class: "pn-seccion__cab" },
      h("div", {},
        h("h2", { id: "t-atencion", class: "v-h2" }, "Requieren atención"),
        h("p", { class: "v-nota" }, "Primero lo que toca revisar, luego lo más atrasado. Cada fila es la tarea de un docente.")),
      h("div", { class: "pn-filtros", role: "group", "aria-label": "Filtrar" }, FILTROS.map((x) => h("button", {
        type: "button", class: "pn-filtro", "aria-pressed": String(x.id === filtro),
        onclick: (e) => {
          filtro = x.id; history.replaceState(null, "", `#${x.id}`);
          e.currentTarget.parentElement.querySelectorAll(".pn-filtro").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          pintarAtencion();
        },
      }, x.texto, " ", h("span", { class: `pn-filtro__n${x.clase ? ` pn-filtro__n--${x.clase}` : ""}` }, String(x.filas.length)))))),
    avisosDeDatos(),
    tablaAtencion),
  seccionDocentes());
pintarAtencion();

function indicador(titulo, valor, detalle, tono = "") {
  return h("div", { class: `v-indicador${tono ? ` v-indicador--${tono}` : ""}` },
    h("span", { class: "v-indicador__titulo" }, titulo),
    h("span", { class: "v-indicador__valor" }, valor),
    h("span", { class: "v-indicador__detalle" }, detalle));
}

/** Cuando el perfil no puede leer la cola o la lista pasa del límite, se dice (los números de arriba no cambian). */
function avisosDeDatos() {
  const avisos = [];
  if (!cola && totalPorRevisar) avisos.push(`Las ${totalPorRevisar} entregas por revisar no se listan: la bandeja de revisión es de revisión, coordinación y administración.`);
  if ((d.overdue?.total ?? 0) > vencidas.length) avisos.push(`Se muestran ${vencidas.length} de ${d.overdue.total} vencidas.`);
  if ((d.due_soon?.total ?? 0) > porVencer.length) avisos.push(`Se muestran ${porVencer.length} de ${d.due_soon.total} por vencer.`);
  return avisos.length ? mensaje("info", avisos.join(" ")) : null;
}

function pintarAtencion() {
  const f = FILTROS.find((x) => x.id === filtro);
  if (!f.filas.length) {
    poner(tablaAtencion, h("p", { class: "v-vacio pn-vacio" }, f.id === "todas" ? "Nada requiere atención: no hay entregas por revisar ni plazos en riesgo." : "No hay nada en este grupo."));
    return;
  }
  poner(tablaAtencion, h("table", { class: "pn-tabla" },
    h("caption", { class: "v-sr" }, `Requieren atención: ${f.texto.toLowerCase()}`),
    h("thead", {}, h("tr", {}, ["Plazo", "Tarea", "Docente", "Estado", "Fecha límite"].map((t) => h("th", { scope: "col" }, t)),
      h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
    h("tbody", {}, f.filas.map((x) => h("tr", { class: `pn-fila pn-fila--${x.clase}` },
      h("td", { "data-etiqueta": "Plazo" }, h("span", { class: `pn-plazo pn-plazo--${x.clase}` }, x.etiqueta)),
      h("td", { "data-etiqueta": "Tarea" }, h("div", { class: "pn-tarea" },
        h("a", { href: RUTAS.asignacion(x.aid) }, x.titulo || "Tarea"),
        x.sub ? h("span", {}, x.sub) : null)),
      h("td", { "data-etiqueta": "Docente" }, h("strong", {}, x.docente || "—")),
      h("td", { "data-etiqueta": "Estado" }, chipEstado(x.estado)),
      h("td", { "data-etiqueta": "Fecha límite", class: "pn-fecha" }, fechaDia(x.fecha)),
      h("td", { class: "pn-accion" }, h("a", { href: RUTAS.asignacion(x.aid), "aria-label": `${x.accion}: ${x.titulo} de ${x.docente}` }, x.accion)))))));
}

function seccionDocentes() {
  const filas = porDocente();
  const celda = (valor, clase, etiqueta) => h("td", { "data-etiqueta": etiqueta, class: `pn-num${valor ? ` pn-num--${clase}` : " pn-num--cero"}` }, valor == null ? "—" : String(valor));
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-docentes" },
    h("div", {},
      h("h2", { id: "t-docentes", class: "v-h2" }, "Por docente"),
      h("p", { class: "v-nota" }, "Quién tiene qué pendiente. Ordenado por vencidas.")),
    !asignaciones ? mensaje("info", "Asignadas y terminadas no se muestran: tu perfil no lista las tareas.") : null,
    filas.length ? h("table", { class: "pn-tabla pn-tabla--docentes" },
      h("caption", { class: "v-sr" }, "Pendientes por docente"),
      h("thead", {}, h("tr", {}, ["Docente", "Asignadas", "Vencidas", "Por vencer", "Por revisar", "Terminadas", "Avance"].map((t, i) =>
        h("th", { scope: "col", class: i && i < 6 ? "pn-num" : null }, t)))),
      h("tbody", {}, filas.map((x) => {
        const avance = x.asignadas ? x.terminadas / x.asignadas : null;
        return h("tr", {},
          h("th", { scope: "row", "data-etiqueta": "Docente" }, x.nombre || "Docente"),
          h("td", { "data-etiqueta": "Asignadas", class: "pn-num" }, x.asignadas == null ? "—" : String(x.asignadas)),
          celda(x.vencidas, "vencida", "Vencidas"),
          celda(x.porVencer, "por-vencer", "Por vencer"),
          celda(x.porRevisar, "revisar", "Por revisar"),
          celda(x.terminadas, "terminada", "Terminadas"),
          h("td", { "data-etiqueta": "Avance" }, avance == null ? "—"
            : h("div", { class: "pn-barra", role: "img", "aria-label": `${x.terminadas} de ${x.asignadas} terminadas` },
              h("span", { style: `width: ${Math.round(avance * 100)}%` }))));
      }))) : h("p", { class: "v-vacio pn-vacio" }, "Todavía no hay asignaciones."));
}
