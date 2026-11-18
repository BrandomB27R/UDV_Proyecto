// Las nueve secciones del programa de curso: cómo se editan, cómo se leen y cuándo están completas.
// Responsables va aparte (bloque propio, editable solo por coordinación).
//
// Cada editor guarda su estado en una copia de trabajo y entrega, con valor(), el
// contenido listo para PUT /program-versions/{id}/sections/{seccion}.
import { h, poner } from "../dom.js";

export const SECCIONES = [
  { id: "general", titulo: "Información general" },
  { id: "prerrequisitos", titulo: "Prerrequisitos" },
  { id: "descripcion", titulo: "Descripción" },
  { id: "competencias", titulo: "Competencias" },
  { id: "perfil", titulo: "Perfil de egreso" },
  { id: "metodologia", titulo: "Metodología" },
  { id: "contenidos", titulo: "Contenidos" },
  { id: "bibliografia", titulo: "Bibliografía" },
  { id: "evaluacion", titulo: "Evaluación" },
];
export const tituloSeccion = (id) => SECCIONES.find((s) => s.id === id)?.titulo || id;

const TIPOS_PRERREQ = { obligatorio: "Obligatorio", correquisito: "Correquisito", recomendado: "Recomendado" };
const TIPOS_COMPETENCIA = { general: "General", especifica: "Específica" };
const TIPOS_BIBLIO = { basica: "Básica", complementaria: "Complementaria" };

const copia = (x) => JSON.parse(JSON.stringify(x ?? null));
const texto = (v) => (v == null ? "" : String(v));
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const contenidoDe = (version, id) => version?.secciones?.[id]?.contenido ?? (["general", "descripcion", "metodologia"].includes(id) ? {} : []);

// "Sin prerrequisitos": la API no lo guarda; queda en este navegador (NOTAS_BACKEND.md).
const claveSinPrerreq = (versionId) => `vinci_sin_prerreq_${versionId}`;
export function sinPrerrequisitos(versionId) {
  try { return localStorage.getItem(claveSinPrerreq(versionId)) === "1"; } catch { return false; }
}
export function marcarSinPrerrequisitos(versionId, si) {
  try { if (si) localStorage.setItem(claveSinPrerreq(versionId), "1"); else localStorage.removeItem(claveSinPrerreq(versionId)); } catch { /* sin almacenamiento */ }
}

export const totalEvaluacion = (filas) => Math.round((filas || []).reduce((s, x) => s + (Number(x.ponderacion) || 0), 0) * 100) / 100;

// ── Completa o pendiente (acordado con el PM) ────────────────
export function estadoSeccion(id, c, versionId) {
  switch (id) {
    case "general": {
      const ok = !!texto(c?.asignatura).trim() && Number(c?.horas) > 0;
      return { ok, detalle: ok ? "" : "Falta el nombre de la asignatura o las horas por semana." };
    }
    case "descripcion":
    case "metodologia": {
      const ok = !!texto(c?.texto).trim();
      return { ok, detalle: ok ? "" : "Falta el texto." };
    }
    case "prerrequisitos": {
      const ok = (c || []).length > 0 || sinPrerrequisitos(versionId);
      return { ok, detalle: ok ? "" : "Agrega un curso o marca «Sin prerrequisitos»." };
    }
    case "competencias":
    case "bibliografia": {
      const ok = (c || []).some((x) => texto(x.descripcion ?? x.referencia).trim());
      return { ok, detalle: ok ? "" : "Agrega al menos una." };
    }
    case "perfil": {
      const ok = (c || []).some((x) => (x.perfil_egreso_id || x.codigo) && texto(x.contribucion).trim());
      return { ok, detalle: ok ? "" : "Agrega al menos un rasgo con su contribución." };
    }
    case "contenidos": {
      const ok = (c || []).some((u) => texto(u.titulo).trim() && (u.items || []).some((t) => texto(t.item).trim()));
      return { ok, detalle: ok ? "" : "Agrega al menos una unidad con un tema." };
    }
    case "evaluacion": {
      const total = totalEvaluacion(c);
      const ok = (c || []).length > 0 && total === 100;
      return { ok, detalle: ok ? "" : `La ponderación suma ${total} de 100.` };
    }
    default: return { ok: true, detalle: "" };
  }
}

