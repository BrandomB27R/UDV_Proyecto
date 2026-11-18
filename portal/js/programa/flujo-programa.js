// Flujo de una versión del programa: línea de pasos y qué falta para avanzar (igual que en las tareas).
// Las acciones posibles vienen de accionesDeVersion (viewer_actions del backend).
import { fechaCorta } from "../formato.js";

export const ESTADOS_PROGRAMA = {
  draft: "Borrador", submitted: "Enviada", under_review: "En revisión", returned: "Devuelta",
  approved: "Aprobada", authorized: "Autorizada", superseded: "Reemplazada",
};
export const etiquetaEstadoPrograma = (s) => ESTADOS_PROGRAMA[s] || s || "Sin estado";
// Clase de etiqueta: se reutilizan los colores de las tareas (mismo significado).
// Autorizada en verde (el de «Aprobada» en las tareas) para que la vigente destaque de las reemplazadas y borradores.
export const claseEstadoPrograma = (s) => ({ draft: "draft", submitted: "submitted", under_review: "under_review", returned: "returned", approved: "approved", authorized: "approved", superseded: "cancelled" }[s] || "draft");

export const LINEA_PROGRAMA = ["draft", "submitted", "under_review", "approved", "authorized"];
const NOMBRE_PASO = { draft: "Borrador", submitted: "Enviada", under_review: "En revisión", approved: "Aprobada", authorized: "Autorizada" };

/** Pasos con marca hecho / actual / desvío. La reemplazada se muestra como autorizada (ya lo fue). */
export function lineaPrograma(v) {
  const estado = v.estado === "superseded" ? "authorized" : v.estado;
  const pasos = LINEA_PROGRAMA.map((e) => ({ estado: e, etiqueta: NOMBRE_PASO[e], marca: "", dato: "" }));
  if (estado === "returned") {
    pasos.forEach((p, i) => { if (i <= 2) p.marca = "hecho"; });
    pasos.splice(3, 0, { estado: "returned", etiqueta: "Devuelta", marca: "desvio", dato: "Corrige y vuelve a enviar" });
    return pasos;
  }
  const i = LINEA_PROGRAMA.indexOf(estado);
  pasos.forEach((p, j) => {
    if (j < i) p.marca = "hecho";
    else if (j === i) {
      p.marca = estado === "authorized" ? "hecho" : "actual";
      p.dato = estado === "authorized" ? (v.autorizado_en ? fechaCorta(v.autorizado_en) : "Vigente") : "Paso actual";
    }
  });
  return pasos;
}

export function resumenPasoPrograma(estado) {
  if (estado === "returned") return "Devuelta · corrige y vuelve a enviar";
  if (estado === "superseded") return "Reemplazada por una versión más reciente";
  const i = LINEA_PROGRAMA.indexOf(estado);
  return i < 0 ? etiquetaEstadoPrograma(estado) : `Paso ${i + 1} de ${LINEA_PROGRAMA.length} · ${NOMBRE_PASO[estado]}`;
}

/**
 * Qué toca ahora. ctx: {acciones: Set, avance: {listas, total, faltan}, sinGuardar: [titulos], motivo, responsable}
 * Devuelve {turno, eyebrow, titulo, resumen, requisitos, principal, secundaria, conMotivo}.
 */
