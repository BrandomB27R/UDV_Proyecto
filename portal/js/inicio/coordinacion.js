// Inicio de coordinación, revisión y dirección (mockup vinci-inicio-coordinacion).
// Cada consulta se pide solo si el rol la puede leer (sin ningún 403), según los roles de /me:
//   /review-queue  revisión, coordinación y administración (G4)
//   /dashboard     coordinación, dirección, administración y auditoría (G6)
//   /tasks         coordinación, revisión y dirección (G3)
//   /course-programs?estado=approved  dirección (autoriza los programas; G5 lo deja leer a todos)
import { api } from "../api.js";
import { RUTAS } from "../config.js";
import { h } from "../dom.js";
import { chipEstado, etiquetaTipo, fechaLimiteCorta, haceCuando, diasDesde, diasHasta } from "../formato.js";
import { etiquetaEstadoPrograma, claseEstadoPrograma } from "../programa/flujo-programa.js";
import { indicador, vacio, todasLasPaginas } from "../componentes.js";
import { tieneRol, puedeRevisar } from "../sesion.js";
import { puedeVerPanel } from "../barra.js";

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const PENDIENTES_REVISION = ["submitted", "under_review"];
const MAX_SEGUIMIENTO = 5;
const DIAS_ENTREGA_VIEJA = 7;

/** Qué puede leer quien mira (por roles, antes de pedir nada). */
export function lecturasDe(yo) {
  return { cola: puedeRevisar(yo), panel: puedeVerPanel(yo), tareas: tieneRol(yo, "coordinator", "reviewer", "authority"), autoriza: tieneRol(yo, "authority") };
}

