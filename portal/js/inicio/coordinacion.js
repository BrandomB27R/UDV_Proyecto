// Inicio de coordinación, revisión y dirección (mockup vinci-inicio-coordinacion).
// Cada consulta se pide solo si el rol la puede leer (sin ningún 403), según los roles de /me:
//   /review-queue  revisión, coordinación y administración (G4)
//   /dashboard     coordinación, dirección, administración y auditoría (G6)
//   /tasks         coordinación, revisión y dirección (G3)
import { api } from "../api.js";
import { RUTAS } from "../config.js";
import { h } from "../dom.js";
import { chipEstado, etiquetaTipo, fechaLimiteCorta, haceCuando, diasDesde, diasHasta } from "../formato.js";
import { indicador, vacio, todasLasPaginas } from "../componentes.js";
import { tieneRol, puedeRevisar } from "../sesion.js";
import { puedeVerPanel } from "../barra.js";

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const PENDIENTES_REVISION = ["submitted", "under_review"];
const MAX_SEGUIMIENTO = 5;
const DIAS_ENTREGA_VIEJA = 7;

/** Qué puede leer quien mira (por roles, antes de pedir nada). */
export function lecturasDe(yo) {
  return { cola: puedeRevisar(yo), panel: puedeVerPanel(yo), tareas: tieneRol(yo, "coordinator", "reviewer", "authority") };
}

/** {titulo, contadores, bloques, accion} de coordinación, revisión o dirección. */
export async function inicioCoordinacion(yo) {
  const lee = lecturasDe(yo);
  const [cola, panel, tareas, tipos] = await Promise.all([
    lee.cola ? todasLasPaginas(api, "/review-queue") : null,
    lee.panel ? api(`/dashboard?limit=${MAX_SEGUIMIENTO}`) : null,
    lee.tareas ? todasLasPaginas(api, "/tasks?include=progress") : null,
    lee.panel ? api("/task-types?per_page=100").catch(() => ({ data: [] })) : null,
  ]);

  // Solo lo que le toca a quien mira (mine): primero las que ya tomó, luego la entrega más antigua.
  const mias = (cola?.data || []).filter((x) => x.mine && PENDIENTES_REVISION.includes(x.status)).sort((a, b) =>
    (a.status === "under_review" ? 0 : 1) - (b.status === "under_review" ? 0 : 1)
    || String(a.submitted_at || "").localeCompare(String(b.submitted_at || "")) || a.id - b.id);
  const tomadas = mias.filter((x) => x.status === "under_review").length;
  const vencidas = Number(panel?.overdue?.total) || 0;
  const porVencer = Number(panel?.due_soon?.total) || 0;

  let titulo;
  if (lee.cola) titulo = mias.length ? `Tienes ${plural(mias.length, "entrega por revisar", "entregas por revisar")}.` : "No tienes entregas por revisar.";
  else if (lee.panel) titulo = vencidas || porVencer
    ? `Hay ${plural(vencidas, "tarea vencida", "tareas vencidas")} y ${porVencer} por vencer.` : "No hay tareas vencidas ni por vencer.";
  else titulo = "No tienes nada pendiente por hoy.";

  const contadores = [];
  if (lee.cola) contadores.push(indicador("Por revisar", mias.length,
    tomadas ? `${tomadas} ${tomadas === 1 ? "ya la tomaste" : "ya las tomaste"}` : "Ninguna tomada todavía", "revisar"));
  if (lee.panel) {
    contadores.push(indicador("Vencidas", vencidas, "Docentes con la fecha pasada", "alerta"));
    contadores.push(indicador("Por vencer", porVencer, `En los próximos ${panel.due_soon_days ?? 3} días`, "aviso"));
  }
  if (lee.tareas) {
    const lista = tareas.data || [];
    const publicadas = lista.filter((t) => t.status === "published");
    const terminadas = publicadas.filter((t) => Number(t.progress?.total) > 0 && Number(t.progress?.done) === Number(t.progress?.total)).length;
    const borradores = lista.filter((t) => t.status === "draft").length;
    contadores.push(indicador("Tareas publicadas", publicadas.length,
      [plural(terminadas, "terminada", "terminadas"), tieneRol(yo, "coordinator") ? plural(borradores, "borrador", "borradores") : null].filter(Boolean).join(" · ")));
  }

  const nombresTipo = new Map((tipos?.data || []).map((t) => [t.id, t.name]));
  const tareasPorId = new Map((tareas?.data || []).map((t) => [t.id, t]));
  const bloques = [
    lee.cola ? tablaPorRevisar(mias, (cola?.data || []).length) : null,
    lee.panel ? tablaSeguimiento(panel, tareasPorId, nombresTipo) : null,
  ];
  const accion = tieneRol(yo, "coordinator") ? h("a", { class: "v-btn", href: RUTAS.nuevaTarea }, "Nueva tarea") : null;
  return { titulo, contadores, bloques, accion };
}

function celdaFecha(f) {
  return h("div", { class: "tr-fecha" },
    h("strong", {}, f.dia),
    f.rel ? h("span", { class: `tr-fecha__rel${f.estado ? ` tr-fecha__rel--${f.estado}` : ""}` }, f.rel) : null);
}

