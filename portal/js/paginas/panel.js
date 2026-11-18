// Panel de cumplimiento (coordinación, dirección, administración y auditoría): /dashboard.
import { api } from "../api.js";
import { montarBarra, puedeVerPanel } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner } from "../dom.js";
import { chipEstado, plazo, fechaCorta, fechaHora } from "../formato.js";
import { barraAvance, vacio, sinAcceso, textoDeError } from "../componentes.js";
import { requerirSesion } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "panel");
tituloPestana("Panel");

const SIN_PERMISO = "El panel de cumplimiento es para coordinación, dirección, administración y auditoría.";
if (!puedeVerPanel(yo)) await sinAcceso(raiz, "Panel", SIN_PERMISO);

let d;
try {
  d = await api("/dashboard?limit=20");
} catch (e) {
  await sinAcceso(raiz, "Panel", textoDeError(e, SIN_PERMISO));
}

const porEstado = d.assignments?.by_state || {};
const n = (e) => Number(porEstado[e]) || 0;
const porRevisar = n("submitted") + n("under_review");
const c = d.compliance || {};
const pct = c.percentage == null ? null : Number(c.percentage);

poner(raiz,
  h("div", { class: "v-cabecera" },
    h("h1", { class: "v-h1" }, "Panel de cumplimiento"),
    h("p", { class: "v-nota", title: fechaHora(d.generated_at) }, `Actualizado: ${fechaCorta(d.generated_at)} · Cuenta todas las asignaciones publicadas, sin las canceladas.`)),
  h("section", { class: "v-indicadores", "aria-label": "Indicadores" },
    indicador("Cumplimiento", pct == null ? "—" : `${pct.toLocaleString("es-GT", { maximumFractionDigits: 1 })} %`,
      c.expected ? `${c.completed} de ${c.expected} asignaciones ya entregadas (entregadas, en revisión, aprobadas o cerradas)` : "Todavía no hay asignaciones"),
    indicador("Vencidas", String(d.overdue?.total ?? 0), "Pendientes con la fecha límite pasada", d.overdue?.total ? "alerta" : ""),
    indicador("Por vencer", String(d.due_soon?.total ?? 0), `Vencen en los próximos ${d.due_soon_days ?? 3} días`, d.due_soon?.total ? "aviso" : ""),
    indicador("Por revisar", String(porRevisar), "Entregadas o en revisión", "", (yo.roles || []).some((r) => ["reviewer", "coordinator", "admin"].includes(r)) ? RUTAS.porRevisar : null)),
  h("section", { class: "v-card", "aria-labelledby": "t-etapas" },
    h("h2", { id: "t-etapas", class: "v-h2" }, "Asignaciones por etapa"),
    barraAvance(porEstado)),
  h("div", { class: "v-cols" },
    lista("Vencidas", d.overdue, "No hay asignaciones vencidas."),
    lista(`Por vencer (${d.due_soon_days ?? 3} días)`, d.due_soon, "Nada vence en los próximos días.")));

function indicador(titulo, valor, detalle, tono = "", href = null) {
  const cuerpo = [
    h("span", { class: "v-indicador__titulo" }, titulo),
    h("span", { class: "v-indicador__valor" }, valor),
    h("span", { class: "v-indicador__detalle" }, detalle),
  ];
  const clase = `v-indicador${tono ? ` v-indicador--${tono}` : ""}`;
  return href ? h("a", { class: clase, href }, cuerpo) : h("div", { class: clase }, cuerpo);
}

function lista(titulo, bloque, siVacio) {
  const items = bloque?.items || [];
  const total = Number(bloque?.total) || 0;
  return h("section", { class: "v-card v-cols__mitad", "aria-label": titulo },
    h("h2", { class: "v-h2" }, `${titulo}: ${total}`),
    items.length
      ? h("ul", { class: "v-tareas" }, items.map((x) => h("li", { class: "v-tarea" },
        h("a", { class: "v-tarea__enlace", href: RUTAS.asignacion(x.assignment_id) },
          h("span", { class: "v-tarea__cab" }, chipEstado(x.state)),
          h("span", { class: "v-tarea__titulo" }, x.task_title || "Tarea"),
          h("span", { class: "v-tarea__dato" }, [x.user_name || x.user_email, plazo(x.due_date).texto].filter(Boolean).join(" · "))))))
      : vacio(siVacio),
    total > items.length ? h("p", { class: "v-nota" }, `Se muestran ${items.length} de ${total}.`) : null);
}
