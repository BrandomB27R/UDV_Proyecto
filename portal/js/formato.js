// Nombres legibles, colores de estado y fechas. Una sola fuente para toda la interfaz.
import { h } from "./dom.js";

export const ZONA = "America/Guatemala";

// ── Estados (CONTRATO_COMUN §2) ─────────────────────────────
export const ESTADOS = {
  draft: "Borrador",
  published: "Publicada",
  assigned: "Asignada",
  in_progress: "En curso",
  submitted: "Entregada",
  under_review: "En revisión",
  returned: "Devuelta",
  approved: "Aprobada",
  closed: "Cerrada",
  cancelled: "Cancelada",
};
export const etiquetaEstado = (s) => ESTADOS[s] || legible(s);
export const chipEstado = (s) => h("span", { class: `v-chip v-chip--${ESTADOS[s] ? s : "draft"}` }, etiquetaEstado(s));

// ── Prioridad ───────────────────────────────────────────────
export const PRIORIDADES = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
/** Solo alta y urgente se marcan (rectángulo con contorno, no parece un estado); baja y media no se muestran. */
export const chipPrioridad = (p) => (p === "high" ? h("span", { class: "v-prio v-prio--high", title: "Prioridad alta" }, "▲ Alta")
  : p === "urgent" ? h("span", { class: "v-prio v-prio--urgent", title: "Prioridad urgente" }, "▲▲ Urgente") : null);

// ── Tipos de tarea (catálogo fijo del G1) ───────────────────
export const TIPOS = {
  ACTUALIZAR_PROGRAMA: "Actualizar programa",
  SUBIR_CV: "Subir ficha o CV",
  ENTREGAR_FACTURA: "Entregar factura",
  CONFIRMAR_ACTIVIDAD: "Confirmar actividad",
  CARGAR_EVIDENCIA: "Cargar evidencia",
};
export const etiquetaTipo = (codigo) => TIPOS[codigo] || legible(codigo);

/**
 * Cómo se entrega un tipo de tarea (G3: delivery_mode + requires_evidence). Igual que flujo.js:
 * si exige archivo, «Archivo obligatorio»; «formulario» sin archivo obligatorio se entrega con texto.
 */
export function formaDeEntrega(modo, requiereArchivo) {
  if (modo === "programa") return "Programa de curso";
  if (requiereArchivo || modo === "archivo") return "Archivo obligatorio";
  if (modo === "texto" || modo === "formulario") return "Solo texto";
  if (modo === "ambos") return "Texto y archivo opcional";
  return legible(modo || "");
}

// ── Perfiles y roles ────────────────────────────────────────
export const ROLES = {
  admin: "Administración", coordinator: "Coordinación", teacher: "Docente",
  reviewer: "Revisión", authority: "Dirección", auditor: "Auditoría",
};

/** "ACTUALIZAR_PROGRAMA" o "in_progress" -> "Actualizar programa" / "In progress". */
export function legible(codigo) {
  if (!codigo) return "";
  const t = String(codigo).replace(/[_-]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const nombreCompleto = (u) => [u?.nombres, u?.apellidos].filter(Boolean).join(" ").trim();

// ── Fechas (trampa 8: tres formatos) ────────────────────────
// Con zona (Z u offset): instante UTC -> se muestra en hora de Guatemala.
// Sin hora o sin zona en un campo de fecha límite: fecha de calendario, sin convertir.
const RE_SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})/;