export function avanceDe(version) {
  const estados = SECCIONES.map((s) => ({ ...s, ...estadoSeccion(s.id, contenidoDe(version, s.id), version?.id) }));
  return { estados, listas: estados.filter((x) => x.ok).length, total: estados.length, faltan: estados.filter((x) => !x.ok) };
}

// ── Piezas de formulario ─────────────────────────────────────
let contador = 0;
const nuevoId = (base) => `${base}-${++contador}`;

function campoTexto(etiqueta, valor, alCambiar, { multilinea = false, max = 1000, ayuda, filas = 3, placeholder } = {}) {
  const id = nuevoId("c");
  const control = multilinea
    ? h("textarea", { id, rows: filas, maxlength: max, value: texto(valor), placeholder, oninput: (e) => alCambiar(e.target.value) })
    : h("input", { id, type: "text", maxlength: max, value: texto(valor), placeholder, oninput: (e) => alCambiar(e.target.value) });
  return h("div", { class: "v-campo" }, h("label", { for: id }, etiqueta), control, ayuda ? h("span", { class: "v-campo__ayuda" }, ayuda) : null);
}

function campoNumero(etiqueta, valor, alCambiar, { min = 0, max, paso = "any", ayuda } = {}) {
  const id = nuevoId("n");
  return h("div", { class: "v-campo" }, h("label", { for: id }, etiqueta),
    h("input", { id, type: "number", inputmode: "decimal", min, max, step: paso, value: valor == null ? "" : String(valor), oninput: (e) => alCambiar(num(e.target.value)) }),
    ayuda ? h("span", { class: "v-campo__ayuda" }, ayuda) : null);
}

function campoSelect(etiqueta, valor, opciones, alCambiar, { vacio } = {}) {
  const id = nuevoId("s");
  return h("div", { class: "v-campo" }, h("label", { for: id }, etiqueta),
    h("select", { id, onchange: (e) => alCambiar(e.target.value) },
      vacio ? h("option", { value: "" }, vacio) : null,
      Object.entries(opciones).map(([v, t]) => h("option", { value: v, selected: String(valor ?? "") === String(v) }, t))));
}

/** Botones de una fila: subir, bajar, quitar. */
function controlesFila(filas, i, repintar, etiqueta) {
  const mover = (d) => { const j = i + d; [filas[i], filas[j]] = [filas[j], filas[i]]; repintar(); };
  return h("div", { class: "v-fila-ctrl" },
    h("button", { type: "button", class: "v-icono-btn", disabled: i === 0, "aria-label": `Subir ${etiqueta}`, title: "Subir", onclick: () => mover(-1) }, "↑"),
    h("button", { type: "button", class: "v-icono-btn", disabled: i === filas.length - 1, "aria-label": `Bajar ${etiqueta}`, title: "Bajar", onclick: () => mover(1) }, "↓"),
    h("button", { type: "button", class: "v-icono-btn v-icono-btn--quitar", "aria-label": `Quitar ${etiqueta}`, title: "Quitar", onclick: () => { filas.splice(i, 1); repintar(); } }, "✕"));
}

/** Lista de filas editables: cada fila es una tarjeta con sus campos. */
function listaFilas({ filas, nombre, campos, nueva, agregar, alCambiar, vacio }) {
  const raiz = h("div", { class: "v-filas" });
  const repintar = () => {
    poner(raiz,
      filas.length ? h("ol", { class: "v-filas__lista" }, filas.map((f, i) => h("li", { class: "v-fila-ed" },
        h("div", { class: "v-fila-ed__cab" }, h("span", { class: "v-fila-ed__n" }, `${nombre} ${i + 1}`), controlesFila(filas, i, () => { repintar(); alCambiar(); }, `${nombre.toLowerCase()} ${i + 1}`)),
        h("div", { class: "v-fila-ed__campos" }, campos(f, () => alCambiar()))))) : h("p", { class: "v-nota" }, vacio),
      h("div", { class: "v-acciones" }, h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => {
        filas.push(nueva()); repintar(); alCambiar();
        raiz.querySelector(".v-fila-ed:last-child input, .v-fila-ed:last-child select, .v-fila-ed:last-child textarea")?.focus();
      } }, agregar)));
  };
  repintar();
  return raiz;
}

