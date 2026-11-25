// Auditoría en palabras: acciones, entidades, "sobre qué" y "qué cambió" sin JSON ni códigos.
// Sin DOM: devuelve datos que pinta js/paginas/auditoria.js.
import { ESTADOS, PRIORIDADES, ROLES, legible, fechaLarga, fechaCorta } from "../formato.js";
import { ESTADOS_PROGRAMA } from "../programa/flujo-programa.js";
import { RUTAS } from "../config.js";

// ── Acciones ────────────────────────────────────────────────
const ACCIONES = {
  insert: "Creó", update: "Modificó", soft_delete: "Dio de baja", transition: "Cambió de estado",
  LOGIN_OK: "Inició sesión", LOGOUT: "Cerró sesión", LOGIN_FALLIDO: "Intento fallido",
  LOGIN_BLOQUEADO: "Intento bloqueado",
};
// Clase del chip: el intento fallido o bloqueado va en rojo; dar de baja en naranja; lo demás neutro o azul.
const TONO_ACCION = { LOGIN_FALLIDO: "fallo", LOGIN_BLOQUEADO: "fallo", soft_delete: "baja", transition: "estado" };

export const etiquetaAccion = (a) => ACCIONES[a] || legible(a);

// ── Entidades ───────────────────────────────────────────────
const ENTIDADES = {
  usuario: "Usuario", auth: "Sesión", sesion_token: "Sesión", tarea: "Tarea",
  tarea_destinatario: "Asignación", programa_version: "Versión de programa", tipo_tarea: "Tipo de tarea",
};
export const etiquetaEntidad = (e) => ENTIDADES[e] || legible(e);
// Para "La tarea dejó de listarse": artículo y pronombre de cada entidad.
const GENERO = { tarea: "f", tarea_destinatario: "f", programa_version: "f", sesion_token: "f", auth: "f" };

/** Opciones del filtro "Qué se tocó": las entidades de /audit/filters con nombre legible, sin repetir. */
export function opcionesEntidad(entidades = []) {
  return entidades.map((e) => ({ valor: e, texto: etiquetaEntidad(e) }))
    .sort((a, b) => a.texto.localeCompare(b.texto, "es"));
}
export function opcionesAccion(acciones = []) {
  return acciones.map((a) => ({ valor: a, texto: etiquetaAccion(a) })).sort((a, b) => a.texto.localeCompare(b.texto, "es"));
}

// ── Campos y valores ────────────────────────────────────────
const CAMPOS = {
  estado: "Estado", titulo: "Título", nombre: "Nombre", nombres: "Nombres", apellidos: "Apellidos", correo: "Correo",
  fecha_limite: "Fecha límite", revisor_id: "Revisor", eliminado_en: "Fecha de baja", eliminado_por: "Dado de baja por",
  activo: "Activo", numero_version: "Número de versión", programa_curso_id: "Programa", version_origen_id: "Versión de origen",
  horas_clase_semanal: "Horas por semana", descripcion: "Descripción", prioridad: "Prioridad", resumen_cambios: "Resumen de cambios",
  docente_responsable_id: "Docente responsable", publicada_en: "Fecha de publicación", periodo_id: "Período",
  curso_id: "Curso", sede_id: "Sede", codigo: "Código",
  modalidad_entrega: "Cómo se entrega", requiere_archivo: "Archivo obligatorio", roles: "Roles",
};
// Orden de los roles al mostrarlos (el mismo de la pestaña Usuarios).
const ORDEN_ROLES = ["teacher", "coordinator", "reviewer", "authority", "auditor", "admin"];
// Modalidad de entrega de un tipo de tarea (G1). Si exige archivo lo dice «Archivo obligatorio».
const MODALIDAD_ENTREGA = { texto: "Solo texto", ambos: "Texto y archivo", archivo: "Archivo", formulario: "Formulario", programa: "Programa de curso" };
// Nunca se muestran (valores enmascarados, hashes, contraseñas, tokens).
const OCULTO = /contrasena|password|hash|token|secret|clave/i;
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
const CAMPOS_USUARIO = new Set(["revisor_id", "docente_responsable_id", "eliminado_por", "creado_por"]);