export function pasoPrograma(v, ctx) {
  const a = ctx.acciones;
  const { listas, total, faltan } = ctx.avance;
  const sinGuardar = ctx.sinGuardar || [];
  const quien = ctx.responsable || "el docente responsable";

  if (a.has("submit") || (a.has("edit") && ["draft", "returned"].includes(v.estado))) {
    const req = [{
      id: "secciones", titulo: "Completa las nueve secciones", estado: faltan.length ? "pendiente" : "hecho",
      detalle: faltan.length ? `${listas} de ${total} listas. Faltan ${faltan.map((x) => x.titulo).join(", ")}.` : `Las ${total} secciones están listas.`,
    }];
    if (sinGuardar.length) req.push({ id: "guardar", titulo: "Guarda tus cambios", estado: "pendiente", detalle: `Sin guardar: ${sinGuardar.join(", ")}.` });
    const faltanReq = req.filter((r) => r.estado === "pendiente");
    const puedeEnviar = a.has("submit");
    return {
      turno: "tuyo", eyebrow: "Te toca a ti",
      titulo: v.estado === "returned" ? "Corrige el programa y vuelve a enviarlo" : "Completa el programa y envíalo a revisión",
      resumen: !puedeEnviar ? "Puedes editarlo; el envío lo hace el docente responsable."
        : faltanReq.length ? `Para pasar a «Enviada» ${faltanReq.length === 1 ? "falta un requisito" : `faltan ${faltanReq.length} requisitos`}.`
          : "Todo listo: ya puedes enviarlo a revisión.",
      requisitos: req,
      principal: puedeEnviar ? { accion: "submit", etiqueta: v.estado === "returned" ? "Reenviar a revisión" : "Enviar a revisión", habilitada: !faltanReq.length,
        motivo: faltanReq.length ? (sinGuardar.length && !faltan.length ? "Se habilita cuando guardes tus cambios." : "Se habilita cuando las nueve secciones estén listas.") : "" } : null,
    };
  }
  if (a.has("review")) {
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Revisa el programa",
      resumen: "Tómalo para empezar a revisarlo; quien lo elaboró verá que está en revisión.",
      requisitos: [{ id: "tomar", titulo: "Toma el programa para revisarlo", estado: "pendiente", detalle: "Pasa a «En revisión»." }],
      principal: { accion: "review", etiqueta: "Comenzar revisión", habilitada: true },
    };
  }
  if (a.has("approve") || a.has("return")) {
    const motivoListo = !!(ctx.motivo || "").trim();
    const req = [{ id: "leer", titulo: "Revisa las nueve secciones", estado: "opcional", detalle: "Están abajo, cada una con su contenido." }];
    if (a.has("return")) req.push({ id: "motivo", titulo: "Para devolver, escribe la observación", estado: motivoListo ? "hecho" : "pendiente", nota: "obligatoria para devolver" });
    const devolver = a.has("return") ? { accion: "return", etiqueta: "Devolver", habilitada: motivoListo, motivo: motivoListo ? "" : "«Devolver» se habilita cuando escribas la observación." } : null;
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: a.has("approve") ? "Aprueba o devuelve el programa" : "Revisa el programa",
      resumen: a.has("approve") ? "Si está bien, apruébalo; luego dirección lo autoriza. Si falta algo, devuélvelo con una observación."
        : "Puedes devolverlo con una observación. Aprobarlo le corresponde a otra persona: quien lo elaboró no lo aprueba.",
      requisitos: req, conMotivo: true,
      principal: a.has("approve") ? { accion: "approve", etiqueta: "Aprobar", habilitada: true } : devolver,
      secundaria: a.has("approve") ? devolver : null,
    };
  }
  if (a.has("authorize")) {
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Autoriza el programa",
      resumen: "Al autorizarlo queda como la versión vigente del curso y se genera su PDF oficial. Si había otra vigente, pasa a «Reemplazada».",
      requisitos: [{ id: "aprobada", titulo: "Programa aprobado", estado: "hecho", detalle: "Revisado y aprobado por coordinación." }],
      principal: { accion: "authorize", etiqueta: "Autorizar", habilitada: true },
    };
  }

  const espera = {
    draft: [`En elaboración por ${quien}`, "Lo podrás revisar cuando lo envíe."],
    returned: [`Devuelto a ${quien} para corrección`, ""],
    submitted: ["En espera de revisión", "Lo revisa coordinación."],
    under_review: ["En revisión por coordinación", ""],
    approved: ["En espera de autorización", "Lo autoriza dirección."],
    authorized: ["Versión vigente", "Es la versión oficial del curso. Para cambiarla se abre una versión nueva."],
    superseded: ["Versión reemplazada", "Se conserva para consulta; la vigente es otra versión."],
  }[v.estado] || [etiquetaEstadoPrograma(v.estado), ""];
  return {
    turno: ["authorized", "superseded"].includes(v.estado) ? "fin" : "espera",
    eyebrow: ["authorized", "superseded"].includes(v.estado) ? "Solo lectura" : "En espera",
    titulo: espera[0], resumen: espera[1], requisitos: [], principal: null,
  };
}
