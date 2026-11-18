// Inicio según el perfil (requisito 4): una frase de qué le toca hoy y solo sus secciones.
// Docente: mockup vinci-inicio-docente (js/inicio/docente.js). Coordinación: versión de la etapa 1.
import { api, lista } from "../api.js";
import { montarBarra, puedeVerPanel } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { filaAsignacion, vacio } from "../componentes.js";
import { requerirSesion, perfiles, puedeRevisar } from "../sesion.js";
import { inicioDocente } from "../inicio/docente.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
const p = perfiles(yo.roles);
montarBarra(yo, "inicio");
tituloPestana("Inicio");

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const bloques = [];
const frases = [];

if (puedeRevisar(yo)) {
  try {
    const r = await api("/review-queue?per_page=5");
    const s = r.summary || {};
    const porTomar = Number(s.submitted) || 0;
    const enRevision = Number(s.under_review) || 0;
    if (porTomar) frases.push(`Tienes ${plural(porTomar, "entrega por revisar", "entregas por revisar")}`);
    if (enRevision) frases.push(`${plural(enRevision, "revisión en curso", "revisiones en curso")}`);
    bloques.push(seccion("Por revisar", lista(r).map(filaAsignacion),
      vacio("No hay entregas esperando revisión."), { texto: "Ver todo lo pendiente de revisar", href: RUTAS.porRevisar }));
  } catch (e) { bloques.push(mensaje("error", e.message)); }
}

if (yo.roles.includes("coordinator")) {
  try {
    const [pub, borr] = await Promise.all([api("/tasks?status=published&per_page=1"), api("/tasks?status=draft&per_page=1")]);
    const nPub = Number(pub.total) || 0;
    const nBorr = Number(borr.total) || 0;
    const detalle = [`${plural(nPub, "tarea publicada", "tareas publicadas")}`];
    if (nBorr) detalle.push(plural(nBorr, "borrador sin publicar", "borradores sin publicar"));
    bloques.push(h("section", { class: "v-card", "aria-label": "Tareas" },
      h("h2", { class: "v-h2" }, "Tareas"),
      h("p", { class: "v-texto" }, `${detalle.join(" · ")}.`),
      h("div", { class: "v-acciones" },
        h("a", { class: "v-btn", href: RUTAS.nuevaTarea }, "Nueva tarea"),
        h("a", { class: "v-btn v-btn--sec", href: RUTAS.tareas }, "Ver tareas y avance"))));
  } catch (e) { bloques.push(mensaje("error", e.message)); }
}

if (p.docente) {
  try {
    const d = await inicioDocente();
    frases.push(d.titulo.replace(/\.$/, ""));
    bloques.push(h("section", { class: "v-indicadores ini-indicadores", "aria-label": "Resumen" }, d.contadores), ...d.bloques);
  } catch (e) { bloques.push(mensaje("error", e.message)); }
}

// Quien ve el panel pero no revisa (dirección o auditoría solas): el inicio es el resumen del panel.
if (puedeVerPanel(yo) && !puedeRevisar(yo)) {
  try {
    const d = await api("/dashboard?limit=1");
    const c = d.compliance || {};
    const vencidas = Number(d.overdue?.total) || 0;
    const pronto = Number(d.due_soon?.total) || 0;
    if (c.percentage != null) frases.push(`Cumplimiento del ${Number(c.percentage).toLocaleString("es-GT", { maximumFractionDigits: 1 })} %`);
    if (vencidas) frases.push(plural(vencidas, "asignación vencida", "asignaciones vencidas"));
    bloques.push(h("section", { class: "v-card", "aria-label": "Panel de cumplimiento" },
      h("h2", { class: "v-h2" }, "Panel de cumplimiento"),
      h("p", { class: "v-texto" }, [
        c.expected ? `${c.completed} de ${c.expected} asignaciones ya entregadas` : "Todavía no hay asignaciones",
        plural(vencidas, "vencida", "vencidas"),
        `${pronto} por vencer en ${d.due_soon_days ?? 3} días`,
      ].join(" · ") + "."),
      h("div", { class: "v-acciones" }, h("a", { class: "v-btn", href: RUTAS.panel }, "Abrir el panel"))));
  } catch (e) { bloques.push(mensaje("error", e.message)); }
}

if (p.administracion) {
  bloques.push(h("section", { class: "v-card" },
    h("h2", { class: "v-h2" }, "Administración"),
    h("p", { class: "v-texto" }, "Panel de cumplimiento, catálogos y registro de auditoría."),
    h("div", { class: "v-acciones" },
      h("a", { class: "v-btn v-btn--sec", href: RUTAS.panel }, "Panel"),
      h("a", { class: "v-btn v-btn--sec", href: RUTAS.catalogos }, "Catálogos"),
      h("a", { class: "v-btn v-btn--sec", href: RUTAS.auditoria }, "Auditoría"))));
  if (!p.docente && !p.coordinacion && !frases.length) frases.push("Consulta el panel, los catálogos y la auditoría");
}

const frase = frases.length ? `${frases.join(" · ")}.` : "No tienes nada pendiente por hoy.";
poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("div", { class: "v-cabecera", style: "gap: 8px" },
      h("p", { class: "v-eyebrow" }, `Hola, ${yo.nombres || yo.nombre}`),
      h("h1", { class: "v-h1" }, frase)),
    yo.roles.includes("coordinator") ? h("a", { class: "v-btn", href: RUTAS.nuevaTarea }, "Nueva tarea") : null),
  bloques);

function seccion(titulo, filas, siVacio, enlace) {
  return h("section", { class: "v-card", "aria-label": titulo },
    h("h2", { class: "v-h2" }, titulo),
    filas.length ? h("ul", { class: "v-tareas" }, filas) : siVacio,
    filas.length ? h("div", { class: "v-acciones" }, h("a", { class: "v-btn v-btn--sec", href: enlace.href }, enlace.texto)) : null);
}
