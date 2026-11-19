// Listas del inicio como resumen: como máximo TOPE filas, la etiqueta «Resumen» junto al título y un pie
// con cuántas se muestran de cuántas hay y el enlace a la sección donde está el detalle completo.
import { h } from "../dom.js";

export const TOPE = 5;

/** Cabecera de una lista del inicio: título, etiqueta «Resumen» y una nota. */
export function cabResumen(id, titulo, nota) {
  return h("div", { class: "ini-cab" },
    h("h2", { id, class: "v-h2" }, titulo),
    h("span", { class: "ini-resumen" }, "Resumen"),
    nota ? h("p", { class: "v-nota" }, nota) : null);
}

/**
 * Pie: «Mostrando 5 de 8 entregas por revisar.» (o «Mostrando 3 de 3.») y el enlace a la derecha.
 * que: lo que se cuenta, en plural («entregas por revisar»). enlace: {texto, href}.
 */
export function pieResumen(mostrados, total, que, enlace) {
  const texto = mostrados < total ? `Mostrando ${mostrados} de ${total} ${que}.` : `Mostrando ${total} de ${total}.`;
  return h("div", { class: "ini-pie-resumen" },
    h("p", {}, texto),
    enlace ? h("a", { class: "ini-enlace", href: enlace.href }, enlace.texto, h("span", { "aria-hidden": "true" }, " →")) : null);
}

/** «Verla en Por revisar» (una) / «Ver las 8 en Por revisar»; masculino: «Verlo en …» / «Ver los 3 en …». */
export const verLasN = (n, donde, masculino = false) =>
  n === 1 ? `Ver${masculino ? "lo" : "la"} en ${donde}` : `Ver ${masculino ? "los" : "las"} ${n} en ${donde}`;
