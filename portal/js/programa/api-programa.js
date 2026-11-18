// Llamadas del programa de curso (G5). Las tres rutas que el PM agrega en el backend
// (for-assignment, viewer_actions y graduate-profiles) están aisladas aquí, por si al
// llegar cambia algún nombre.
import { api, ApiError, lista } from "../api.js";
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

// ── Contrato nuevo (PM) ──────────────────────────────────────

/**
 * Abre o crea la versión ligada a una asignación de "Actualizar programa".
 * POST /program-versions/for-assignment/{assignment_id} → la versión (misma forma que GET /program-versions/{id}).
 */
export const abrirVersionDeAsignacion = (assignmentId) =>
  api(`/program-versions/for-assignment/${encodeURIComponent(assignmentId)}`, { method: "POST" });

const ACCIONES = ["edit", "submit", "review", "return", "approve", "authorize"];

/**
 * Lo que puede hacer quien mira con la versión: viewer_actions del backend.
 * Mientras esa lista no llegue (backend pendiente), se calcula una provisional por rol y
 * estado para poder probar la pantalla; se quita cuando el backend la traiga.
 */
export function accionesDeVersion(version, yo) {
  if (Array.isArray(version?.viewer_actions)) return new Set(version.viewer_actions.filter((a) => ACCIONES.includes(a)));
  return accionesProvisionales(version, yo);
}

// PROVISIONAL: misma regla que el G5 (auth.py y repository.py). Se borra con viewer_actions.
function accionesProvisionales(v, yo) {
  const roles = new Set(yo?.roles || []);
  const gestor = ["admin", "coordinator", "reviewer"].some((r) => roles.has(r));
  const responsable = roles.has("teacher") && v?.secciones?.responsables?.contenido?.docente_responsable_id === yo?.id;
  const revisa = roles.has("reviewer") || roles.has("coordinator");
  const s = new Set();
  const e = v?.estado;
  if ((e === "draft" || e === "returned") && (gestor || responsable)) s.add("edit");
  if ((e === "draft" || e === "returned") && (responsable || roles.has("coordinator"))) s.add("submit");
  if (e === "submitted" && revisa) s.add("review");
  if (e === "under_review" && revisa) { s.add("return"); s.add("approve"); }
  if (e === "approved" && roles.has("authority")) s.add("authorize");
  return s;
}

/**
 * Catálogo de perfil de egreso: GET /graduate-profiles → [{id, codigo, descripcion}].
 * Si la ruta todavía no existe (404), devuelve null y el editor ofrece escribir el código.
 */
export async function perfilesDeEgreso() {
  try {
    return lista(await api("/graduate-profiles?per_page=100"));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
