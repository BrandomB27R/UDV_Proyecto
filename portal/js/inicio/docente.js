// Inicio del docente (mockup vinci-inicio-docente): lo que le toca hacer y lo que espera respuesta.
// Datos: /inbox/summary (contadores) y /inbox (filas, con revisor, fecha de entrega y la
// observación de la devolución desde vinci-11). «Terminadas hace poco» sí pide el detalle de las
// aprobadas y cerradas: /inbox no trae quién aprobó ni cuándo (NOTAS_BACKEND §12).
import { api } from "../api.js";
import { RUTAS } from "../config.js";
import { h } from "../dom.js";
import { chipEstado, etiquetaTipo, fechaLimiteCorta, haceCuando, diasHasta, diasDesde } from "../formato.js";
import { indicador, vacio, todasLasPaginas } from "../componentes.js";
import { queSigue } from "../flujo.js";

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const POR_HACER = ["assigned", "in_progress", "returned"];
const EN_ESPERA = ["submitted", "under_review"];
const TERMINADAS = ["approved", "closed"];
const DIAS_AVISO = 3;
const DIAS_RECIENTES = 14;
const MAX_RECIENTES = 5;
// Cuántos detalles se piden como mucho (las asignaciones más nuevas): el inicio no recorre todo el historial.
const MAX_DETALLES = 20;

/** {titulo, contadores, bloques} del docente. */
export async function inicioDocente() {
  const [s, r] = await Promise.all([api("/inbox/summary"), todasLasPaginas(api, "/inbox")]);
  const filas = r.data || [];
  const recientes = await terminadasRecientes(filas);
  const porEstado = s.by_status || {};
  const n = (estados) => estados.reduce((t, e) => t + (Number(porEstado[e]) || 0), 0);
  const porHacer = Number(s.pending) || 0;
  const vencidas = Number(s.overdue) || 0;

  const titulo = porHacer
    ? `Tienes ${plural(porHacer, "tarea por hacer", "tareas por hacer")}${vencidas ? `; ${vencidas} ${vencidas === 1 ? "ya venció" : "ya vencieron"}` : ""}.`
    : "No tienes tareas por hacer.";

  const contadores = [
    indicador("Por hacer", porHacer, "Te toca a ti"),
    indicador("Vencidas", vencidas, "Con la fecha límite pasada", "alerta"),
    indicador("Por vencer", Number(s.due_soon) || 0, `En los próximos ${DIAS_AVISO} días`, "aviso"),
    indicador("En revisión", n(EN_ESPERA), "Entregadas, esperan respuesta"),
    indicador("Aprobadas", recientes.length, `En los últimos ${DIAS_RECIENTES} días`, "aprobadas"),
  ];

  const terminadas = n(TERMINADAS);
  const bloques = [
    tablaPorHacer(filas.filter((x) => POR_HACER.includes(x.status))),
    tablaEnEspera(filas.filter((x) => EN_ESPERA.includes(x.status))),
    tablaTerminadas(recientes.slice(0, MAX_RECIENTES)),
    h("p", { class: "ini-pie" },
      h("a", { href: RUTAS.misTareas }, "Ver todas mis tareas"),
      terminadas ? ` · incluye ${terminadas === 1 ? "la terminada" : `las ${terminadas} terminadas`}` : null),
  ];
  return { titulo, contadores, bloques, porHacer };
}

const subtitulo = (x) => [etiquetaTipo(x.task_type), x.course_code, x.period_code].filter(Boolean).join(" · ");

function celdaTarea(x) {
  return h("div", { class: "pn-tarea" }, h("a", { href: RUTAS.asignacion(x.id) }, x.title || "Tarea"), h("span", {}, subtitulo(x)));
}

function celdaFecha(f) {
  return h("div", { class: "tr-fecha" },
    h("strong", {}, f.dia),
    f.rel ? h("span", { class: `tr-fecha__rel${f.estado ? ` tr-fecha__rel--${f.estado}` : ""}` }, f.rel) : null);
}

// Vencidas (la más atrasada arriba), por vencer, y luego por fecha límite; sin fecha al final.
function ordenUrgencia(a, b) {
  const clave = (x) => [x._f.estado === "vencida" ? 0 : x._f.estado === "por-vencer" ? 1 : 2, x._dias ?? Infinity];
  const [ga, da] = clave(a);
  const [gb, db] = clave(b);
  return ga - gb || da - db || a.id - b.id;
}

function tablaPorHacer(filas) {
  for (const x of filas) {
    x._f = fechaLimiteCorta(x.due_at, { diasAviso: DIAS_AVISO });
    x._dias = diasHasta(x.due_at);
  }
  filas.sort(ordenUrgencia);
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-tuyo" },
    h("div", { class: "ini-cab" },
      h("h2", { id: "t-tuyo", class: "v-h2" }, "Te toca a ti"),
      filas.length ? h("p", { class: "v-nota" }, "Primero lo más urgente.") : null),
    filas.length ? h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Tareas que te tocan, primero las más urgentes"),
      h("thead", {}, h("tr", {}, ["Tarea", "Estado", "Qué sigue", "Fecha límite"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => {
        const q = queSigue(x);
        return h("tr", { class: `pn-fila${x._f.estado ? ` pn-fila--${x._f.estado}` : ""}` },
          h("td", { "data-etiqueta": "Tarea" }, celdaTarea(x)),
          h("td", { "data-etiqueta": "Estado" }, chipEstado(x.status)),
          h("td", { "data-etiqueta": "Qué sigue" }, h("div", { class: "ini-sigue" }, h("strong", {}, q.frase), h("span", {}, q.detalle))),
          h("td", { "data-etiqueta": "Fecha límite" }, celdaFecha(x._f)),
          h("td", { class: "pn-accion ini-accion" },
            h("a", { class: "v-btn v-btn--chico", href: RUTAS.asignacion(x.id), "aria-label": `${q.boton}: ${x.title}` }, q.boton)));
      })))
      : vacio("No tienes nada pendiente. Las tareas nuevas aparecerán aquí."));
}

