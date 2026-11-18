// Piezas de interfaz que se repiten entre páginas.
import { RUTAS } from "./config.js";
import { h, poner } from "./dom.js";
import { chipEstado, chipPrioridad, etiquetaTipo, plazo, fechaCorta } from "./formato.js";

const PENDIENTES = ["assigned", "in_progress", "returned"];

/**
 * Fila de una asignación en una lista (inbox o cola de revisión).
 * item: {id, title, task_type, status, priority, due_at, due_state?, teacher?, submitted_at?, attempt?}
 */
export function filaAsignacion(item) {
  const p = plazo(item.due_at, { terminada: !PENDIENTES.includes(item.status) });
  const estadoPlazo = item.due_state || p.estado;
  const extra = [];
  if (item.teacher) extra.push(item.teacher);
  if (item.submitted_at) extra.push(`Entregada ${fechaCorta(item.submitted_at)}`);
  if (item.attempt > 1) extra.push(`Intento ${item.attempt}`);
  return h("li", { class: "v-tarea" },
    h("a", { class: "v-tarea__enlace", href: RUTAS.asignacion(item.id) },
      h("span", { class: "v-tarea__cab" },
        h("span", { class: "v-eyebrow" }, etiquetaTipo(item.task_type)),
        chipEstado(item.status),
        item.priority === "high" || item.priority === "urgent" ? chipPrioridad(item.priority) : null,
        estadoPlazo === "vencida" ? h("span", { class: "v-chip v-chip--vencida" }, "Vencida")
          : estadoPlazo === "por-vencer" ? h("span", { class: "v-chip v-chip--por-vencer" }, "Por vencer") : null),
      h("span", { class: "v-tarea__titulo" }, item.title),
      h("span", { class: "v-tarea__dato" }, [...extra, `Fecha límite: ${p.texto}`].join(" · "))));
}

/** Estado vacío: una frase y, si aplica, una acción. */
export function vacio(frase, accion) {
  return h("div", { class: "v-vacio" },
    h("p", {}, frase),
    accion ? h("a", { class: "v-btn v-btn--sec", href: accion.href }, accion.texto) : null);
}

/**
 * Pestañas (patrón ARIA tablist). opciones: [{id, texto, n}]. Llama a alCambiar(id).
 * Flechas izquierda/derecha mueven entre pestañas.
 */
export function pestanas(opciones, activa, alCambiar, etiqueta = "Filtrar") {
  const lista = h("div", { class: "v-pestanas", role: "tablist", "aria-label": etiqueta });
  const botones = opciones.map((o) => h("button", {
    type: "button", role: "tab", class: "v-pestana", id: `pest-${o.id}`,
    "aria-selected": String(o.id === activa), tabindex: o.id === activa ? "0" : "-1",
    onclick: () => seleccionar(o.id, true),
  }, o.texto, o.n != null ? h("span", { class: "v-pestana__n" }, String(o.n)) : null));
  lista.append(...botones);
  function seleccionar(id, avisar) {
    botones.forEach((b, i) => {
      const si = opciones[i].id === id;
      b.setAttribute("aria-selected", String(si));
      b.tabIndex = si ? 0 : -1;
    });
    if (avisar) alCambiar(id);
  }
  lista.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const i = botones.indexOf(document.activeElement);
    if (i < 0) return;
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + botones.length) % botones.length;
    botones[j].focus();
    seleccionar(opciones[j].id, true);
  });
  return lista;
}

// El avance es ordinal: cuatro etapas en una sola rampa de azul, de claro a oscuro.
// (Ocho estados con un color cada uno no se distinguen; ver la guía de visualización.)
export const ETAPAS = [
  { id: "sin-empezar", texto: "Sin empezar", estados: ["assigned"] },
  { id: "en-curso", texto: "En curso o devueltas", estados: ["in_progress", "returned"] },
  { id: "por-revisar", texto: "Por revisar", estados: ["submitted", "under_review"] },
  { id: "terminadas", texto: "Aprobadas o cerradas", estados: ["approved", "closed"] },
];

