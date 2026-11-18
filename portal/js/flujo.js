// Reglas del flujo vistas desde la pantalla: línea de estados, quién puede qué
// y qué falta para avanzar (requisito 2). Sin DOM: solo datos.
//
// Los botones salen de viewer_actions del detalle: las acciones que el estado permite
// y que puede ejecutar quien mira (el backend ya cruzó rol, revisor designado y creador).
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

/**
 * Qué puede hacer quien mira. Las acciones salen de viewer_actions: el backend ya cruzó
 * el estado con el rol, el revisor designado y quien creó la tarea. Aquí no se decide nada más.
 */
export function capacidades(a) {
  const va = new Set(a.viewer_actions || []);
  const esDestinatario = !!a.viewer?.is_assignee;
  return {
    start: va.has("start"),
    submit: va.has("submit"),
    resubmit: va.has("resubmit"),
    review: va.has("review"),
    return: va.has("return"),
    approve: va.has("approve"),
    close: va.has("close"),
    editarEntrega: esDestinatario && EDITABLES.includes(a.status),
    comentar: !!a.viewer?.can_comment,
    esDestinatario,
    esRevisor: !!a.viewer?.is_reviewer,
  };
}

/**
 * Qué pide la entrega según delivery.mode (texto, archivo, ambos, formulario o programa).
 * archivos: se pueden adjuntar; archivoObligatorio: el tipo lo exige (requiere_archivo);
 * textoObligatorio: el texto es la entrega (modo texto, o formulario sin archivo obligatorio); programa: se hace en el editor.
 */
export function formaDeEntrega(a) {
  const d = a.delivery || {};
  const modo = d.mode || (a.requiere_archivo ? "archivo" : "ambos");
  const archivoObligatorio = !!a.requiere_archivo;
  return {
    modo,
    programa: modo === "programa",
    archivos: archivoObligatorio || modo === "archivo" || modo === "ambos",
    archivoObligatorio,
    // El texto es la entrega solo en modo "texto" o en "formulario" sin archivo obligatorio (p. ej. Confirmar actividad).
    textoObligatorio: modo === "texto" || (modo === "formulario" && !archivoObligatorio),
    extensiones: (d.extensions || []).map((x) => String(x).toLowerCase()),
    noAceptadas: (d.not_accepted || []).map((x) => String(x).toLowerCase()),
    maxMb: Number(d.max_mb) || 5,
  };
}

const ETQ = { hecho: "hecho", pendiente: "pendiente", opcional: "opcional" };

/**
 * Lo que toca ahora. ctx: {texto, textoCambiado, leyoDevolucion, motivo, nombres: {docente, revisor, creador}, programa}
 * Devuelve {turno, eyebrow, titulo, resumen, requisitos, principal, secundaria}
 *   turno: "tuyo" | "espera" | "fin"
 *   requisitos: [{id, titulo, estado, detalle, nota}]
 *   principal/secundaria: {accion, etiqueta, habilitada, motivo}
 */