// ── Editores ─────────────────────────────────────────────────
/**
 * Crea el editor de una sección. ctx: {cursos, perfiles, versionId, alCambiar}.
 * Devuelve {nodo, valor(), error()} — error() da el texto que impide guardar, o null.
 */
export function crearEditor(id, contenido, ctx) {
  const avisar = () => ctx.alCambiar?.();
  const c = copia(contenido);

  if (id === "general") {
    const v = c || {};
    const fijo = (dt, dd) => h("div", {}, h("dt", {}, dt), h("dd", {}, dd || "—"));
    return {
      nodo: h("div", { class: "v-editor" },
        h("dl", { class: "v-datos v-datos--fijos" },
          fijo("Código", v.codigo), fijo("Período", v.ciclo), fijo("Sede", v.sede), fijo("Modalidad", v.modalidad)),
        h("p", { class: "v-campo__ayuda" }, "Código, período, sede y modalidad vienen del catálogo y no se cambian aquí."),
        campoTexto("Nombre de la asignatura", v.asignatura, (x) => { v.asignatura = x; avisar(); }, { max: 200 }),
        h("div", { class: "v-dos" },
          campoTexto("Programa académico", v.programa, (x) => { v.programa = x; avisar(); }, { max: 200 }),
          campoTexto("Departamento", v.departamento, (x) => { v.departamento = x; avisar(); }, { max: 200 })),
        h("div", { class: "v-dos" },
          campoTexto("Nivel", v.nivel, (x) => { v.nivel = x; avisar(); }, { max: 50, placeholder: "Por ejemplo: licenciatura" }),
          campoTexto("Pénsum", v.pensum, (x) => { v.pensum = x; avisar(); }, { max: 20 }),
          campoNumero("Horas de clase por semana", v.horas, (x) => { v.horas = x; avisar(); }, { min: 0.5, paso: 0.5 })),
        campoTexto("Resumen de cambios de esta versión", v.resumen_cambios, (x) => { v.resumen_cambios = x; avisar(); },
          { multilinea: true, filas: 2, max: 500, ayuda: "Qué cambió respecto de la versión anterior. Aparece en el historial." })),
      valor: () => ({
        asignatura: texto(v.asignatura).trim(), programa: texto(v.programa).trim() || null, departamento: texto(v.departamento).trim() || null,
        nivel: texto(v.nivel).trim() || null, pensum: texto(v.pensum).trim() || null, horas: v.horas, resumen_cambios: texto(v.resumen_cambios).trim() || null,
      }),
      error: () => (!texto(v.asignatura).trim() ? "Escribe el nombre de la asignatura." : v.horas != null && v.horas <= 0 ? "Las horas deben ser mayores que cero." : null),
    };
  }

  if (id === "descripcion" || id === "metodologia") {
    const v = { texto: texto(c?.texto) };
    const ayuda = id === "descripcion" ? "De qué trata el curso y para qué le sirve al estudiante." : "Cómo se enseña: clases, laboratorios, proyectos, lecturas.";
    return {
      nodo: h("div", { class: "v-editor" }, campoTexto(tituloSeccion(id), v.texto, (x) => { v.texto = x; avisar(); }, { multilinea: true, filas: 8, max: 5000, ayuda })),
      valor: () => ({ texto: v.texto.trim() }),
      error: () => null,
    };
  }

  if (id === "prerrequisitos") {
    const filas = (c || []).map((x) => ({ curso_id: x.curso_id, tipo: x.tipo || "obligatorio" }));
    const opcionesCurso = Object.fromEntries((ctx.cursos || []).map((x) => [x.id, `${x.code} · ${x.name}`]));
    const casilla = h("input", { type: "checkbox", id: nuevoId("sp"), checked: sinPrerrequisitos(ctx.versionId),
      onchange: (e) => { marcarSinPrerrequisitos(ctx.versionId, e.target.checked); avisar(); } });
    return {
      nodo: h("div", { class: "v-editor" },
        h("label", { class: "v-check v-check--sola", for: casilla.id }, casilla, h("span", {}, h("strong", {}, "Sin prerrequisitos"), h("small", {}, "Márcalo si el curso no exige otros cursos antes."))),
        listaFilas({ filas, nombre: "Curso", agregar: "Agregar prerrequisito", vacio: "Sin cursos en la lista.", alCambiar: avisar,
          nueva: () => ({ curso_id: "", tipo: "obligatorio" }),
          campos: (f, ok) => h("div", { class: "v-dos" },
            campoSelect("Curso", f.curso_id, opcionesCurso, (x) => { f.curso_id = num(x); ok(); }, { vacio: "Elige el curso" }),
            campoSelect("Tipo", f.tipo, TIPOS_PRERREQ, (x) => { f.tipo = x; ok(); })) })),
      valor: () => filas.filter((f) => f.curso_id).map((f, i) => ({ orden: i + 1, curso_id: f.curso_id, tipo: f.tipo })),
      error: () => (filas.some((f) => !f.curso_id) ? "Elige el curso en cada fila o quita la fila vacía." : null),
    };
  }

  if (id === "competencias") {
    const filas = (c || []).map((x) => ({ tipo: x.tipo || "especifica", descripcion: x.descripcion || "" }));
    return {
      nodo: h("div", { class: "v-editor" }, listaFilas({ filas, nombre: "Competencia", agregar: "Agregar competencia", vacio: "Todavía no hay competencias.", alCambiar: avisar,
        nueva: () => ({ tipo: "especifica", descripcion: "" }),
        campos: (f, ok) => [campoSelect("Tipo", f.tipo, TIPOS_COMPETENCIA, (x) => { f.tipo = x; ok(); }),
          campoTexto("Descripción", f.descripcion, (x) => { f.descripcion = x; ok(); }, { multilinea: true, filas: 2, max: 1000 })] })),
      valor: () => filas.filter((f) => f.descripcion.trim()).map((f, i) => ({ orden: i + 1, tipo: f.tipo, descripcion: f.descripcion.trim() })),
      error: () => null,
    };
  }

  if (id === "perfil") {
    const filas = (c || []).map((x) => ({ perfil_egreso_id: x.perfil_egreso_id ?? null, contribucion: x.contribucion || "" }));
    const catalogo = ctx.perfiles || [];
    const opciones = Object.fromEntries(catalogo.map((p) => [p.id, `${p.codigo} · ${p.descripcion}`]));
    // Un rasgo ya guardado que no esté en el catálogo activo se conserva con su texto.
    for (const x of c || []) if (x.perfil_egreso_id && !opciones[x.perfil_egreso_id]) opciones[x.perfil_egreso_id] = `${x.codigo || ""} · ${x.descripcion || ""}`;
    return {
      nodo: h("div", { class: "v-editor" },
        catalogo.length ? null : h("p", { class: "v-msg v-msg--aviso" }, "No se pudo cargar el catálogo de perfil de egreso. Recarga la página para intentarlo de nuevo."),
        listaFilas({ filas, nombre: "Rasgo", agregar: "Agregar rasgo del perfil", vacio: "Todavía no hay rasgos del perfil de egreso.", alCambiar: avisar,
          nueva: () => ({ perfil_egreso_id: null, contribucion: "" }),
          campos: (f, ok) => [
            campoSelect("Rasgo del perfil de egreso", f.perfil_egreso_id, opciones, (x) => { f.perfil_egreso_id = num(x); ok(); }, { vacio: "Elige el rasgo" }),
            campoTexto("Cómo contribuye el curso", f.contribucion, (x) => { f.contribucion = x; ok(); }, { multilinea: true, filas: 2, max: 1000 })] })),
      valor: () => filas.filter((f) => f.perfil_egreso_id && f.contribucion.trim()).map((f, i) => ({ orden: i + 1, perfil_egreso_id: f.perfil_egreso_id, contribucion: f.contribucion.trim() })),
      error: () => (filas.some((f) => !f.perfil_egreso_id) ? "Elige el rasgo en cada fila o quita la fila vacía."
        : filas.some((f) => !f.contribucion.trim()) ? "Escribe cómo contribuye el curso en cada rasgo." : null),
    };
  }

  if (id === "bibliografia") {
    const filas = (c || []).map((x) => ({ tipo: x.tipo || "basica", referencia: x.referencia || "", isbn: x.isbn || "", url: x.url || "" }));
    return {
      nodo: h("div", { class: "v-editor" }, listaFilas({ filas, nombre: "Referencia", agregar: "Agregar referencia", vacio: "Todavía no hay referencias.", alCambiar: avisar,
        nueva: () => ({ tipo: "basica", referencia: "", isbn: "", url: "" }),
        campos: (f, ok) => [
          campoSelect("Tipo", f.tipo, TIPOS_BIBLIO, (x) => { f.tipo = x; ok(); }),
          campoTexto("Referencia", f.referencia, (x) => { f.referencia = x; ok(); }, { multilinea: true, filas: 2, max: 1000, placeholder: "Autor, título, editorial, año." }),
          h("div", { class: "v-dos" },
            campoTexto("ISBN (opcional)", f.isbn, (x) => { f.isbn = x; ok(); }, { max: 17 }),
            campoTexto("Enlace (opcional)", f.url, (x) => { f.url = x; ok(); }, { max: 500 }))] })),
      valor: () => filas.filter((f) => f.referencia.trim()).map((f, i) => ({
        orden: i + 1, tipo: f.tipo, referencia: f.referencia.trim(), isbn: f.isbn.trim() || null, url: f.url.trim() || null,
      })),
      error: () => null,
    };
  }

  if (id === "contenidos") return editorContenidos(c || [], avisar);
  if (id === "evaluacion") return editorEvaluacion(c || [], avisar);
  return { nodo: h("p", { class: "v-nota" }, "Sección no reconocida."), valor: () => contenido, error: () => null };
}

