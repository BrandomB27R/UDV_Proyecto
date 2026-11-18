// Identidad de la aplicación: el nombre vive solo aquí (requisito 9).
export const APP_NAME = "Vinci";
export const APP_SUBTITULO = "Gestión docente · Universidad Da Vinci de Guatemala";

// Rutas de la interfaz (todas bajo /app/, servidas desde portal/).
export const RUTAS = {
  landing: "/app/",
  inicio: "/app/inicio.html",
  asignacion: (id) => `/app/asignacion.html?id=${encodeURIComponent(id)}`,
  misTareas: "/app/mis-tareas.html",
  porRevisar: "/app/por-revisar.html",
  tareas: "/app/tareas.html",
  nuevaTarea: "/app/nueva-tarea.html",
  panel: "/app/panel.html",
  notificaciones: "/app/notificaciones.html",
  // Pantallas de los grupos que todavía se enlazan (etapa 1).
  programas: "/app/programas.html",
  programa: (versionId, asignacionId) =>
    `/app/programa.html?version=${encodeURIComponent(versionId)}${asignacionId ? `&asignacion=${encodeURIComponent(asignacionId)}` : ""}`,
  panelAdmin: "/app/g6/panel.html",
  catalogos: "/app/g6/catalogos.html",
  // Auditoría de Vinci (la del G6 sigue en /app/g6/auditoria.html, sin enlazar).
  auditoria: "/app/auditoria.html",
};

// Cada cuánto se consulta /notifications (el GET procesa los eventos pendientes).
export const INTERVALO_AVISOS_MS = 60_000;

/** Título de la pestaña: "Sección · Vinci". */
export function tituloPestana(seccion) {
  document.title = seccion ? `${seccion} · ${APP_NAME}` : `${APP_NAME} · ${APP_SUBTITULO}`;
}
