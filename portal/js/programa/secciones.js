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

/** «Sin prerrequisitos»: lo guarda el servidor junto a la sección (secciones.prerrequisitos.sin_prerrequisitos). */
export const sinPrerrequisitos = (version) => version?.secciones?.prerrequisitos?.sin_prerrequisitos === true;

export const totalEvaluacion = (filas) => Math.round((filas || []).reduce((s, x) => s + (Number(x.ponderacion) || 0), 0) * 100) / 100;

// ── Completa o pendiente (acordado con el PM) ────────────────
// sinPrerreq: la declaración «Sin prerrequisitos» de la versión (solo cuenta para esa sección).
export function estadoSeccion(id, c, sinPrerreq = false) {
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
      const ok = (c || []).length > 0 || sinPrerreq === true;
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
  const estados = SECCIONES.map((s) => ({ ...s, ...estadoSeccion(s.id, contenidoDe(version, s.id), sinPrerrequisitos(version)) }));
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

// Niveles que acepta el G5 (ck_pv_nivel del G1): código → nombre.
export const NIVELES = { tecnico: "Técnico", licenciatura: "Licenciatura", maestria: "Maestría", doctorado: "Doctorado" };
/** «Maestría», «MAESTRIA» o «maestria» → «maestria». Lo que no es un nivel se devuelve tal cual. */
export function codigoNivel(v) {
  const t = texto(v).trim();
  const c = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return Object.hasOwn(NIVELES, c) ? c : t;
}
export const nombreNivel = (v) => { const c = codigoNivel(v); return NIVELES[c] || c; };

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
 * Crea el editor de una sección. ctx: {cursos, perfiles, sinPrerrequisitos, cursoCodigo, alCambiar}.
 * Devuelve {nodo, valor(), error()} — error() da el texto que impide guardar, o null.
 */
export function crearEditor(id, contenido, ctx) {
  const avisar = () => ctx.alCambiar?.();
  const c = copia(contenido);

  if (id === "general") {
    const v = c || {};
    v.nivel = codigoNivel(v.nivel) || null;
    // Un nivel guardado que no está en la lista se muestra tal cual, para que se vea y se corrija.
    const nivelesOfrecidos = v.nivel && !NIVELES[v.nivel] ? { ...NIVELES, [v.nivel]: `${v.nivel} (no válido)` } : NIVELES;
    const fijo = (dt, dd) => h("div", {}, h("dt", {}, dt), h("dd", {}, dd || "—"));
    return {
      nodo: h("div", { class: "v-editor" },
        h("dl", { class: "v-datos v-datos--fijos" },
          fijo("Código", v.codigo), fijo("Período", v.ciclo), fijo("Sede", v.sede), fijo("Modalidad", v.modalidad)),
        h("p", { class: "v-campo__ayuda" }, "Código, período, sede y modalidad vienen del catálogo y no se cambian aquí."),
        campoTexto("Nombre de la asignatura", v.asignatura, (x) => { v.asignatura = x; avisar(); }, { max: 200 }),
        h("div", { class: "v-dos" },
          campoTexto("Programa académico", v.programa, (x) => { v.programa = x; avisar(); }, { max: 150 }),
          campoTexto("Departamento", v.departamento, (x) => { v.departamento = x; avisar(); }, { max: 150 })),
        h("div", { class: "v-dos" },
          campoSelect("Nivel", v.nivel, nivelesOfrecidos, (x) => { v.nivel = x || null; avisar(); }, { vacio: "Sin indicar" }),
          campoTexto("Pénsum", v.pensum, (x) => { v.pensum = x; avisar(); }, { max: 50 }),
          campoNumero("Horas de clase por semana", v.horas, (x) => { v.horas = x; avisar(); }, { min: 0.5, paso: 0.5 })),
        campoTexto("Resumen de cambios de esta versión", v.resumen_cambios, (x) => { v.resumen_cambios = x; avisar(); },
          { multilinea: true, filas: 2, max: 1000, ayuda: "Qué cambió respecto de la versión anterior. Aparece en el historial." })),
      valor: () => ({
        asignatura: texto(v.asignatura).trim(), programa: texto(v.programa).trim() || null, departamento: texto(v.departamento).trim() || null,
        nivel: v.nivel || null, pensum: texto(v.pensum).trim() || null, horas: v.horas, resumen_cambios: texto(v.resumen_cambios).trim() || null,
      }),
      error: () => (!texto(v.asignatura).trim() ? "Escribe el nombre de la asignatura."
        : v.nivel && !NIVELES[v.nivel] ? "Elige el nivel de la lista: Técnico, Licenciatura, Maestría o Doctorado."
        : v.horas != null && v.horas <= 0 ? "Las horas deben ser mayores que cero." : null),
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
    // Cada fila ofrece los cursos del catálogo menos el del propio programa y los ya elegidos en otras filas.
    // Lo que la fila ya tiene se conserva (un programa viejo puede traerlo); si es el propio curso, se dice.
    const propio = ctx.cursoCodigo || null;
    const opcionesPara = (f) => {
      const enOtras = new Set(filas.filter((o) => o !== f && o.curso_id).map((o) => String(o.curso_id)));
      return Object.fromEntries((ctx.cursos || [])
        .filter((x) => String(x.id) === String(f.curso_id ?? "") || (x.code !== propio && !enOtras.has(String(x.id))))
        .map((x) => [x.id, `${x.code} · ${x.name}${x.code === propio ? " (es el curso de este programa)" : ""}`]));
    };
    const selectDe = new WeakMap();
    // Al elegir un curso en una fila, las demás dejan de ofrecerlo (y vuelven a ofrecer el que se soltó).
    const refrescarCursos = () => {
      for (const f of filas) {
        const sel = selectDe.get(f);
        if (!sel) continue;
        poner(sel, h("option", { value: "" }, "Elige el curso"),
          Object.entries(opcionesPara(f)).map(([v, t]) => h("option", { value: v, selected: String(f.curso_id ?? "") === String(v) }, t)));
      }
    };
    const conCursos = () => filas.some((f) => f.curso_id);
    const choque = "Quita los cursos de la lista para marcar «Sin prerrequisitos», o desmarca la casilla.";
    const avisoId = nuevoId("sp-aviso");
    const aviso = h("p", { id: avisoId, class: "v-msg v-msg--aviso", hidden: true }, choque);
    // Marcar con cursos en la lista no se guarda: se avisa junto a la casilla y error() lo frena.
    const casilla = h("input", { type: "checkbox", id: nuevoId("sp"), checked: ctx.sinPrerrequisitos === true, "aria-describedby": avisoId,
      onchange: () => { revisar(); avisar(); } });
    const revisar = () => { aviso.hidden = !(casilla.checked && conCursos()); };
    const alCambiarLista = () => { revisar(); avisar(); };
    revisar();
    return {
      nodo: h("div", { class: "v-editor" },
        h("label", { class: "v-check v-check--sola", for: casilla.id }, casilla, h("span", {}, h("strong", {}, "Sin prerrequisitos"), h("small", {}, "Márcalo si el curso no exige otros cursos antes."))),
        aviso,
        listaFilas({ filas, nombre: "Curso", agregar: "Agregar prerrequisito", vacio: "Sin cursos en la lista.", alCambiar: alCambiarLista,
          nueva: () => ({ curso_id: "", tipo: "obligatorio" }),
          campos: (f, ok) => h("div", { class: "v-dos" },
            // Elegir un curso desmarca la casilla (una lista con cursos anula la declaración, como en el servidor).
            // Agregar una fila y quitarla sin elegir curso no la toca.
            (() => {
              const campo = campoSelect("Curso", f.curso_id, opcionesPara(f), (x) => { f.curso_id = num(x); if (f.curso_id) casilla.checked = false; refrescarCursos(); ok(); }, { vacio: "Elige el curso" });
              selectDe.set(f, campo.querySelector("select"));
              return campo;
            })(),
            campoSelect("Tipo", f.tipo, TIPOS_PRERREQ, (x) => { f.tipo = x; ok(); })) })),
      valor: () => ({
        asignaturas: filas.filter((f) => f.curso_id).map((f, i) => ({ orden: i + 1, curso_id: f.curso_id, tipo: f.tipo })),
        sin_prerrequisitos: casilla.checked,
      }),
      error: () => (casilla.checked && conCursos() ? choque
        : filas.some((f) => !f.curso_id) ? "Elige el curso en cada fila o quita la fila vacía." : null),
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
// ── Lectura ──────────────────────────────────────────────────
const valor = (v) => (v == null || v === "" ? "—" : String(v));

/**
 * Ficha en rejilla de tres columnas: etiqueta arriba, valor abajo. campos: [[etiqueta, valor, {ancho}]].
 * Los campos a todo el ancho van al final; la última fila corta se completa con celdas vacías
 * para que la línea que la separa cruce toda la ficha.
 */
function ficha(campos) {
  const celda = ([dt, dd, o = {}]) => h("div", { class: `v-ficha__campo${o.ancho ? " v-ficha__campo--ancho" : ""}` }, h("dt", {}, dt), h("dd", {}, valor(dd)));
  const normales = campos.filter((x) => !x[2]?.ancho);
  const relleno = (3 - (normales.length % 3)) % 3;
  return h("dl", { class: "v-ficha" }, normales.map(celda),
    Array.from({ length: relleno }, () => h("div", { class: "v-ficha__campo v-ficha__relleno", "aria-hidden": "true" })),
    campos.filter((x) => x[2]?.ancho).map(celda));
}

/**
 * Tabla de lectura; en pantallas angostas cada fila se apila como tarjeta con sus etiquetas.
 * columnas: ["Etiqueta", ...]; filas: [[celda, ...]]; pie: nodo <tfoot> opcional;
 * anchos: ["64px", "40%", null] fija las columnas (igual en todas las tablas de una sección).
 */
function tablaLectura(columnas, filas, pie = null, anchos = null) {
  return h("div", { class: "v-tabla-marco" },
    h("table", { class: `v-tabla-lectura v-tabla-lectura--apilable${anchos ? " v-tabla-lectura--fija" : ""}` },
      anchos ? h("colgroup", {}, anchos.map((w) => h("col", { style: w ? `width: ${w}` : null }))) : null,
      h("thead", {}, h("tr", {}, columnas.map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, filas.map((f) => h("tr", {}, f.map((celda, i) => h("td", { "data-etq": columnas[i] }, celda == null || celda === "" ? "—" : celda))))),
      pie));
}

export function lecturaSeccion(id, c, ctx = {}) {
  const vacio = (t = "Sin datos.") => h("p", { class: "v-nota" }, t);
  switch (id) {
    case "general": {
      const v = c || {};
      return ficha([
        ["Código", v.codigo], ["Asignatura", v.asignatura], ["Período", v.ciclo],
        ["Sede", v.sede], ["Modalidad", v.modalidad], ["Nivel", nombreNivel(v.nivel)],
        ["Programa académico", v.programa], ["Departamento", v.departamento], ["Pénsum", v.pensum],
        ["Horas por semana", v.horas],
        ["Resumen de cambios", v.resumen_cambios, { ancho: true }],
      ]);
    }
    case "descripcion":
    case "metodologia":
      return texto(c?.texto).trim() ? h("p", { class: "v-texto" }, c.texto) : vacio();
    case "prerrequisitos":
      return (c || []).length ? tablaLectura(["Código", "Curso", "Tipo"], c.map((x) => [x.codigo, x.nombre, TIPOS_PRERREQ[x.tipo] || x.tipo]))
        : vacio(ctx.sinPrerrequisitos === true ? "Sin prerrequisitos." : "No se registraron prerrequisitos.");
    case "competencias":
      return (c || []).length ? tablaLectura(["Tipo", "Descripción"], c.map((x) => [TIPOS_COMPETENCIA[x.tipo] || x.tipo, x.descripcion])) : vacio();
    case "perfil":
      return (c || []).length ? tablaLectura(["Código", "Rasgo del perfil", "Contribución del curso"], c.map((x) => [x.codigo, x.descripcion, x.contribucion])) : vacio();
    case "bibliografia":
      return (c || []).length ? tablaLectura(["Tipo", "Referencia", "ISBN", "Enlace"],
        c.map((x) => [TIPOS_BIBLIO[x.tipo] || x.tipo, x.referencia, x.isbn, x.url ? h("span", { class: "v-url" }, x.url) : null])) : vacio();
    case "contenidos":
      return (c || []).length ? h("ol", { class: "v-unidades v-unidades--lectura" }, c.map((u, i) => h("li", { class: "v-unidad" },
        h("p", { class: "v-unidad__titulo" }, `Unidad ${i + 1}. ${u.titulo}`, u.horas != null ? h("span", { class: "v-nota" }, ` · ${u.horas} horas`) : null),
        (u.items || []).length ? tablaLectura(["N.º", "Tema", "Descripción"], u.items.map((t, j) => [`${i + 1}.${j + 1}`, t.item, t.descripcion]), null, ["64px", "40%", null]) : vacio("Sin temas.")))) : vacio();
    case "evaluacion":
      return (c || []).length ? tablaLectura(["Actividad", "Semana", "Ponderación"],
        c.map((x) => [x.nombre, x.semana, `${Number(x.ponderacion)} %`]),
        h("tfoot", {}, h("tr", {}, h("th", { scope: "row", colspan: 2 }, "Total"), h("td", { "data-etq": "Total" }, `${totalEvaluacion(c)} %`)))) : vacio();
    default: return vacio();
  }
}