/** Cuenta por etapa a partir de un {estado: n}. */
export function porEtapa(porEstado = {}) {
  const n = (e) => Number(porEstado[e]) || 0;
  const etapas = ETAPAS.map((x) => ({ ...x, n: x.estados.reduce((s, e) => s + n(e), 0) }));
  return { etapas, total: etapas.reduce((s, x) => s + x.n, 0), devueltas: n("returned"), canceladas: n("cancelled") };
}

/** Barra de avance apilada por etapa, con leyenda (que hace de tabla) y aviso de devueltas y canceladas. */
export function barraAvance(porEstado = {}) {
  const { etapas, total, devueltas, canceladas } = porEtapa(porEstado);
  if (!total) {
    return h("p", { class: "v-nota" }, canceladas ? "Todas las asignaciones están canceladas." : "Todavía no hay asignaciones.");
  }
  const fin = etapas[3].n;
  const notas = [];
  if (devueltas) notas.push(`${devueltas} ${devueltas === 1 ? "devuelta" : "devueltas"} para corrección`);
  if (canceladas) notas.push(`${canceladas} ${canceladas === 1 ? "cancelada" : "canceladas"} (no cuentan)`);
  const presentes = etapas.filter((x) => x.n > 0);
  return h("div", { class: "v-avance" },
    h("p", { class: "v-avance__titulo" }, `${fin} de ${total} aprobadas o cerradas`),
    h("div", { class: "v-avance__barra", role: "img", "aria-label": etapas.map((x) => `${x.texto}: ${x.n}`).join(", ") },
      presentes.map((x) => h("span", { class: `v-avance__seg v-etapa--${x.id}`, style: `flex-grow: ${x.n}`,
        title: `${x.texto}: ${x.n} de ${total}` }))),
    h("ul", { class: "v-avance__leyenda" }, etapas.map((x) => h("li", {},
      h("span", { class: `v-avance__punto v-etapa--${x.id}`, "aria-hidden": "true" }),
      h("span", {}, `${x.texto}: `), h("strong", {}, String(x.n))))),
    notas.length ? h("p", { class: "v-nota" }, `${notas.join(" · ")}.`) : null);
}

/** Pide todas las páginas de una lista paginada (máximo per_page 100). */
export async function todasLasPaginas(api, ruta, tope = 10) {
  const sep = ruta.includes("?") ? "&" : "?";
  let pagina = 1;
  let datos = [];
  let primera = null;
  for (; pagina <= tope; pagina++) {
    const r = await api(`${ruta}${sep}page=${pagina}&per_page=100`);
    if (!primera) primera = r;
    const d = Array.isArray(r?.data) ? r.data : [];
    datos = datos.concat(d);
    if (d.length < 100 || datos.length >= (r?.total ?? 0)) break;
  }
  return { ...primera, data: datos };
}

// Aviso que sobrevive a una redirección (se muestra una vez en la página siguiente).
const CLAVE_AVISO = "vinci_aviso";
export function guardarAviso(aviso) {
  try { sessionStorage.setItem(CLAVE_AVISO, JSON.stringify(aviso)); } catch { /* sin almacenamiento */ }
}
export function tomarAviso() {
  try {
    const v = sessionStorage.getItem(CLAVE_AVISO);
    sessionStorage.removeItem(CLAVE_AVISO);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

/**
 * Pantalla de "no se puede mostrar" con enlace al inicio. Devuelve una promesa que no
 * termina: la página se queda en este mensaje sin dejar errores sin atrapar en la consola.
 * Uso: await sinAcceso(raiz, "Tareas", "Esta sección es de coordinación.");
 */
export function sinAcceso(raiz, titulo, texto) {
  poner(raiz, h("section", { class: "v-card", "aria-labelledby": "t-sin-acceso" },
    h("h1", { id: "t-sin-acceso", class: "v-h2" }, titulo),
    h("p", { class: "v-texto" }, texto),
    h("div", { class: "v-acciones" }, h("a", { class: "v-btn", href: RUTAS.inicio }, "Volver al inicio"))));
  return new Promise(() => {});
}

/** Texto para un error al cargar una página: 403 se explica; lo demás, el mensaje de la API. */
export const textoDeError = (e, sinPermiso) => (e?.status === 403 ? sinPermiso : e?.message || "No se pudo cargar la información.");
