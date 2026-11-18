// Inicio según el perfil (requisito 4): una frase de qué le toca hoy y solo sus secciones.
// Versión mínima de la etapa 1: las listas completas viven en Mis tareas y Por revisar.
import { api, lista } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { filaAsignacion, vacio } from "../componentes.js";
import { requerirSesion, perfiles } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
const p = perfiles(yo.roles);
montarBarra(yo, "inicio");
tituloPestana("Inicio");

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const bloques = [];
const frases = [];

if (p.coordinacion) {
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
    const [s, r] = await Promise.all([api("/inbox/summary"), api("/inbox?per_page=5")]);
    const devueltas = Number(s.by_status?.returned) || 0;
    if (devueltas) frases.push(`Tienes ${plural(devueltas, "tarea devuelta", "tareas devueltas")}`);
    if (s.overdue) frases.push(plural(Number(s.overdue), "tarea vencida", "tareas vencidas"));
    const pendientes = Number(s.pending) || 0;
    if (pendientes && !devueltas) frases.push(`Tienes ${plural(pendientes, "tarea pendiente", "tareas pendientes")}`);
    bloques.push(seccion("Mis tareas", lista(r).map(filaAsignacion),
      vacio("No tienes tareas pendientes."), { texto: "Ver todas mis tareas", href: RUTAS.misTareas }));
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
  if (!p.docente && !p.coordinacion) frases.push("Consulta el panel, los catálogos y la auditoría");
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
