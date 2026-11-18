// Reglas del flujo vistas desde la pantalla: línea de estados, quién puede qué
// y qué falta para avanzar (requisito 2). Sin DOM: solo datos.
//
// Quien decide de verdad es el G3 al ejecutar la acción; esto solo evita pintar
// botones que van a fallar. allowed_actions depende del estado, no de quien mira
// (trampa 3), así que se cruza con viewer y con la unión de roles.
import { etiquetaEstado, fechaCorta } from "./formato.js";

export const LINEA = ["assigned", "in_progress", "submitted", "under_review", "approved", "closed"];
export const EDITABLES = ["in_progress", "returned"];   // estados en que el docente prepara la entrega

const ultimaVez = (a, estado) => {
  const h = (a.history || []).filter((x) => x.new_status === estado);
  return h.length ? h[h.length - 1] : null;
};

/** Número de envíos ya hechos (submit + resubmit). */
export const envios = (a) => (a.history || []).filter((x) => x.new_status === "submitted").length;

/** Archivos del intento en preparación (los de intentos ya enviados no cuentan: trampa 5). */
export function archivosDelIntentoActual(a) {
  const n = envios(a);
  return (a.files || []).filter((f) => Number(f.attempt) > n);
}

/** Archivos agrupados por intento, del más reciente al más antiguo. */
export function archivosPorIntento(a) {
  const grupos = new Map();
  for (const f of a.files || []) {
    const k = Number(f.attempt) || 1;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  return [...grupos.entries()].sort((x, y) => y[0] - x[0]).map(([intento, archivos]) => ({ intento, archivos }));
}

/** Pasos de la línea con su marca. Devuelve null si la asignación está cancelada. */
export function lineaDeEstados(a) {
  if (a.status === "cancelled") return null;
  const pasos = LINEA.map((estado) => ({ estado, etiqueta: etiquetaEstado(estado), marca: "", dato: "" }));
  if (a.status === "returned") {
    // Desvío: después de "En revisión" aparece "Devuelta" y el flujo vuelve a "Entregada".
    pasos.forEach((p, i) => { if (i <= 3) marcarHecho(a, p); });
    const dev = ultimaVez(a, "returned");
    pasos.splice(4, 0, { estado: "returned", etiqueta: "Devuelta", marca: "desvio", dato: dev ? `Corrige y reentrega · ${fechaCorta(dev.at)}` : "Corrige y reentrega" });
    return pasos;
  }
  const actual = LINEA.indexOf(a.status);
  pasos.forEach((p, i) => {
    if (i < actual) marcarHecho(a, p);
    else if (i === actual) {
      p.marca = a.status === "closed" ? "hecho" : "actual";
      p.dato = a.status === "closed" ? fechaCorta(ultimaVez(a, "closed")?.at) : "Paso actual";
      if (a.status === "submitted" && envios(a) > 1) p.dato = `Paso actual · intento ${envios(a)}`;
    }
  });
  return pasos;
}

function marcarHecho(a, p) {
  p.marca = "hecho";
  p.dato = fechaCorta(ultimaVez(a, p.estado)?.at);
}

/** Qué puede hacer quien mira. */
export function capacidades(a, yo) {
  const roles = new Set(yo.roles || []);
  const permitidas = new Set(a.allowed_actions || []);
  const esDestinatario = !!a.viewer?.is_assignee;
  const esRevisor = !!a.viewer?.is_reviewer;          // designado; sin designado: coordinación o admin
  const docente = esDestinatario && roles.has("teacher");
  const revisa = esRevisor && (roles.has("reviewer") || roles.has("coordinator") || roles.has("admin"));
  return {
    start: docente && permitidas.has("start"),
    submit: docente && permitidas.has("submit"),
    resubmit: docente && permitidas.has("resubmit"),
    review: revisa && permitidas.has("review"),
    return: revisa && permitidas.has("return"),
    // Aprueba el revisor designado o quien tenga authority (dirección), aunque no sea el designado.
    approve: permitidas.has("approve") && (roles.has("authority") || (esRevisor && roles.has("reviewer"))),
    // El G4 no incluye "close" en allowed_actions: se decide por estado y rol. El G3 exige además
    // ser quien creó la tarea o su responsable; si no lo es, el mensaje del 403 se muestra tal cual.
    close: a.status === "approved" && roles.has("coordinator"),
    editarEntrega: esDestinatario && EDITABLES.includes(a.status),
    comentar: esDestinatario || roles.has("coordinator") || roles.has("admin") || (esRevisor && roles.has("reviewer")),
    esDestinatario,
    esRevisor,
  };
}

const ETQ = { hecho: "hecho", pendiente: "pendiente", opcional: "opcional" };

/**
 * Lo que toca ahora. ctx: {texto, leyoDevolucion, motivo, nombres: {docente, revisor}, esPrograma}
 * Devuelve {turno, eyebrow, titulo, resumen, requisitos, principal, secundaria}
 *   turno: "tuyo" | "espera" | "fin"
 *   requisitos: [{id, titulo, estado, detalle, nota}]
 *   principal/secundaria: {accion, etiqueta, habilitada, motivo}
 */
export function pasoActual(a, yo, ctx = {}) {
  const c = capacidades(a, yo);
  const docente = ctx.nombres?.docente || "el docente";
  const revisor = ctx.nombres?.revisor || "la coordinación";
  const actuales = archivosDelIntentoActual(a);
  const textoListo = !!(ctx.texto || "").trim();
  const inicio = ultimaVez(a, "in_progress");

  // ── Docente destinatario ──
  if (c.start) {
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Inicia la tarea",
      resumen: "Al iniciarla pasa a «En curso» y podrás preparar tu entrega.",
      requisitos: [{ id: "iniciar", titulo: "Iniciar la tarea", estado: ETQ.pendiente, detalle: "Lee las instrucciones y la fecha límite antes de empezar." }],
      principal: { accion: "start", etiqueta: "Iniciar la tarea", habilitada: true },
    };
  }
  if (c.submit || c.resubmit) {
    const reentrega = c.resubmit;
    const req = [];
    if (reentrega) {
      req.push({ id: "leer", titulo: "Lee la observación del revisor", estado: ctx.leyoDevolucion ? ETQ.hecho : ETQ.pendiente,
        detalle: ctx.leyoDevolucion ? "Leída." : "Es el recuadro de aquí arriba. Cuando la leas, márcala como leída." });
    } else {
      req.push({ id: "iniciar", titulo: "Iniciar la tarea", estado: ETQ.hecho, detalle: inicio ? `Hecho el ${fechaCorta(inicio.at)}` : "Hecho." });
    }
    if (ctx.esPrograma) {
      req.push({ id: "programa", titulo: "Actualiza el programa del curso", estado: ETQ.opcional, nota: "en el editor de programas",
        detalle: "Los cambios del programa se hacen en su propia pantalla. Luego vuelve aquí para entregar." });
    }
    req.push({ id: "texto", titulo: reentrega ? "Ajusta el texto de tu entrega" : "Escribe tu entrega",
      // En una reentrega el texto anterior sigue en el borrador: solo cuenta si se cambió.
      estado: (reentrega ? ctx.textoCambiado : textoListo) ? ETQ.hecho : ETQ.opcional,
      detalle: "Puedes escribirlo abajo, en «Tu entrega». Lo leerá quien revisa." });
    const tituloArchivo = reentrega ? "Adjunta un archivo nuevo" : "Adjunta un PDF";
    if (a.requiere_archivo) {
      req.push({ id: "archivo", titulo: tituloArchivo, estado: actuales.length ? ETQ.hecho : ETQ.pendiente,
        nota: "obligatorio en este tipo de tarea",
        detalle: actuales.length
          ? `${actuales.length} ${actuales.length === 1 ? "archivo adjunto" : "archivos adjuntos"} en este intento.`
          : (reentrega ? "El archivo del intento anterior no cuenta: adjunta uno nuevo abajo." : "Adjúntalo abajo, en «Tu entrega».") });
    } else {
      req.push({ id: "archivo", titulo: tituloArchivo, estado: actuales.length ? ETQ.hecho : ETQ.opcional,
        detalle: "Adjuntar archivos es opcional en este tipo de tarea." });
    }
    const faltan = req.filter((r) => r.estado === ETQ.pendiente);
    const destino = "Entregada";
    let motivo = "";
    if (faltan.length) {
      motivo = faltan.some((r) => r.id === "archivo") && faltan.some((r) => r.id === "leer")
        ? "Se habilita cuando leas la observación y adjuntes el archivo."
        : faltan[0].id === "archivo" ? "Se habilita cuando adjuntes el archivo." : "Se habilita cuando marques la observación como leída.";
    }
    return {
      turno: "tuyo", eyebrow: "Te toca a ti",
      titulo: reentrega ? "Corrige y vuelve a entregar" : (ctx.esPrograma ? "Actualiza el programa y entrega" : "Prepara y envía tu entrega"),
      resumen: faltan.length
        ? `Para pasar a «${destino}» ${faltan.length === 1 ? "falta un requisito" : `faltan ${faltan.length} requisitos`}.`
        : `Todo listo: ya puedes ${reentrega ? "reentregar" : "entregar"}.`,
      requisitos: req,
      principal: { accion: reentrega ? "resubmit" : "submit", etiqueta: reentrega ? "Reentregar" : "Entregar", habilitada: !faltan.length, motivo },
    };
  }

  // ── Revisión ──
  if (c.review) {
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Revisa la entrega",
      resumen: `${capital(docente)} ya entregó. Toma la entrega para empezar a revisarla.`,
      requisitos: [{ id: "tomar", titulo: "Toma la entrega para revisarla", estado: ETQ.pendiente,
        detalle: "Pasa a «En revisión»; el docente verá que la estás revisando." }],
      principal: { accion: "review", etiqueta: "Comenzar revisión", habilitada: true },
    };
  }
  if (c.return || c.approve) {
    const motivoListo = !!(ctx.motivo || "").trim();
    const req = [
      { id: "revisar", titulo: "Revisa el texto y los archivos", estado: ETQ.opcional, detalle: "Están abajo, en «La entrega»." },
    ];
    if (c.return) {
      req.push({ id: "motivo", titulo: "Para devolver, escribe el motivo", estado: motivoListo ? ETQ.hecho : ETQ.pendiente,
        nota: "obligatorio para devolver", detalle: "El docente lo verá como «Observación del revisor»." });
    }
    const devolver = c.return ? { accion: "return", etiqueta: "Devolver", habilitada: motivoListo, motivo: motivoListo ? "" : "«Devolver» se habilita cuando escribas el motivo." } : null;
    if (c.approve) {
      return {
        turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Aprueba o devuelve la entrega",
        resumen: "Si todo está bien, apruébala. Si falta algo, devuélvela con una observación.",
        requisitos: req,
        principal: { accion: "approve", etiqueta: "Aprobar", habilitada: true },
        secundaria: devolver,
        conMotivo: !!c.return,
      };
    }
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Revisa la entrega",
      resumen: "Puedes devolverla con una observación. Aprobarla le corresponde a dirección.",
      requisitos: req, principal: devolver, conMotivo: true,
    };
  }
  if (c.close) {
    const ap = ultimaVez(a, "approved");
    return {
      turno: "tuyo", eyebrow: "Te toca a ti", titulo: "Cierra la tarea",
      resumen: "La entrega está aprobada. Al cerrarla queda terminada con su historial completo.",
      requisitos: [{ id: "aprobada", titulo: "Entrega aprobada", estado: ETQ.hecho, detalle: ap ? `${ap.actor || "Aprobada"} · ${fechaCorta(ap.at)}` : "Aprobada." }],
      principal: { accion: "close", etiqueta: "Cerrar la tarea", habilitada: true },
    };
  }

  // ── No le toca a quien mira: se dice a quién ──
  const tu = c.esDestinatario;
  const espera = {
    assigned: [`En espera de que ${tu ? "inicies" : `${docente} inicie`} la tarea`, ""],
    in_progress: [tu ? "Estás preparando tu entrega" : `${capital(docente)} está preparando su entrega`, ""],
    returned: [tu ? "Te devolvieron la entrega" : `Devuelta a ${docente} para corrección`, ""],
    submitted: [`En espera de revisión por ${revisor}`, tu ? "Recibirás un aviso cuando la revisen." : ""],
    under_review: [ctx.nombres?.revisor ? `${capital(revisor)} está revisando la entrega` : `En revisión por ${revisor}`, tu ? "Recibirás un aviso con el resultado." : ""],
    approved: ["Entrega aprobada", "Falta que la coordinación cierre la tarea."],
    closed: ["Tarea cerrada", "No queda nada pendiente."],
    cancelled: ["Tarea cancelada", "La coordinación canceló esta tarea."],
  }[a.status] || [etiquetaEstado(a.status), ""];
  return {
    turno: ["closed", "cancelled"].includes(a.status) ? "fin" : "espera",
    eyebrow: ["closed", "cancelled"].includes(a.status) ? "Terminada" : "En espera",
    titulo: espera[0], resumen: espera[1], requisitos: [], principal: null,
  };
}

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Frase del historial: "Diana Pérez inició la tarea". */
export function fraseHistorial(item) {
  const verbo = {
    assigned: "publicó la tarea",
    in_progress: "inició la tarea",
    submitted: item.action === "resubmit" ? "volvió a entregar" : "entregó",
    under_review: "tomó la entrega para revisión",
    returned: "devolvió la entrega",
    approved: "aprobó la entrega",
    closed: "cerró la tarea",
    cancelled: "canceló la tarea",
  }[item.new_status] || `cambió el estado a «${etiquetaEstado(item.new_status)}»`;
  return `${item.actor || "Alguien"} ${verbo}`;
}
