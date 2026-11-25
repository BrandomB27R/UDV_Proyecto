// Decisión de quien revisa (mockup vinci-revision): dos recuadros lado a lado, «Si está bien» y
// «Si falta algo», cada uno con su explicación y su botón. Sin listas con círculos.
// Lo usan la página del programa y el detalle de una entrega.
import { h } from "./dom.js";

/**
 * opciones:
 *   guia: texto de arriba; irA: {texto, alPulsar} enlace a lo que se revisa (secciones o entrega)
 *   aprobar: {texto, extra, etiqueta, alPulsar} o null si quien mira no puede aprobar
 *   devolver: {texto, extra, docente, placeholder, valor, alEscribir(valor), alPulsar} o null
 *   nota: frase cuando falta una de las dos opciones (por qué no puede aprobar)
 *   ocupado: deshabilita los botones mientras se ejecuta una acción
 * Devuelve {nodo, campo} (campo: el textarea, para devolverle el foco si hace falta).
 */
export function bloqueDecision(op) {
  const recuadros = [];
  if (op.aprobar) {
    recuadros.push(h("div", { class: "rv-opcion rv-opcion--bien" },
      h("h3", { class: "rv-opcion__titulo" }, "Si está bien"),
      h("p", { class: "rv-opcion__texto" }, op.aprobar.texto),
      op.aprobar.extra ? h("p", { class: "rv-opcion__texto" }, op.aprobar.extra) : null,
      h("div", { class: "rv-opcion__pie" },
        h("button", { type: "button", class: "v-btn", disabled: !!op.ocupado, onclick: op.aprobar.alPulsar }, op.aprobar.etiqueta))));
  }
  let campo = null;
  if (op.devolver) {
    const d = op.devolver;
    const ayuda = h("span", { class: "v-nota rv-opcion__ayuda" }, "Se habilita al escribir la observación.");
    const boton = h("button", { type: "button", class: "v-btn v-btn--sec rv-btn-devolver", disabled: !String(d.valor || "").trim() || !!op.ocupado,
      onclick: d.alPulsar }, "Devolver con observación");
    ayuda.hidden = !boton.disabled || !!op.ocupado;
    campo = h("textarea", {
      id: "motivo", rows: 3, maxlength: 2000, value: d.valor || "", placeholder: d.placeholder || "",
      oninput: (e) => {
        d.alEscribir(e.target.value);
        e.target.removeAttribute("aria-invalid");
        boton.disabled = !e.target.value.trim() || !!op.ocupado;
        ayuda.hidden = !boton.disabled;
      },
    });
    recuadros.push(h("div", { class: "rv-opcion rv-opcion--falta" },
      h("h3", { class: "rv-opcion__titulo" }, "Si falta algo"),
      h("p", { class: "rv-opcion__texto" }, d.texto),
      d.extra ? h("p", { class: "rv-opcion__texto" }, d.extra) : null,
      h("div", { class: "v-campo" },
        h("label", { for: "motivo", class: "rv-opcion__etiqueta" }, h("strong", {}, `Observación para ${d.docente}`), h("span", {}, " · obligatoria para devolver")),
        campo),
      h("div", { class: "rv-opcion__pie" }, boton, ayuda)));
  }
  const nodo = h("div", { class: "rv-decision" },
    h("p", { class: "rv-guia" }, op.guia, " ",
      op.irA ? h("button", { type: "button", class: "v-enlace rv-guia__enlace", onclick: op.irA.alPulsar }, op.irA.texto) : null),
    op.nota ? h("p", { class: "v-nota rv-nota" }, op.nota) : null,
    h("div", { class: `rv-opciones${recuadros.length === 1 ? " rv-opciones--una" : ""}` }, recuadros));
  return { nodo, campo };
}
