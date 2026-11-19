// "Ver cambios": GET /program-versions/{id}/changes con etiquetas legibles y sin identificadores internos.
import { tituloSeccion as tituloBase, nombreNivel } from "./secciones.js";

const tituloSeccion = (id) => (id === "responsables" ? "Responsables" : tituloBase(id));

const CAMPOS = {
  asignatura: "asignatura", programa: "programa académico", departamento: "departamento", nivel: "nivel", pensum: "pénsum",
  horas: "horas", resumen_cambios: "resumen de cambios", texto: "texto", ciclo: "período", sede: "sede", modalidad: "modalidad",
  tipo: "tipo", descripcion: "descripción", referencia: "referencia", isbn: "ISBN", url: "enlace", codigo: "código", nombre: "nombre",
  contribucion: "contribución", titulo: "título", item: "tema", actividad: "actividad", evidencia: "evidencia", punteo: "punteo",
  ponderacion: "ponderación", semana: "semana", docente: "docente", revisor: "revisor", autoridad: "autoridad",
  decanatura: "decanatura", coordinador: "coordinación", estado: "estado",
};
const NOMBRE_FILA = { prerrequisitos: "prerrequisito", competencias: "competencia", perfil: "rasgo", bibliografia: "referencia", evaluacion: "actividad", contenidos: "unidad" };

// Identificadores y orden: cambian en cada versión sin que cambie el contenido.
// El estado tampoco: siempre difiere (la anterior está autorizada) y ya se ve en la cabecera.
const ES_INTERNO = /(^|\.)(id|[a-z_]+_id|orden)$|^estado$/;

/** "contenidos.contenido[1].items[0].item" → "unidad 2 · tema 1" (la sección va en el título del grupo). */
export function etiquetaCampo(campo) {
  const partes = campo.split(".");
  const seccion = partes.shift();
  if (seccion === "estado") return "Estado";
  const out = [];
  for (const p of partes) {
    if (p === "contenido") continue;
    const m = /^(\w+)\[(\d+)\]$/.exec(p);
    if (m) {
      const n = Number(m[2]) + 1;
      out.push(m[1] === "items" ? `tema ${n}` : m[1] === "contenido" ? `${NOMBRE_FILA[seccion] || "fila"} ${n}` : `${CAMPOS[m[1]] || m[1]} ${n}`);
    } else {
      out.push(CAMPOS[p] || p.replace(/_/g, " "));
    }
  }
  const t = out.join(" · ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : tituloSeccion(seccion);
}

export function valorLegible(v) {
  if (v == null || v === "") return "(vacío)";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Filtra y agrupa por sección: [{seccion, titulo, cambios: [{etiqueta, anterior, actual}]}]. */
export function cambiosLegibles(respuesta) {
  const grupos = new Map();
  for (const c of respuesta?.cambios || []) {
    if (ES_INTERNO.test(c.campo)) continue;
    const seccion = c.campo.split(".")[0];
    if (!grupos.has(seccion)) grupos.set(seccion, []);
    // El nivel viene como código («maestria»): se muestra con su nombre. La API lo nombra «general.contenido.nivel».
    const esNivel = /^general\.(contenido\.)?nivel$/.test(c.campo);
    const ver = (x) => valorLegible(esNivel && typeof x === "string" ? nombreNivel(x) : x);
    grupos.get(seccion).push({ etiqueta: etiquetaCampo(c.campo), anterior: ver(c.anterior), actual: ver(c.actual) });
  }
  return [...grupos.entries()].map(([seccion, cambios]) => ({ seccion, titulo: seccion === "estado" ? "Estado" : tituloSeccion(seccion), cambios }));
}
