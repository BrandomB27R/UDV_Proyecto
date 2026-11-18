// Sesión, usuario actual y perfiles (por la UNIÓN de roles, nunca por el primero).
import { api, token, guardarToken, borrarToken } from "./api.js";
import { RUTAS } from "./config.js";
import { nombreCompleto } from "./formato.js";

/** Los tres perfiles de la interfaz (requisito 1). */
export function perfiles(roles = []) {
  const r = new Set(roles);
  return {
    docente: r.has("teacher"),
    coordinacion: r.has("coordinator") || r.has("reviewer") || r.has("authority"),
    administracion: r.has("admin") || r.has("auditor"),
  };
}

/** Texto bajo el nombre en la barra: "Docente", "Coordinación", "Coordinación · Docente"... */
export function nombrePerfil(roles = []) {
  const p = perfiles(roles);
  const partes = [];
  // Dirección sola (authority sin coordinator ni reviewer) se nombra como tal.
  if (p.coordinacion) partes.push(roles.includes("coordinator") || roles.includes("reviewer") ? "Coordinación" : "Dirección");
  if (p.docente) partes.push("Docente");
  if (p.administracion) partes.push(new Set(roles).has("admin") ? "Administración" : "Auditoría");
  return partes.join(" · ") || "Sin perfil";
}

export const tieneRol = (yo, ...roles) => roles.some((r) => (yo?.roles || []).includes(r));
/** "Por revisar" y GET /review-queue: solo revisión, coordinación o administración (no dirección sola). */
export const puedeRevisar = (yo) => tieneRol(yo, "reviewer", "coordinator", "admin");
export const tienePermiso = (yo, permiso) => (yo?.permisos || []).includes(permiso);

export async function iniciarSesion(correo, password) {
  const r = await api("/auth/login", { method: "POST", body: { correo, password }, sin401: true });
  guardarToken(r.access_token);
  return r;
}

export async function cerrarSesion() {
  try { await api("/auth/logout", { method: "POST", sin401: true }); } catch { /* el token ya no sirve: igual se sale */ }
  borrarToken();
  location.replace(RUTAS.landing);
}

/** Para las páginas internas: sin token se vuelve al login; con token devuelve /me. */
export async function requerirSesion() {
  if (!token()) {
    location.replace(RUTAS.landing);
    return new Promise(() => {});        // la página no sigue pintando
  }
  const yo = await api("/me");
  yo.nombre = nombreCompleto(yo) || yo.correo;
  return yo;
}
