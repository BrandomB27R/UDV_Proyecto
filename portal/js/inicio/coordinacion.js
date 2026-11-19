// Inicio de coordinación, revisión y dirección (mockup vinci-inicio-coordinacion).
// Cada consulta se pide solo si el rol la puede leer (sin ningún 403), según los roles de /me:
//   /review-queue  revisión, coordinación y administración (G4)
//   /dashboard     coordinación, dirección, administración y auditoría (G6)
//   /tasks         coordinación, revisión y dirección (G3)
//   /course-programs?estado=approved  dirección (autoriza los programas; G5 lo deja leer a todos)
//   /review-queue?status=approved + /assignments/{id}  coordinación (lo que puede cerrar; ver porCerrar)
import { api } from "../api.js";
import { RUTAS } from "../config.js";
import { h, mensaje } from "../dom.js";
import { chipEstado, etiquetaTipo, fechaLimiteCorta, haceCuando, diasDesde, diasHasta } from "../formato.js";
import { etiquetaEstadoPrograma, claseEstadoPrograma } from "../programa/flujo-programa.js";
import { indicador, vacio, todasLasPaginas } from "../componentes.js";
import { TOPE, cabResumen, pieResumen, verLasN } from "./resumen.js";
import { tieneRol, puedeRevisar } from "../sesion.js";
import { puedeVerPanel } from "../barra.js";

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const PENDIENTES_REVISION = ["submitted", "under_review"];
const MAX_SEGUIMIENTO = TOPE;
/** Pestaña «Por cerrar» de Por revisar. */
export const RUTA_POR_CERRAR = `${RUTAS.porRevisar}?ver=cerrar`;
const DIAS_ENTREGA_VIEJA = 7;

/** Qué puede leer quien mira (por roles, antes de pedir nada). */
export function lecturasDe(yo) {
  return { cola: puedeRevisar(yo), panel: puedeVerPanel(yo), tareas: tieneRol(yo, "coordinator", "reviewer", "authority"), autoriza: tieneRol(yo, "authority"),
    cierra: tieneRol(yo, "coordinator") };
}

/** {titulo, contadores, bloques, accion} de coordinación, revisión o dirección. */
export async function inicioCoordinacion(yo) {
  const lee = lecturasDe(yo);
  // Dirección sin coordinación: su inicio es autorizar y el cumplimiento (no la lista de tareas).
  const soloDireccion = lee.autoriza && !lee.cola;
  const [cola, panel, tareas, tipos, porAutorizar, listas] = await Promise.all([
    lee.cola ? todasLasPaginas(api, "/review-queue") : null,
    lee.panel ? api(`/dashboard?limit=${MAX_SEGUIMIENTO}`) : null,
    lee.tareas ? todasLasPaginas(api, "/tasks?include=progress") : null,
    lee.panel ? api("/task-types?per_page=100").catch(() => ({ data: [] })) : null,
    lee.autoriza ? programasPorAutorizar() : null,
    // Si falla, el inicio lo dice en su lugar (no se confunde con «nada por cerrar»).
    lee.cierra ? porCerrar(yo).catch((e) => ({ error: e })) : null,
  ]);

  // Solo lo que le toca a quien mira (mine): primero las que ya tomó, luego la entrega más antigua.
  const mias = (cola?.data || []).filter((x) => x.mine && PENDIENTES_REVISION.includes(x.status)).sort((a, b) =>
    (a.status === "under_review" ? 0 : 1) - (b.status === "under_review" ? 0 : 1)
    || String(a.submitted_at || "").localeCompare(String(b.submitted_at || "")) || a.id - b.id);
  const tomadas = mias.filter((x) => x.status === "under_review").length;
  const vencidas = Number(panel?.overdue?.total) || 0;
  const porVencer = Number(panel?.due_soon?.total) || 0;

  const nAutorizar = porAutorizar?.length || 0;
  const errorCerrar = listas?.error || null;
  const nCerrar = errorCerrar ? 0 : listas?.length || 0;
  let titulo;
  if (soloDireccion && nAutorizar) titulo = `Tienes ${plural(nAutorizar, "programa por autorizar", "programas por autorizar")}.`;
  // Lo de revisar manda; si no hay nada por revisar pero sí por cerrar, el título habla de eso.
  else if (lee.cola && !mias.length && nCerrar) titulo = `Tienes ${plural(nCerrar, "tarea lista para cerrar", "tareas listas para cerrar")}.`;
  else if (lee.cola) titulo = mias.length ? `Tienes ${plural(mias.length, "entrega por revisar", "entregas por revisar")}.` : "No tienes entregas por revisar.";
  else if (lee.panel) titulo = vencidas || porVencer
    ? `Hay ${plural(vencidas, "tarea vencida", "tareas vencidas")} y ${porVencer} por vencer.` : "No hay tareas vencidas ni por vencer.";
  else titulo = "No tienes nada pendiente por hoy.";

  const contadores = [];
  if (soloDireccion) contadores.push(indicador("Por autorizar", nAutorizar, "Programas ya aprobados", "autorizar"));
  if (lee.cola) contadores.push(indicador("Por revisar", mias.length,
    tomadas ? `${tomadas} ${tomadas === 1 ? "ya la tomaste" : "ya las tomaste"}` : "Ninguna tomada todavía", "revisar"));
  if (errorCerrar) contadores.push(indicador("Por cerrar", "—", "No se pudo consultar", "cerrar", RUTA_POR_CERRAR));
  else if (listas) contadores.push(indicador("Por cerrar", nCerrar, nCerrar === 1 ? "Aprobada, falta cerrarla" : nCerrar ? "Aprobadas, falta cerrarlas" : "Nada por cerrar", "cerrar", RUTA_POR_CERRAR));
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
    // Cerrada: todas sus entregas (sin las canceladas) están cerradas. Aprobada sin cerrar no cuenta.
    const cerradas = publicadas.filter((t) => Number(t.progress?.total) > 0 && Number(t.progress?.by_status?.closed) === Number(t.progress?.total)).length;
    const borradores = lista.filter((t) => t.status === "draft").length;
    contadores.push(indicador("Tareas publicadas", publicadas.length,
      [plural(cerradas, "cerrada", "cerradas"),tieneRol(yo, "coordinator") ? plural(borradores, "borrador", "borradores") : null].filter(Boolean).join(" · ")));
  }

  const nombresTipo = new Map((tipos?.data || []).map((t) => [t.id, t.name]));
  const tareasPorId = new Map((tareas?.data || []).map((t) => [t.id, t]));
  // «Te toca autorizar» va antes del seguimiento; con coordinación, debajo de «Te toca revisar» y solo si hay.
  const bloques = [
    lee.cola ? tablaPorRevisar(mias) : null,
    errorCerrar ? mensaje("error", `No se pudieron consultar las tareas listas para cerrar: ${errorCerrar.message}`)
      : nCerrar ? tablaPorCerrar(listas) : null,
    !errorCerrar && listas?.sinConsultar ? avisoSinConsultar(listas.sinConsultar) : null,
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

function tablaPorRevisar(todas) {
  const filas = todas.slice(0, TOPE);
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-revisar" },
    cabResumen("t-revisar", "Te toca revisar", todas.length > TOPE
      ? `Las ${TOPE} más urgentes: primero las que ya tomaste, luego las más antiguas.`
      : "Primero las que ya tomaste; luego las más antiguas."),
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
    todas.length ? pieResumen(filas.length, todas.length, "entregas por revisar",
      { texto: verLasN(todas.length, "Por revisar"), href: RUTAS.porRevisar }) : null);
}