const etiquetaCampo = (k) => CAMPOS[k] || legible(k);

/** Nombre del estado según la entidad (las tareas guardan "publicada" con el código del G1). */
function nombreEstado(entidad, v) {
  if (entidad === "programa_version") return ESTADOS_PROGRAMA[v] || legible(v);
  if (entidad === "tarea") return v === "draft" ? "Borrador" : v === "cancelled" ? "Cancelada" : "Publicada";
  return ESTADOS[v] || legible(v);
}

/** Valor legible de un campo. ctx.usuarios: Map id → {name, email} (de /audit/filters). */
export function valorLegible(entidad, campo, v, ctx = {}) {
  if (v === null || v === undefined || v === "") return "—";
  if (campo === "estado") return nombreEstado(entidad, v);
  if (campo === "prioridad") return PRIORIDADES[v] || legible(v);
  if (typeof v === "boolean" || ((campo === "activo" || campo === "requiere_archivo") && (v === 0 || v === 1))) return v ? "Sí" : "No";
  if (campo === "modalidad_entrega") return MODALIDAD_ENTREGA[v] || legible(v);
  // Roles de un usuario (vinci-17): lista de códigos → «Docente · Revisión».
  if (campo === "roles" && Array.isArray(v)) {
    if (!v.length) return "Ninguno";
    const orden = (c) => { const i = ORDEN_ROLES.indexOf(c); return i < 0 ? 99 : i; };
    return [...v].sort((a, b) => orden(a) - orden(b)).map((c) => ROLES[c] || legible(c)).join(" · ");
  }
  if (CAMPOS_USUARIO.has(campo)) { const u = ctx.usuarios?.get(Number(v)); return u?.name || u?.email || `usuario n.º ${v}`; }
  if (campo === "fecha_limite") return fechaLarga(v);
  if (typeof v === "string" && FECHA_HORA.test(v)) return fechaCorta(v.replace(" ", "T"));
  if (typeof v === "object") return "(varios datos)";
  return String(v);
}

const visible = (k, v) => !OCULTO.test(k) && v !== "***";

/**
 * Qué cambió: [{campo, antes, despues}] solo con los campos distintos y visibles.
 * En un alta (sin «antes») van los datos con valor, con antes = null.
 */
export function cambiosDe(r, ctx = {}) {
  const ch = r.changes || {};
  const antes = ch.antes && typeof ch.antes === "object" ? ch.antes : null;
  const despues = ch.despues && typeof ch.despues === "object" ? ch.despues : null;
  if (!antes && !despues) return [];
  const claves = [...new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})])];
  const out = [];
  for (const k of claves) {
    const a = antes?.[k];
    const d = despues?.[k];
    if (!visible(k, a) || !visible(k, d)) continue;
    if (antes && JSON.stringify(a ?? null) === JSON.stringify(d ?? null)) continue;
    if (!antes && (d === null || d === undefined || d === "")) continue;
    out.push({ campo: etiquetaCampo(k), clave: k, antes: antes ? valorLegible(r.entity, k, a, ctx) : null, despues: valorLegible(r.entity, k, d, ctx) });
  }
  // La clave nunca se muestra: el G1 solo anota si cambió (cambio_contrasena, fuera de antes/después).
  if (r.entity === "usuario" && (ch.cambio_contrasena === true || ch.cambio_contrasena === 1)) {
    out.push({ campo: "Clave", clave: "cambio_contrasena", antes: null, despues: "Cambió la clave" });
  }
  return out;
}

/** La acción que se muestra: un update cuyo único cambio es el estado es «Cambió de estado». */
export function accionMostrada(r, cambios) {
  if (r.action === "update" && cambios.length === 1 && cambios[0].clave === "estado") return { texto: "Cambió de estado", tono: "estado" };
  const sinCambio = updateSinCambios(r, cambios);
  if (sinCambio) return { texto: sinCambio.accion, tono: "" };
  return { texto: etiquetaAccion(r.action), tono: TONO_ACCION[r.action] || "" };
}

