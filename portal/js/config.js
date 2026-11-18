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
  // Catálogos y auditoría de Vinci (las pantallas del G6 siguen en /app/g6/, sin enlazar).
  catalogos: "/app/catalogos.html",
  auditoria: "/app/auditoria.html",
};

// Cada cuánto se consulta /notifications (el GET procesa los eventos pendientes).
export const INTERVALO_AVISOS_MS = 60_000;

/** Título de la pestaña: "Sección · Vinci". */
export function tituloPestana(seccion) {
  document.title = seccion ? `${seccion} · ${APP_NAME}` : `${APP_NAME} · ${APP_SUBTITULO}`;
}