/**
 * Entregas aprobadas que quien mira puede cerrar de verdad: «close» en viewer_actions del detalle
 * (G4: coordinación que creó la tarea). La cola no trae quién aprobó ni cuándo: sale de last_approval
 * del detalle, una consulta por entrega aprobada de sus tareas (NOTAS_BACKEND §12).
 */
export async function porCerrar(yo) {
  // Si la cola no responde, el error sube: quien llama dice «no se pudo consultar», no «nada por cerrar».
  const r = await todasLasPaginas(api, "/review-queue?status=approved");
  const candidatas = (r?.data || []).filter((x) => x.status === "approved" && (x.created_by == null || Number(x.created_by) === Number(yo.id)));
  let sinConsultar = 0;
  const filas = await Promise.all(candidatas.map(async (x) => {
    let d;
    try { d = await api(`/assignments/${encodeURIComponent(x.id)}`); } catch { sinConsultar++; return null; }
    if (d.status !== "approved" || !(d.viewer_actions || []).includes("close")) return null;
    return { ...x, viewer_actions: d.viewer_actions, aprobo: d.last_approval?.actor || null, aprobadoEn: d.last_approval?.at || null };
  }));
  // La aprobada hace más tiempo arriba (sin fecha de aprobación, al final).
  const cerrables = filas.filter(Boolean).sort(ordenAprobadas);
  // Entregas aprobadas cuyo detalle no se pudo pedir: no se sabe si se pueden cerrar; se avisa aparte.
  cerrables.sinConsultar = sinConsultar;
  return cerrables;
}

/** Aviso cuando algunas entregas aprobadas no se pudieron consultar (la lista puede estar incompleta). */
export function avisoSinConsultar(n) {
  return mensaje("aviso", `${n === 1 ? "No se pudo consultar 1 entrega aprobada" : `No se pudieron consultar ${n} entregas aprobadas`}; la lista de tareas por cerrar puede estar incompleta. Recarga para intentarlo otra vez.`);
}

/** La aprobada hace más tiempo primero; sin fecha, al final. */
export function ordenAprobadas(a, b) {
  if (!a.aprobadoEn !== !b.aprobadoEn) return a.aprobadoEn ? -1 : 1;
  return String(a.aprobadoEn || "").localeCompare(String(b.aprobadoEn || "")) || a.id - b.id;
}

