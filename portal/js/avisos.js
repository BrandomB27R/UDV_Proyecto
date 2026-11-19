// Avisos (notificaciones): a dónde lleva cada uno y cómo se marcan como leídos.
// Lo usan la campana de la barra y la página de Notificaciones; la regla vive solo aquí.
import { api } from "./api.js";
import { RUTAS } from "./config.js";
import { todasLasPaginas } from "./componentes.js";
import { perfiles } from "./sesion.js";

/**
 * Destino de un aviso: su tarea (assignment_id), su programa (program_version_id) o,
 * sin ninguno de los dos, la sección que corresponde por el tipo de evento y el perfil.
 * Devuelve { texto, href } o null si no tiene destino.
 */
export function destinoDeAviso(n, yo) {
  if (n.assignment_id != null) return { texto: "Ver la tarea", href: RUTAS.asignacion(n.assignment_id) };
  if (n.program_version_id != null) return { texto: "Ver el programa", href: RUTAS.programa(n.program_version_id) };
  const e = String(n.event || "");
  const roles = yo?.roles || [];
  if (e.startsWith("task.") && roles.includes("coordinator")) return { texto: "Ir a Tareas", href: RUTAS.tareas };
  if (e.startsWith("task.") && perfiles(roles).docente) return { texto: "Ir a Mis tareas", href: RUTAS.misTareas };
  return null;
}

/** Marca un aviso como leído (PATCH /notifications/{id}/read). */
export async function marcarAvisoLeido(id) {
  await api(`/notifications/${id}/read`, { method: "PATCH" });
}

/**
 * Marca como leídos todos los avisos sin leer (no solo los visibles).
 * Devuelve { total, fallos }: cuántos había y cuántos no se pudieron marcar.
 */
export async function marcarTodosLeidos() {
  const pendientes = (await todasLasPaginas(api, "/notifications?unread=true")).data || [];
  const r = await Promise.allSettled(pendientes.map((n) => marcarAvisoLeido(n.id)));
  return { total: pendientes.length, fallos: r.filter((x) => x.status === "rejected").length };
}