/** Contenidos: unidades (título y horas) con sus temas; todo reordenable. */
function editorContenidos(c, avisar) {
  const unidades = c.map((u) => ({
    titulo: u.titulo || "", horas: u.horas ?? null,
    // actividad, evidencia y punteo no se editan aquí, pero se conservan al guardar.
    items: (u.items || []).map((t) => ({ item: t.item || "", descripcion: t.descripcion || "", actividad: t.actividad ?? null, evidencia: t.evidencia ?? null, punteo: t.punteo ?? null })),
  }));
  const raiz = h("div", { class: "v-editor" });
  const total = h("p", { class: "v-total" });
  const pintarTotal = () => {
    const horas = unidades.reduce((s, u) => s + (Number(u.horas) || 0), 0);
    total.textContent = `${unidades.length} ${unidades.length === 1 ? "unidad" : "unidades"} · ${unidades.reduce((s, u) => s + u.items.length, 0)} temas · ${horas.toLocaleString("es-GT")} horas`;
  };
  const cambio = () => { pintarTotal(); avisar(); };
  const repintar = () => {
    poner(raiz,
      h("p", { class: "v-campo__ayuda" }, "Organiza el curso por unidades. Cada unidad lleva sus horas y sus temas, en el orden en que se dan."),
      total,
      unidades.length ? h("ol", { class: "v-unidades" }, unidades.map((u, i) => h("li", { class: "v-unidad" },
        h("div", { class: "v-fila-ed__cab" }, h("span", { class: "v-fila-ed__n" }, `Unidad ${i + 1}`), controlesFila(unidades, i, () => { repintar(); cambio(); }, `unidad ${i + 1}`)),
        h("div", { class: "v-unidad__datos" },
          campoTexto("Título de la unidad", u.titulo, (x) => { u.titulo = x; cambio(); }, { max: 200 }),
          campoNumero("Horas", u.horas, (x) => { u.horas = x; cambio(); }, { min: 0, paso: 0.5 })),
        h("p", { class: "v-campo__etq" }, "Temas"),
        u.items.length ? h("ol", { class: "v-temas" }, u.items.map((t, j) => h("li", { class: "v-tema" },
          h("div", { class: "v-tema__campos" },
            campoTexto(`Tema ${j + 1}`, t.item, (x) => { t.item = x; cambio(); }, { max: 200 }),
            campoTexto("Detalle (opcional)", t.descripcion, (x) => { t.descripcion = x; cambio(); }, { max: 1000 })),
          controlesFila(u.items, j, () => { repintar(); cambio(); }, `tema ${j + 1} de la unidad ${i + 1}`)))) : h("p", { class: "v-nota" }, "Esta unidad todavía no tiene temas."),
        h("div", { class: "v-acciones" }, h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => {
          u.items.push({ item: "", descripcion: "", actividad: null, evidencia: null, punteo: null }); repintar(); cambio();
        } }, "Agregar tema"))))) : h("p", { class: "v-nota" }, "Todavía no hay unidades."),
      h("div", { class: "v-acciones" }, h("button", { type: "button", class: "v-btn v-btn--sec", onclick: () => {
        unidades.push({ titulo: "", horas: null, items: [] }); repintar(); cambio();
      } }, "Agregar unidad")));
    pintarTotal();
  };
  repintar();
  return {
    nodo: raiz,
    valor: () => unidades.filter((u) => u.titulo.trim()).map((u, i) => ({
      orden: i + 1, titulo: u.titulo.trim(), horas: u.horas,
      items: u.items.filter((t) => t.item.trim()).map((t, j) => ({ orden: j + 1, item: t.item.trim(), descripcion: t.descripcion.trim() || null, actividad: t.actividad, evidencia: t.evidencia, punteo: t.punteo })),
    })),
    error: () => (unidades.some((u) => !u.titulo.trim() && u.items.length) ? "Cada unidad con temas necesita un título." : null),
  };
}