function tablaPorCerrar(todas) {
  const filas = todas.slice(0, TOPE);
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-cerrar" },
    cabResumen("t-cerrar", "Listas para cerrar", todas.length > TOPE
      ? `Las ${TOPE} aprobadas hace más tiempo.`
      : "Ya están aprobadas. Al cerrarlas quedan terminadas con su historial completo."),
    h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Entregas aprobadas que falta cerrar"),
      h("thead", {}, h("tr", {}, ["Tarea", "Docente", "Estado", "Aprobó"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((x) => {
        const sub = [etiquetaTipo(x.task_type), x.course_code, x.period_code].filter(Boolean).join(" · ");
        // El botón lleva al detalle, donde está «Cerrar la tarea»: se ve qué se cierra antes de cerrarlo.
        return h("tr", { class: "pn-fila pn-fila--cerrar" },
          h("td", { "data-etiqueta": "Tarea" }, h("div", { class: "pn-tarea" }, h("a", { href: RUTAS.asignacion(x.id) }, x.title || "Tarea"), sub ? h("span", {}, sub) : null)),
          h("td", { "data-etiqueta": "Docente" }, h("strong", {}, x.teacher || "—")),
          h("td", { "data-etiqueta": "Estado" }, chipEstado(x.status)),
          h("td", { "data-etiqueta": "Aprobó" }, h("div", { class: "pn-tarea" },
            h("strong", {}, x.aprobo || "—"), x.aprobadoEn ? h("span", {}, haceCuando(x.aprobadoEn)) : null)),
          h("td", { class: "pn-accion ini-accion" }, h("a", { class: "v-btn v-btn--chico", href: RUTAS.asignacion(x.id), "aria-label": `Cerrar la tarea: ${x.title} de ${x.teacher}` }, "Cerrar la tarea")));
      }))),
    pieResumen(filas.length, todas.length, "tareas por cerrar", { texto: verLasN(todas.length, "Por revisar"), href: RUTA_POR_CERRAR }));
}

/**
 * Versiones aprobadas que falta autorizar. Cada fila de /course-programs trae quién la elaboró y quién
 * la aprobó y cuándo (vinci-14): sin consultas por fila.
 */
async function programasPorAutorizar() {
  const r = await todasLasPaginas(api, "/course-programs?estado=approved");
  return (r.data || []).filter((x) => x.estado === "approved" && x.programa_version_id).map((x) => ({
    ...x, elaboro: x.docente_responsable || null, aprobo: x.aprobado_por || null, aprobadoEn: x.aprobado_en || null,
  }));
}

function tablaPorAutorizar(todas) {
  const filas = todas.slice(0, TOPE);
  const conAprobo = filas.some((x) => x.aprobo);
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-autorizar" },
    cabResumen("t-autorizar", "Te toca autorizar", !todas.length ? null : todas.length > TOPE
      ? `Los ${TOPE} primeros de los programas aprobados por revisión.`
      : "Programas aprobados por revisión. Al autorizarlos quedan como la versión vigente."),
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
      : vacio("No hay programas por autorizar. Cuando revisión apruebe uno, aparecerá aquí."),
    todas.length ? pieResumen(filas.length, todas.length, "programas por autorizar",
      { texto: verLasN(todas.length, "Programas de curso", true), href: `${RUTAS.programas}#revision` }) : null);
}

/** Vencidas (la más atrasada arriba) y por vencer del panel, hasta cinco. */
function tablaSeguimiento(d, tareasPorId, nombresTipo) {
  const fila = (x, clase) => ({ ...x, clase, dias: diasHasta(x.due_date) ?? 0 });
  const filas = [
    ...(d.overdue?.items || []).map((x) => fila(x, "vencida")).sort((a, b) => a.dias - b.dias),
    ...(d.due_soon?.items || []).map((x) => fila(x, "por-vencer")).sort((a, b) => a.dias - b.dias),
  ].slice(0, MAX_SEGUIMIENTO);
  const total = (Number(d.overdue?.total) || 0) + (Number(d.due_soon?.total) || 0);
  const subtitulo = (x) => {
    const t = tareasPorId.get(x.task_id);
    return [t ? nombresTipo.get(t.type_id) : null, t?.course_code, t?.period_code].filter(Boolean).join(" · ");
  };
  return h("section", { class: "v-card pn-seccion", "aria-labelledby": "t-seguimiento" },
    cabResumen("t-seguimiento", "Para dar seguimiento", total > MAX_SEGUIMIENTO
      ? `Los ${MAX_SEGUIMIENTO} docentes con tareas vencidas o por vencer más urgentes.`
      : "Docentes con tareas vencidas o por vencer."),
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
      : vacio("Nada que seguir: no hay tareas vencidas ni por vencer."),
    pieResumen(filas.length, Math.max(total, filas.length), "tareas vencidas o por vencer", { texto: "Ver el panel completo", href: RUTAS.panel }));
}
