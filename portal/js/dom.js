// Construcción de nodos sin innerHTML: todo texto entra como textContent.
// h("p", {class: "v-nota"}, "Hola ", h("strong", {}, nombre))

const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  aplicar(el, attrs);
  agregar(el, hijos);
  return el;
}

function aplicar(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;           // también en <textarea>, donde no hay atributo
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;      // value, checked, disabled...
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

function agregar(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/** Reemplaza el contenido de un nodo. */
export function poner(el, ...hijos) {
  el.replaceChildren();
  agregar(el, hijos);
  return el;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

// Íconos fijos (trazos propios, no datos del servidor).
const ICONOS = {
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  campana: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  archivo: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
};

export function icono(nombre, tam = 18, grosor = 2) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", tam);
  svg.setAttribute("height", tam);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", grosor);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONOS[nombre] || []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

/** Mensaje en línea (error, ok, info, aviso). */
export function mensaje(tipo, texto) {
  return h("p", { class: `v-msg v-msg--${tipo}`, role: tipo === "error" ? "alert" : "status" }, texto);
}
