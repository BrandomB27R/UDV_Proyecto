// Llamadas del programa de curso (G5), en un solo lugar.
import { api, lista } from "../api.js";
import { todasLasPaginas } from "../componentes.js";

// ── Lectura ──────────────────────────────────────────────────
export const listarProgramas = () => todasLasPaginas(api, "/course-programs");
export const leerPrograma = (id) => api(`/course-programs/${encodeURIComponent(id)}`);
export const leerVersion = (id) => api(`/program-versions/${encodeURIComponent(id)}`);
export const leerCambios = (id) => api(`/program-versions/${encodeURIComponent(id)}/changes`);

// ── Escritura ────────────────────────────────────────────────
/** Guarda una sección. Devuelve la versión actualizada. */
export async function guardarSeccion(versionId, seccion, contenido) {
  const r = await api(`/program-versions/${encodeURIComponent(versionId)}/sections/${encodeURIComponent(seccion)}`,
    { method: "PUT", body: { contenido } });
  return r?.version ?? r;
}

/** submit, review, return, approve o authorize. comentario: obligatorio para devolver. */
export async function transicionVersion(versionId, accion, comentario) {
  const body = comentario ? { comentario } : {};
  const r = await api(`/program-versions/${encodeURIComponent(versionId)}/${accion}`, { method: "POST", body });
  return r?.version ?? r;
}

/** Descarga el PDF (solo versiones autorizadas) con el token. */
export async function descargarPdf(versionId, nombre) {
  const resp = await api(`/program-versions/${encodeURIComponent(versionId)}/pdf`, { blob: true });
  const datos = await resp.blob();
  const url = URL.createObjectURL(datos);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre || `programa-version-${versionId}.pdf`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── Rutas agregadas para Vinci (PR #53) ─────────────────────

/**
 * Abre o crea la versión ligada a una asignación de "Actualizar programa".
 * POST /program-versions/for-assignment/{assignment_id} → la versión (misma forma que GET /program-versions/{id}).
 * 422 si la tarea no tiene curso y período; 409 si no hay versión de la cual partir.
 */
export const abrirVersionDeAsignacion = (assignmentId) =>
  api(`/program-versions/for-assignment/${encodeURIComponent(assignmentId)}`, { method: "POST" });

const ACCIONES = ["edit", "submit", "review", "return", "approve", "authorize"];

/** Lo que puede hacer quien mira con la versión: solo viewer_actions del backend. */
export function accionesDeVersion(version) {
  return new Set((version?.viewer_actions || []).filter((a) => ACCIONES.includes(a)));
}

/** Catálogo de perfil de egreso: GET /graduate-profiles → [{id, codigo, descripcion}]. */
export async function perfilesDeEgreso() {
  return lista(await api("/graduate-profiles?per_page=100"));
}