/**
 * Aprobadas o cerradas en los últimos 14 días, la más reciente primero. La fecha es la última
 * aprobación o cierre del historial; «Aprobó» sale de last_approval.
 */
async function terminadasRecientes(filas) {
  const candidatas = filas.filter((x) => TERMINADAS.includes(x.status)).sort((a, b) => b.id - a.id).slice(0, MAX_DETALLES);
  const con = await Promise.all(candidatas.map(async (x) => {
    const d = await api(`/assignments/${encodeURIComponent(x.id)}`).catch(() => null);
    if (!d) return null;
    const fin = (d.history || []).filter((e) => TERMINADAS.includes(e.new_status) && e.at).map((e) => e.at).sort().pop() || d.last_approval?.at;
    const dias = diasDesde(fin);
    if (dias == null || dias > DIAS_RECIENTES) return null;
    return { ...x, status: d.status, fin, aprobo: d.last_approval?.actor || null, aprobadoEn: d.last_approval?.at || null };
  }));
  return con.filter(Boolean).sort((a, b) => String(b.fin).localeCompare(String(a.fin)) || b.id - a.id);
}

function tablaTerminadas(filas) {
  if (!filas.length) return null;
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-terminadas" },
    h("div", { class: "ini-cab ini-cab--enlace" },
      h("div", { class: "ini-cab" },
        h("h2", { id: "t-terminadas", class: "v-h2" }, "Terminadas hace poco"),
        h("p", { class: "v-nota" }, `Lo que ya te aprobaron en los últimos ${DIAS_RECIENTES} días. No tienes que hacer nada más.`)),
      h("a", { class: "ini-enlace", href: `${RUTAS.misTareas}#terminadas` }, "Ver todas las terminadas")),
    h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, `Tareas aprobadas o cerradas en los últimos ${DIAS_RECIENTES} días`),
      h("thead", {}, h("tr", {}, ["Tarea", "Estado", "Aprobó"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => h("tr", { class: "pn-fila pn-fila--terminada" },
        h("td", { "data-etiqueta": "Tarea" }, celdaTarea(x)),
        h("td", { "data-etiqueta": "Estado" }, h("div", { class: "ini-estado" }, chipEstado(x.status),
          x.status === "approved" ? h("span", {}, "Coordinación la cerrará") : null)),
        h("td", { "data-etiqueta": "Aprobó" }, h("div", { class: "pn-tarea" },
          h("strong", {}, x.aprobo || "—"), x.aprobadoEn ? h("span", {}, haceCuando(x.aprobadoEn)) : null)),
        h("td", { class: "pn-accion" }, h("a", { href: RUTAS.asignacion(x.id), "aria-label": `Ver: ${x.title}` }, "Ver")))))));
}

// Quién tiene la entrega y cuándo se entregó: reviewer_name y submitted_at de /inbox (vinci-11).
// Si una fila no los trae, lo dice sin nombre; sin ninguna fecha, la columna «Entregada» no se muestra.
function quienLaTiene(x) {
  const r = x.reviewer_name;
  if (x.status === "under_review") return r ? ["La revisa ", h("strong", {}, r)] : "Ya la están revisando";
  return r ? ["Espera a que ", h("strong", {}, r), " la tome"] : "Espera a que la tomen para revisarla";
}

function tablaEnEspera(filas) {
  if (!filas.length) return null;
  const conFecha = filas.some((x) => x.submitted_at);
  const columnas = ["Tarea", "Estado", "Quién la tiene", ...(conFecha ? ["Entregada"] : [])];
  return h("section", { class: "v-card pn-seccion ini-seccion--discreta", "aria-labelledby": "t-espera" },
    h("div", { class: "ini-cab" },
      h("h2", { id: "t-espera", class: "v-h2" }, "En espera de revisión"),
      h("p", { class: "v-nota" }, "No tienes que hacer nada; te avisamos cuando respondan.")),
    h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Entregas que esperan revisión"),
      h("thead", {}, h("tr", {}, columnas.map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => h("tr", { class: "pn-fila" },
        h("td", { "data-etiqueta": "Tarea" }, celdaTarea(x)),
        h("td", { "data-etiqueta": "Estado" }, chipEstado(x.status)),
        h("td", { "data-etiqueta": "Quién la tiene" }, h("span", {}, quienLaTiene(x))),
        conFecha ? h("td", { "data-etiqueta": "Entregada", class: "pn-fecha" }, x.submitted_at ? `Entregada ${haceCuando(x.submitted_at)}` : "—") : null,
        h("td", { class: "pn-accion" }, h("a", { href: RUTAS.asignacion(x.id), "aria-label": `Ver: ${x.title}` }, "Ver")))))));
}
