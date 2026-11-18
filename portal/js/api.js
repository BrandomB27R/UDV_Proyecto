// Cliente de la API: token, 401, formato de error común y las tres formas de lista.
import { RUTAS } from "./config.js";

const BASE = "/api/v1";
export const CLAVE_TOKEN = "udv_token";

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? null;   // puede venir null en los 403 y 409 del G3
  }
  /** Campo señalado por un 422 ({details: {field}}), si viene. */
  get campo() {
    return this.details && typeof this.details === "object" ? this.details.field ?? null : null;
  }
}

export function token() {
  try { return sessionStorage.getItem(CLAVE_TOKEN); } catch { return null; }
}
export function guardarToken(t) {
  try { sessionStorage.setItem(CLAVE_TOKEN, t); } catch { /* sin almacenamiento: la sesión dura la página */ }
}
export function borrarToken() {
  try { sessionStorage.removeItem(CLAVE_TOKEN); } catch { /* nada */ }
}

const MENSAJES_POR_ESTADO = {
  400: "La solicitud no es válida.",
  401: "Tu sesión terminó. Vuelve a iniciar sesión.",
  403: "No tienes permiso para hacer esto.",
  404: "No se encontró lo que buscabas.",
  409: "La tarea cambió de estado. Recarga la página para ver cómo quedó.",
  413: "El archivo es demasiado grande.",
  422: "Revisa los datos: hay algo que falta o no es válido.",
};

async function leerError(resp) {
  let cuerpo = null;
  try { cuerpo = await resp.json(); } catch { /* sin cuerpo JSON */ }
  const err = cuerpo && cuerpo.error;
  if (err && typeof err === "object") {
    return new ApiError(resp.status, err.code || null, err.message || MENSAJES_POR_ESTADO[resp.status] || "Ocurrió un error.", err.details);
  }
  // Respuesta de FastAPI sin pasar por el manejador común: {detail: "..."}
  const detalle = cuerpo && cuerpo.detail;
  const texto = typeof detalle === "string" ? detalle : null;
  return new ApiError(resp.status, null, texto || MENSAJES_POR_ESTADO[resp.status] || `Error ${resp.status}.`, typeof detalle === "object" ? detalle : null);
}

/** Sesión vencida o inválida: borrar el token y volver al login (trampa 12). */
export function salirPorSesionVencida() {
  borrarToken();
  if (location.pathname !== RUTAS.landing) {
    location.replace(`${RUTAS.landing}?sesion=vencida`);
  }
}

/**
 * Llama a la API. Opciones: method, body (JSON), form (FormData), sin401 (no redirigir en 401: login).
 * Devuelve el JSON (o null en 204). Lanza ApiError.
 */
export async function api(ruta, { method = "GET", body, form, sin401 = false, blob = false } = {}) {
  const headers = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(BASE + ruta, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "SIN_CONEXION", "No hay conexión con el servidor. Revisa tu red e intenta de nuevo.");
  }
  if (resp.status === 401 && !sin401) {
    salirPorSesionVencida();
    throw new ApiError(401, "UNAUTHORIZED", MENSAJES_POR_ESTADO[401]);
  }
  if (!resp.ok) throw await leerError(resp);
  if (blob) return resp;
  if (resp.status === 204) return null;
  const texto = await resp.text();
  return texto ? JSON.parse(texto) : null;
}

/** Normaliza las tres formas de lista: {data}, {items} o arreglo directo (trampa 2). */
export function lista(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp.data)) return resp.data;
  if (resp && Array.isArray(resp.items)) return resp.items;
  return [];
}

/** Descarga un archivo con el token (un <a href> directo da 401). */
export async function descargarArchivo(fileId, nombre) {
  const resp = await api(`/files/${encodeURIComponent(fileId)}`, { blob: true });
  const datos = await resp.blob();
  const url = URL.createObjectURL(datos);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre || `archivo-${fileId}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