/** Evaluación: tabla de actividades con el total a la vista; no pasa de 100. */
function editorEvaluacion(c, avisar) {
  const filas = c.map((x) => ({ nombre: x.nombre || "", semana: x.semana ?? null, ponderacion: x.ponderacion ?? null, descripcion: x.descripcion ?? null }));
  const raiz = h("div", { class: "v-editor" });
  const total = h("p", { class: "v-total", "aria-live": "polite" });
  const pintarTotal = () => {
    const t = totalEvaluacion(filas);
    total.textContent = `Total: ${t.toLocaleString("es-GT")} de 100`;
    total.className = `v-total ${t === 100 ? "v-total--ok" : t > 100 ? "v-total--error" : "v-total--falta"}`;
  };
  const cambio = () => { pintarTotal(); avisar(); };
  const repintar = () => {
    poner(raiz,
      h("p", { class: "v-campo__ayuda" }, "Cada actividad con su semana y su ponderación. Para enviar el programa, el total debe sumar exactamente 100."),
      h("div", { class: "v-tabla-ed", role: "table", "aria-label": "Actividades de evaluación" },
        h("div", { class: "v-tabla-ed__fila v-tabla-ed__cab", role: "row" },
          h("span", { role: "columnheader" }, "Actividad"), h("span", { role: "columnheader" }, "Semana"),
          h("span", { role: "columnheader" }, "Ponderación (%)"), h("span", { role: "columnheader" }, h("span", { class: "v-sr" }, "Acciones"))),
        filas.map((f, i) => h("div", { class: "v-tabla-ed__fila", role: "row" },
          h("span", { role: "cell" }, h("input", { type: "text", maxlength: 150, value: f.nombre, "aria-label": `Actividad ${i + 1}`, placeholder: "Por ejemplo: Parcial 1", oninput: (e) => { f.nombre = e.target.value; cambio(); } })),
          h("span", { role: "cell" }, h("input", { type: "number", min: 1, max: 30, step: 1, inputmode: "numeric", value: f.semana ?? "", "aria-label": `Semana de la actividad ${i + 1}`, oninput: (e) => { f.semana = num(e.target.value); cambio(); } })),
          h("span", { role: "cell" }, h("input", { type: "number", min: 0.5, max: 100, step: 0.5, inputmode: "decimal", value: f.ponderacion ?? "", "aria-label": `Ponderación de la actividad ${i + 1}`, oninput: (e) => { f.ponderacion = num(e.target.value); cambio(); } })),
          h("span", { role: "cell" }, controlesFila(filas, i, () => { repintar(); cambio(); }, `actividad ${i + 1}`))))),
      total,
      h("div", { class: "v-acciones" }, h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => {
        filas.push({ nombre: "", semana: null, ponderacion: null, descripcion: null }); repintar(); cambio();
        raiz.querySelector(".v-tabla-ed__fila:last-child input")?.focus();
      } }, "Agregar actividad")));
    pintarTotal();
  };
  repintar();
  return {
    nodo: raiz,
    valor: () => filas.filter((f) => f.nombre.trim() || f.ponderacion).map((f, i) => ({ orden: i + 1, nombre: f.nombre.trim(), semana: f.semana, ponderacion: f.ponderacion, descripcion: f.descripcion })),
    error: () => {
      const usadas = filas.filter((f) => f.nombre.trim() || f.ponderacion);
      if (usadas.some((f) => !f.nombre.trim())) return "Cada actividad necesita un nombre.";
      if (usadas.some((f) => !(Number(f.ponderacion) > 0))) return "Cada actividad necesita una ponderación mayor que cero.";
      if (totalEvaluacion(usadas) > 100) return `La ponderación suma ${totalEvaluacion(usadas)}: no puede pasar de 100.`;
      return null;
    },
  };
}