/** Convierte un instante de la API a Date. Recorta microsegundos (G3) y asume UTC si falta la zona. */
export function aInstante(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  let s = String(v).trim().replace(/(\.\d{3})\d+/, "$1");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T00:00:00Z";
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";   // CONTRATO §1: la API habla en UTC
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "17 nov, 9:10 a. m." en hora de Guatemala. */
export function fechaCorta(v) {
  const d = aInstante(v);
  if (!d) return "";
  const dia = d.toLocaleString("es-GT", { timeZone: ZONA, day: "numeric", month: "short" }).replace(".", "");
  const hora = d.toLocaleString("es-GT", { timeZone: ZONA, hour: "numeric", minute: "2-digit" });
  return `${dia}, ${hora}`;
}

/** Fecha y hora completas (para títulos y tooltips). */
export function fechaHora(v) {
  const d = aInstante(v);
  return d ? d.toLocaleString("es-GT", { timeZone: ZONA }) : "";
}

/** Fecha de calendario "YYYY-MM-DD" de un due_at/due_date (sin conversión de zona). */
export function diaCalendario(v) {
  const m = v ? RE_SOLO_FECHA.exec(String(v)) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Hoy en Guatemala como "YYYY-MM-DD". */
export function hoyGuatemala() {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function diasEntre(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** "15 de diciembre de 2026" a partir de una fecha de calendario. */
export function fechaLarga(v) {
  const dia = diaCalendario(v);
  if (!dia) return "";
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-GT", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}

/**
 * Fecha límite con el plazo: {texto, estado} con estado "vencida" | "por-vencer" | "" .
 * terminada: si la asignación ya no depende del plazo (entregada, aprobada...), no se marca vencida.
 */
export function plazo(due, { terminada = false, diasAviso = 3 } = {}) {
  const dia = diaCalendario(due);
  if (!dia) return { texto: "Sin fecha límite", estado: "" };
  const larga = fechaLarga(dia);
  if (terminada) return { texto: larga, larga, rel: "", estado: "" };
  const faltan = diasEntre(hoyGuatemala(), dia);
  const con = (rel, estado) => ({ texto: `${larga} · ${rel}`, larga, rel, estado });
  if (faltan < 0) {
    const n = -faltan;
    return con(`venció hace ${n} ${n === 1 ? "día" : "días"}`, "vencida");
  }
  if (faltan === 0) return con("vence hoy", "por-vencer");
  if (faltan === 1) return con("vence mañana", "por-vencer");
  return con(`faltan ${faltan} días`, faltan <= diasAviso ? "por-vencer" : "");
}

/** Tamaño legible de un archivo. */
export function tamano(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Días desde hoy (Guatemala) hasta una fecha de calendario: negativo si ya pasó. null si no hay fecha. */
export function diasHasta(v) {
  const dia = diaCalendario(v);
  return dia ? diasEntre(hoyGuatemala(), dia) : null;
}

/** Días desde un instante (UTC) hasta hoy, en fechas de calendario de Guatemala. */
export function diasDesde(v) {
  const d = aInstante(v);
  if (!d) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return diasEntre(`${p.year}-${p.month}-${p.day}`, hoyGuatemala());
}

/** "28 nov" a partir de una fecha de calendario. */
export function fechaDia(v) {
  const dia = diaCalendario(v);
  if (!dia) return "—";
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-GT", { timeZone: "UTC", day: "numeric", month: "short" }).replace(".", "");
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
/** "hace 3 días", "hoy", "hace 1 día". */
export const haceDias = (n) => (n <= 0 ? "hoy" : `hace ${plural(n, "día", "días")}`);

/**
 * Fecha límite para las tablas (como en Tareas): {dia: "28 nov", rel: "faltan 2 días", estado}.
 * estado: "vencida" | "por-vencer" | "" ; solo se marca si la asignación sigue pendiente.
 */
export function fechaLimiteCorta(due, { pendiente = true, diasAviso = 3 } = {}) {
  const dias = diasHasta(due);
  if (dias == null) return { dia: "Sin fecha", rel: "", estado: "" };
  const rel = dias < 0 ? `venció hace ${plural(-dias, "día", "días")}` : dias === 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `faltan ${dias} días`;
  const estado = !pendiente ? "" : dias < 0 ? "vencida" : dias <= diasAviso ? "por-vencer" : "";
  return { dia: fechaDia(due), rel, estado };
}

/** Cuándo pasó algo, en relativo: "hoy, 10:13 a. m.", "ayer, 4:40 p. m." o "hace 36 días". */
export function haceCuando(v) {
  const dias = diasDesde(v);
  if (dias == null) return "";
  const hora = aInstante(v).toLocaleString("es-GT", { timeZone: ZONA, hour: "numeric", minute: "2-digit" });
  return dias <= 0 ? `hoy, ${hora}` : dias === 1 ? `ayer, ${hora}` : haceDias(dias);
}