function tablaPorRevisar(filas, totalCola) {
  const otras = totalCola - filas.length;
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-revisar" },
    h("div", { class: "ini-cab" },
      h("h2", { id: "t-revisar", class: "v-h2" }, "Te toca revisar"),
      h("p", { class: "v-nota" }, "Primero las que ya tomaste; luego las más antiguas.")),
    filas.length ? h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Entregas que te toca revisar"),
      h("thead", {}, h("tr", {}, ["Tarea", "Docente", "Estado", "Entregada", "Fecha límite"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => {
        const tomada = x.status === "under_review";
        const vieja = (diasDesde(x.submitted_at) ?? 0) > DIAS_ENTREGA_VIEJA;
        const sub = [etiquetaTipo(x.task_type), x.course_code, x.period_code, Number(x.attempt) > 1 ? `intento ${x.attempt}` : null].filter(Boolean).join(" · ");
        const boton = tomada ? "Continuar revisión" : "Revisar";
        return h("tr", { class: "pn-fila pn-fila--revisar" },
          h("td", { "data-etiqueta": "Tarea" }, h("div", { class: "pn-tarea" }, h("a", { href: RUTAS.asignacion(x.id) }, x.title || "Tarea"), sub ? h("span", {}, sub) : null)),
          h("td", { "data-etiqueta": "Docente" }, h("strong", {}, x.teacher || "—")),
          h("td", { "data-etiqueta": "Estado" }, h("div", { class: "ini-estado" }, chipEstado(x.status), tomada ? h("span", {}, "Ya la tomaste") : null)),
          h("td", { "data-etiqueta": "Entregada", class: `pn-fecha${vieja ? " ini-vieja" : ""}` }, x.submitted_at ? haceCuando(x.submitted_at) : "—"),
          h("td", { "data-etiqueta": "Fecha límite" }, celdaFecha(fechaLimiteCorta(x.due_at))),
          h("td", { class: "pn-accion ini-accion" }, h("a", { class: "v-btn v-btn--chico", href: RUTAS.asignacion(x.id), "aria-label": `${boton}: ${x.title} de ${x.teacher}` }, boton)));
      })))
      : vacio("No tienes entregas por revisar. Las nuevas aparecerán aquí."),
    otras > 0 ? h("p", { class: "ini-pie" }, h("a", { href: RUTAS.porRevisar }, "Ver todo lo pendiente de revisar"),
      ` · incluye ${plural(otras, "entrega de otros revisores", "entregas de otros revisores")}`) : null);
}

/** Vencidas (la más atrasada arriba) y por vencer del panel, hasta cinco. */
function tablaSeguimiento(d, tareasPorId, nombresTipo) {
  const fila = (x, clase) => ({ ...x, clase, dias: diasHasta(x.due_date) ?? 0 });
  const filas = [
    ...(d.overdue?.items || []).map((x) => fila(x, "vencida")).sort((a, b) => a.dias - b.dias),
    ...(d.due_soon?.items || []).map((x) => fila(x, "por-vencer")).sort((a, b) => a.dias - b.dias),
  ].slice(0, MAX_SEGUIMIENTO);
  const subtitulo = (x) => {
    const t = tareasPorId.get(x.task_id);
    return [t ? nombresTipo.get(t.type_id) : null, t?.course_code, t?.period_code].filter(Boolean).join(" · ");
  };
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-seguimiento" },
    h("div", { class: "ini-cab ini-cab--enlace" },
      h("div", { class: "ini-cab" },
        h("h2", { id: "t-seguimiento", class: "v-h2" }, "Para dar seguimiento"),
        h("p", { class: "v-nota" }, "Docentes con tareas vencidas o por vencer.")),
      h("a", { class: "ini-enlace", href: RUTAS.panel }, "Ver el panel completo")),
    filas.length ? h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Tareas vencidas o por vencer"),
      h("thead", {}, h("tr", {}, ["Tarea", "Docente", "Estado", "Fecha límite"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => {
        const sub = subtitulo(x);
        return h("tr", { class: `pn-fila pn-fila--${x.clase}` },
          h("td", { "data-etiqueta": "Tarea" }, h("div", { class: "pn-tarea" }, h("a", { href: RUTAS.asignacion(x.assignment_id) }, x.task_title || "Tarea"), sub ? h("span", {}, sub) : null)),
          h("td", { "data-etiqueta": "Docente" }, h("strong", {}, x.user_name || x.user_email || "—")),
          h("td", { "data-etiqueta": "Estado" }, chipEstado(x.state)),
          h("td", { "data-etiqueta": "Fecha límite" }, celdaFecha(fechaLimiteCorta(x.due_date))),
          h("td", { class: "pn-accion" }, h("a", { href: RUTAS.asignacion(x.assignment_id), "aria-label": `Abrir: ${x.task_title} de ${x.user_name || ""}` }, "Abrir")));
      })))
      : vacio("Nada que seguir: no hay tareas vencidas ni por vencer."));
}