// ── Lectura (versiones que no se editan) ─────────────────────
export function lecturaSeccion(id, c, ctx = {}) {
  const vacio = (t = "Sin datos.") => h("p", { class: "v-nota" }, t);
  switch (id) {
    case "general": {
      const v = c || {};
      const d = (dt, dd) => h("div", {}, h("dt", {}, dt), h("dd", {}, dd == null || dd === "" ? "—" : String(dd)));
      return h("dl", { class: "v-datos v-datos--fijos" },
        d("Código", v.codigo), d("Asignatura", v.asignatura), d("Período", v.ciclo), d("Sede", v.sede), d("Modalidad", v.modalidad),
        d("Programa académico", v.programa), d("Departamento", v.departamento), d("Nivel", v.nivel), d("Pénsum", v.pensum),
        d("Horas por semana", v.horas), d("Resumen de cambios", v.resumen_cambios));
    }
    case "descripcion":
    case "metodologia":
      return texto(c?.texto).trim() ? h("p", { class: "v-texto" }, c.texto) : vacio();
    case "prerrequisitos":
      return (c || []).length ? h("ul", { class: "v-lista" }, c.map((x) => h("li", {}, h("strong", {}, `${x.codigo || ""} ${x.nombre || ""}`.trim()), ` · ${TIPOS_PRERREQ[x.tipo] || x.tipo}`)))
        : vacio(sinPrerrequisitos(ctx.versionId) ? "Sin prerrequisitos." : "No se registraron prerrequisitos.");
    case "competencias":
      return (c || []).length ? h("ul", { class: "v-lista" }, c.map((x) => h("li", {}, h("strong", {}, `${TIPOS_COMPETENCIA[x.tipo] || x.tipo}: `), x.descripcion))) : vacio();
    case "perfil":
      return (c || []).length ? h("ul", { class: "v-lista" }, c.map((x) => h("li", {}, h("strong", {}, `${x.codigo || ""} ${x.descripcion || ""}`.trim()), h("br"), x.contribucion))) : vacio();
    case "bibliografia":
      return (c || []).length ? h("ul", { class: "v-lista" }, c.map((x) => h("li", {}, h("strong", {}, `${TIPOS_BIBLIO[x.tipo] || x.tipo}: `), x.referencia,
        x.isbn ? ` · ISBN ${x.isbn}` : null, x.url ? [" · ", h("span", { class: "v-url" }, x.url)] : null))) : vacio();
    case "contenidos":
      return (c || []).length ? h("ol", { class: "v-unidades v-unidades--lectura" }, c.map((u, i) => h("li", { class: "v-unidad" },
        h("p", { class: "v-unidad__titulo" }, `Unidad ${i + 1}. ${u.titulo}`, u.horas != null ? h("span", { class: "v-nota" }, ` · ${u.horas} horas`) : null),
        (u.items || []).length ? h("ol", { class: "v-lista" }, u.items.map((t) => h("li", {}, t.item, t.descripcion ? h("span", { class: "v-nota" }, ` · ${t.descripcion}`) : null))) : vacio("Sin temas.")))) : vacio();
    case "evaluacion":
      return (c || []).length ? h("div", {},
        h("table", { class: "v-tabla-lectura" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Actividad"), h("th", { scope: "col" }, "Semana"), h("th", { scope: "col" }, "Ponderación"))),
          h("tbody", {}, c.map((x) => h("tr", {}, h("td", {}, x.nombre), h("td", {}, x.semana ?? "—"), h("td", {}, `${Number(x.ponderacion)} %`)))),
          h("tfoot", {}, h("tr", {}, h("th", { scope: "row", colspan: 2 }, "Total"), h("td", {}, `${totalEvaluacion(c)} %`))))) : vacio();
    default: return vacio();
  }
}