/**
 * Un update sin cambios visibles (casi la mitad de la auditoría) no se oculta: se explica qué pasó.
 *   programa_version: neutro, porque puede ser una sección del docente o coordinación que toma la revisión.
 *   usuario, hecho por el mismo usuario: el registro interno de su inicio de sesión.
 *   cualquier otro: «Modificó» sin cambios en los datos que se registran.
 */
function updateSinCambios(r, cambios) {
  if (r.action !== "update" || cambios.length) return null;
  if (r.entity === "programa_version") return { accion: "Actualizó el programa", texto: "Guardó datos del programa." };
  if (r.entity === "usuario" && r.actor_id != null && Number(r.actor_id) === Number(r.entity_id)) {
    return { accion: "Actualizó su acceso", texto: "Registro interno del inicio de sesión." };
  }
  return { accion: etiquetaAccion(r.action), texto: "Sin cambios en los datos que se registran." };
}

/**
 * Sobre qué: {entidad, nombre, href}. El nombre es entity_label de la API (vinci-14); si viene null,
 * el de changes (titulo, nombre, correo) y, si tampoco, «n.º id».
 */
export function sobreQue(r) {
  const ch = r.changes || {};
  const datos = { ...(ch.antes || {}), ...(ch.despues || {}) };
  const sesion = ["auth", "sesion_token"].includes(r.entity);
  const nombre = r.entity_label || datos.titulo || datos.nombre || datos.correo
    || (sesion ? null : r.entity_id != null && r.entity_id !== 0 ? `n.º ${r.entity_id}` : null);
  // Solo páginas que administración y auditoría pueden abrir (el detalle de una tarea es de coordinación).
  const href = r.entity === "tarea_destinatario" && r.entity_id ? RUTAS.asignacion(r.entity_id)
    : r.entity === "programa_version" && r.entity_id ? RUTAS.programa(r.entity_id) : null;
  return { entidad: etiquetaEntidad(r.entity), nombre, href };
}

/**
 * Lo que va en «Qué cambió»: {tipo, ...}
 *   tipo "cambios": {cambios}         lista campo: antes → después (o «campo: valor» en un alta)
 *   tipo "texto":   {texto, tono}     una frase (baja, intento fallido)
 *   tipo "vacio":                      «Sin cambios en los datos»
 */
export function queCambio(r, cambios) {
  if (r.action === "LOGIN_FALLIDO") {
    const correo = r.changes?.correo;
    return { tipo: "texto", tono: "fallo", texto: "Correo o contraseña incorrectos", nota: correo ? `Correo usado: ${correo}` : null };
  }
  if (r.action === "LOGIN_BLOQUEADO") {
    const correo = r.changes?.correo;
    return { tipo: "texto", tono: "fallo", texto: "La dirección estaba bloqueada para esta cuenta por intentos fallidos", nota: correo ? `Correo usado: ${correo}` : null };
  }
  if (r.action === "transition") {
    const de = r.from_state ? nombreEstado(r.entity, r.from_state) : "—";
    const a = r.to_state ? nombreEstado(r.entity, r.to_state) : "—";
    return { tipo: "cambios", cambios: [{ campo: "Estado", antes: de, despues: a }], comentario: r.comment || null };
  }
  if (r.action === "soft_delete") {
    const f = GENERO[r.entity] === "f";
    const quien = `${f ? "La" : "El"} ${etiquetaEntidad(r.entity).toLowerCase()}`;
    const datos = { ...(r.changes?.antes || {}), ...(r.changes?.despues || {}) };
    const estado = datos.estado ? ` Estado al dar${f ? "la" : "lo"} de baja: ${nombreEstado(r.entity, datos.estado)}.` : "";
    return { tipo: "texto", texto: `${quien} dejó de listarse.${estado}` };
  }
  const sinCambio = updateSinCambios(r, cambios);
  if (sinCambio) return { tipo: "texto", tono: "nada", texto: sinCambio.texto };
  return cambios.length ? { tipo: "cambios", cambios } : { tipo: "vacio" };
}