/** {titulo, contadores, bloques, accion} de coordinación, revisión o dirección. */
export async function inicioCoordinacion(yo) {
  const lee = lecturasDe(yo);
  // Dirección sin coordinación: su inicio es autorizar y el cumplimiento (no la lista de tareas).
  const soloDireccion = lee.autoriza && !lee.cola;
  const [cola, panel, tareas, tipos, porAutorizar] = await Promise.all([
    lee.cola ? todasLasPaginas(api, "/review-queue") : null,
    lee.panel ? api(`/dashboard?limit=${MAX_SEGUIMIENTO}`) : null,
    lee.tareas ? todasLasPaginas(api, "/tasks?include=progress") : null,
    lee.panel ? api("/task-types?per_page=100").catch(() => ({ data: [] })) : null,
    lee.autoriza ? programasPorAutorizar() : null,
  ]);

  // Solo lo que le toca a quien mira (mine): primero las que ya tomó, luego la entrega más antigua.
  const mias = (cola?.data || []).filter((x) => x.mine && PENDIENTES_REVISION.includes(x.status)).sort((a, b) =>
    (a.status === "under_review" ? 0 : 1) - (b.status === "under_review" ? 0 : 1)
    || String(a.submitted_at || "").localeCompare(String(b.submitted_at || "")) || a.id - b.id);
  const tomadas = mias.filter((x) => x.status === "under_review").length;
  const vencidas = Number(panel?.overdue?.total) || 0;
  const porVencer = Number(panel?.due_soon?.total) || 0;

  const nAutorizar = porAutorizar?.length || 0;
  let titulo;
  if (soloDireccion && nAutorizar) titulo = `Tienes ${plural(nAutorizar, "programa por autorizar", "programas por autorizar")}.`;
  else if (lee.cola) titulo = mias.length ? `Tienes ${plural(mias.length, "entrega por revisar", "entregas por revisar")}.` : "No tienes entregas por revisar.";
  else if (lee.panel) titulo = vencidas || porVencer
    ? `Hay ${plural(vencidas, "tarea vencida", "tareas vencidas")} y ${porVencer} por vencer.` : "No hay tareas vencidas ni por vencer.";
  else titulo = "No tienes nada pendiente por hoy.";

  const contadores = [];
  if (soloDireccion) contadores.push(indicador("Por autorizar", nAutorizar, "Programas ya aprobados", "autorizar"));
  if (lee.cola) contadores.push(indicador("Por revisar", mias.length,
    tomadas ? `${tomadas} ${tomadas === 1 ? "ya la tomaste" : "ya las tomaste"}` : "Ninguna tomada todavía", "revisar"));
  if (lee.panel) {
    contadores.push(indicador("Vencidas", vencidas, "Docentes con la fecha pasada", "alerta"));
    contadores.push(indicador("Por vencer", porVencer, `En los próximos ${panel.due_soon_days ?? 3} días`, "aviso"));
  }
  if (soloDireccion && panel) {
    const c = panel.compliance || {};
    const pct = c.percentage == null ? null : Number(c.percentage);
    contadores.push(indicador("Cumplimiento", pct == null ? "—" : `${pct.toLocaleString("es-GT", { maximumFractionDigits: 0 })} %`,
      c.expected ? `${c.completed} de ${c.expected} asignaciones entregadas` : "Todavía no hay asignaciones"));
  }
  // Dirección usa /tasks solo para el tipo y el curso del seguimiento; su contador es Cumplimiento.
  if (tareas && !soloDireccion) {
    const lista = tareas.data || [];
    const publicadas = lista.filter((t) => t.status === "published");
    const terminadas = publicadas.filter((t) => Number(t.progress?.total) > 0 && Number(t.progress?.done) === Number(t.progress?.total)).length;
    const borradores = lista.filter((t) => t.status === "draft").length;
    contadores.push(indicador("Tareas publicadas", publicadas.length,
      [plural(terminadas, "terminada", "terminadas"), tieneRol(yo, "coordinator") ? plural(borradores, "borrador", "borradores") : null].filter(Boolean).join(" · ")));
  }

  const nombresTipo = new Map((tipos?.data || []).map((t) => [t.id, t.name]));
  const tareasPorId = new Map((tareas?.data || []).map((t) => [t.id, t]));
  // «Te toca autorizar» va antes del seguimiento; con coordinación, debajo de «Te toca revisar» y solo si hay.
  const bloques = [
    lee.cola ? tablaPorRevisar(mias, (cola?.data || []).length) : null,
    porAutorizar && (soloDireccion || nAutorizar) ? tablaPorAutorizar(porAutorizar) : null,
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

/**
 * Versiones aprobadas que falta autorizar. La lista (/course-programs) no trae quién elaboró: se lee del
 * detalle de cada versión aprobada (responsables.docente; son pocas). Quién aprobó y cuándo no lo da la API
 * de forma fiable (responsables.revisor puede venir copiado de la versión de origen): la columna «Aprobó»
 * aparece cuando la lista traiga aprobado_por y aprobado_en (NOTAS_BACKEND §10).
 */
async function programasPorAutorizar() {
  const r = await todasLasPaginas(api, "/course-programs?estado=approved");
  const filas = (r.data || []).filter((x) => x.estado === "approved" && x.programa_version_id);
  return Promise.all(filas.map(async (x) => {
    const v = await api(`/program-versions/${encodeURIComponent(x.programa_version_id)}`).catch(() => null);
    const resp = v?.secciones?.responsables?.contenido || {};
    return { ...x, elaboro: x.docente_responsable || resp.docente || null, aprobo: x.aprobado_por || null, aprobadoEn: x.aprobado_en || null };
  }));
}

function tablaPorAutorizar(filas) {
  const conAprobo = filas.some((x) => x.aprobo);
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-autorizar" },
    h("div", { class: "ini-cab" },
      h("h2", { id: "t-autorizar", class: "v-h2" }, "Te toca autorizar"),
      filas.length ? h("p", { class: "v-nota" }, "Programas aprobados por revisión. Al autorizarlos quedan como la versión vigente.") : null),
    filas.length ? h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Programas aprobados por autorizar"),
      h("thead", {}, h("tr", {}, ["Programa", "Elaboró", ...(conAprobo ? ["Aprobó"] : []), "Estado"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => {
        const titulo = `${x.codigo} · ${x.asignatura}`;
        return h("tr", { class: "pn-fila pn-fila--autorizar" },
          h("td", { "data-etiqueta": "Programa" }, h("div", { class: "pn-tarea" },
            h("a", { href: RUTAS.programa(x.programa_version_id) }, titulo),
            h("span", {}, [`Versión ${x.numero_version}`, x.periodo, x.sede].filter(Boolean).join(" · ")))),
          h("td", { "data-etiqueta": "Elaboró" }, h("strong", {}, x.elaboro || "—")),
          conAprobo ? h("td", { "data-etiqueta": "Aprobó" }, h("div", { class: "pn-tarea" },
            h("strong", {}, x.aprobo || "—"), x.aprobadoEn ? h("span", {}, haceCuando(x.aprobadoEn)) : null)) : null,
          h("td", { "data-etiqueta": "Estado" }, h("span", { class: `v-chip v-chip--${claseEstadoPrograma(x.estado)}` }, etiquetaEstadoPrograma(x.estado))),
          h("td", { class: "pn-accion ini-accion" }, h("a", { class: "v-btn v-btn--chico", href: RUTAS.programa(x.programa_version_id), "aria-label": `Revisar y autorizar: ${titulo}, versión ${x.numero_version}` }, "Revisar y autorizar")));
      })))
      : vacio("No hay programas por autorizar. Cuando revisión apruebe uno, aparecerá aquí."));
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