export function pasoActual(a, yo, ctx = {}) {
  const c = capacidades(a);
  const forma = formaDeEntrega(a);
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
      req.push({ id: "leer", titulo: "Lee la observación del revisor", obligatorio: true, estado: ctx.leyoDevolucion ? ETQ.hecho : ETQ.pendiente,
        detalle: ctx.leyoDevolucion ? "Leída." : "Es el recuadro de aquí arriba. Cuando la leas, márcala como leída." });
    } else {
      req.push({ id: "iniciar", titulo: "Iniciar la tarea", obligatorio: true, estado: ETQ.hecho, detalle: inicio ? `Hecho el ${fechaCorta(inicio.at)}` : "Hecho." });
    }
    if (forma.programa) {
      // ctx.programa: {avance: {listas, total, faltan}} de la versión ligada, o null si todavía no hay.
      const pv = a.program_version;
      const av = ctx.programa?.avance;
      const listo = !!av && av.listas === av.total;
      req.push({ id: "programa", titulo: "Completar el programa del curso", obligatorio: true, estado: listo ? ETQ.hecho : ETQ.pendiente,
        detalle: !pv ? "Ábrelo con «Completar el programa»: parte de la última versión autorizada del curso."
          : !av ? `Versión ${pv.number} · ${etiquetaEstadoPrograma(pv.status)}.`
            : listo ? `Las ${av.total} secciones están listas (versión ${pv.number}).`
              : `${av.listas} de ${av.total} secciones listas. Faltan ${av.faltan.map((x) => x.titulo).join(", ")}.`,
        avance: av ? av.listas / av.total : null });
    }
    // En una reentrega el texto anterior sigue en el borrador: solo cuenta si se cambió.
    const textoHecho = reentrega ? ctx.textoCambiado || (forma.textoObligatorio && textoListo) : textoListo;
    // Si el texto es la entrega se llama "Escribe tu entrega" y es obligatorio; si no, es un mensaje opcional.
    req.push({ id: "texto", titulo: forma.textoObligatorio ? "Escribe tu entrega" : "Mensaje para quien revisa",
      obligatorio: forma.textoObligatorio,
      estado: textoHecho ? ETQ.hecho : forma.textoObligatorio ? ETQ.pendiente : ETQ.opcional,
      nota: forma.textoObligatorio ? "obligatorio" : null,
      detalle: "Puedes escribirlo abajo, en «Tu entrega». Lo leerá quien revisa." });
    const tituloArchivo = reentrega ? "Adjunta un archivo nuevo" : "Adjunta un archivo";
    if (!forma.archivos) {
      // Este tipo no pide archivos: no se agrega el requisito.
    } else if (forma.archivoObligatorio) {
      req.push({ id: "archivo", titulo: tituloArchivo, obligatorio: true, estado: actuales.length ? ETQ.hecho : ETQ.pendiente,
        nota: "obligatorio en este tipo de tarea",
        detalle: actuales.length
          ? `${actuales.length} ${actuales.length === 1 ? "archivo adjunto" : "archivos adjuntos"} en este intento.`
          : (reentrega ? "El archivo del intento anterior no cuenta: adjunta uno nuevo abajo." : "Adjúntalo abajo, en «Tu entrega».") });
    } else {
      req.push({ id: "archivo", titulo: tituloArchivo, estado: actuales.length ? ETQ.hecho : ETQ.opcional,
        detalle: "Adjuntar archivos es opcional en este tipo de tarea." });
    }
    const etiquetas = { leer: "marques la observación como leída", programa: "el programa esté completo", archivo: "adjuntes el archivo", texto: "escribas tu entrega" };
    const faltan = req.filter((r) => r.estado === ETQ.pendiente);
    const destino = "Entregada";
    let motivo = "";
    if (faltan.length) {
      const partes = faltan.map((r) => etiquetas[r.id]).filter(Boolean);
      motivo = `Se habilita cuando ${partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}` : partes[0]}.`;
    }
    return {
      turno: "tuyo", eyebrow: "Te toca a ti",
      titulo: reentrega ? "Corrige y vuelve a entregar" : (forma.programa ? "Actualiza el programa y entrega" : "Prepara y envía tu entrega"),
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
    approved: ["Entrega aprobada", `Falta que ${ctx.nombres?.creador || "la coordinación"} cierre la tarea.`],
    closed: ["Tarea cerrada", "No queda nada pendiente."],
    cancelled: ["Tarea cancelada", "La coordinación canceló esta tarea."],
  }[a.status] || [etiquetaEstado(a.status), ""];
  return {
    turno: ["closed", "cancelled"].includes(a.status) ? "fin" : "espera",
    eyebrow: ["closed", "cancelled"].includes(a.status) ? "Terminada" : "En espera",
    titulo: espera[0], resumen: espera[1], requisitos: [], principal: null,
  };
}

const ESTADOS_PROGRAMA = { draft: "borrador", submitted: "enviada", under_review: "en revisión", returned: "devuelta", approved: "aprobada", authorized: "autorizada", superseded: "reemplazada" };
const etiquetaEstadoPrograma = (s) => ESTADOS_PROGRAMA[s] || s || "sin estado";

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
