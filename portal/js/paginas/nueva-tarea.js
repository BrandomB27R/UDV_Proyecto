// Nueva tarea (coordinación) en cuatro pasos: datos, destinatarios, revisor, confirmar y publicar.
// También edita un borrador: /app/nueva-tarea.html?borrador=<id>.
import { api, ApiError } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { PRIORIDADES, fechaLarga, hoyGuatemala, nombreCompleto, ROLES } from "../formato.js";
import { todasLasPaginas, guardarAviso, sinAcceso, textoDeError, botonVolver } from "../componentes.js";
import { requerirSesion } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "tareas");
const idBorrador = new URLSearchParams(location.search).get("borrador");
tituloPestana(idBorrador ? "Editar borrador" : "Nueva tarea");

const PASOS = [
  { id: "datos", texto: "Datos" },
  { id: "destinatarios", texto: "Destinatarios" },
  { id: "revisor", texto: "Revisor" },
  { id: "confirmar", texto: "Confirmar y publicar" },
];

// ── Estado del formulario ──
const f = {
  type_id: null, title: "", description: "", due_date: "", priority: "medium",
  // modo: "users" (los elijo), "curso" (los que dan un curso; se guarda como "users"), "filter" o "all".
  modo: "users", user_ids: new Set(), filtro: "",          // filtro: "campus:<nombre>" | "unit:<nombre>"
  curso: { course_id: null, period_id: null },             // curso y período de «Por curso»
  // Por defecto revisa quien crea la tarea, si tiene el rol de revisión; si no, sin revisor designado.
  reviewer_id: (yo.roles || []).includes("reviewer") ? yo.id : null,
  course_id: null, period_id: null,                         // obligatorios si el tipo es "Actualizar programa"
};
// Docentes que dan un curso en un período (GET /tasks/eligible-teachers), por "curso:período":
// {filas: [{id, name, email, campus}], error}. aplicadosA: la última clave cuyos docentes se marcaron.
const delCurso = new Map();
let aplicadosA = null;
let cargandoCurso = null;
let errorCurso = null;
let paso = 0;
let tareaId = idBorrador && /^\d+$/.test(idBorrador) ? Number(idBorrador) : null;
let buscarDocente = "";
let paginaDocentes = 1;
const POR_PAGINA_DOCENTES = 10;
const MAX_CHIPS = 12;

// ── Catálogos ──
const SIN_PERMISO = "Crear tareas es de coordinación.";
if (!(yo.roles || []).includes("coordinator")) await sinAcceso(raiz, "Nueva tarea", SIN_PERMISO);
let tipos = [], usuarios = [], sedes = [], unidades = [], cursos = [], periodos = [];
try {
  const [ty, us, ca, au, cu, pe] = await Promise.all([
    api("/task-types?per_page=100"),
    todasLasPaginas(api, "/users"),
    api("/campuses?per_page=100").catch(() => ({ data: [] })),
    api("/academic-units?per_page=100").catch(() => ({ data: [] })),
    todasLasPaginas(api, "/courses"),
    todasLasPaginas(api, "/periods"),
  ]);
  tipos = ty.data || [];
  usuarios = (us.data || []).filter((u) => u.activo !== false);
  sedes = (ca.data || []).filter((x) => x.is_active !== false);
  unidades = (au.data || []).filter((x) => x.is_active !== false);
  cursos = (cu.data || []).filter((x) => x.is_active !== false).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  periodos = (pe.data || []).filter((x) => x.is_active !== false).sort((a, b) => String(b.code).localeCompare(String(a.code)));
  if (tareaId) await cargarBorrador(tareaId);
} catch (e) {
  await sinAcceso(raiz, "Nueva tarea", textoDeError(e, SIN_PERMISO));
}

const tipoActual = () => tipos.find((t) => t.id === f.type_id) || null;
const esPrograma = () => tipoActual()?.code === "ACTUALIZAR_PROGRAMA";
const nombreCurso = (id) => { const c = cursos.find((x) => x.id === id); return c ? `${c.code} · ${c.name}` : ""; };
const nombrePeriodo = (id) => { const x = periodos.find((y) => y.id === id); return x ? `${x.code}${x.name ? ` (${x.name})` : ""}` : ""; };

const claveCurso = () => (f.curso.course_id && f.curso.period_id ? `${f.curso.course_id}:${f.curso.period_id}` : null);

/**
 * Pide los docentes del curso en el período de «Por curso» y, la primera vez para esa clave, los deja
 * marcados (reemplazan a los elegidos). Devuelve la entrada de delCurso o null si falta curso o período.
 */
async function cargarCurso() {
  const clave = claveCurso();
  if (!clave) return null;
  if (!delCurso.has(clave)) {
    try {
      const r = await api(`/tasks/eligible-teachers?course_id=${encodeURIComponent(f.curso.course_id)}&period_id=${encodeURIComponent(f.curso.period_id)}`);
      // Un docente puede dar el curso en varias sedes: una fila por docente, con sus sedes juntas.
      const porId = new Map();
      for (const x of r.data || []) {
        const y = porId.get(x.id) || { id: x.id, name: x.name, email: x.email, sedes: [] };
        if (x.campus && !y.sedes.includes(x.campus)) y.sedes.push(x.campus);
        porId.set(x.id, y);
      }
      delCurso.set(clave, { filas: [...porId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "es")), error: null });
      errorCurso = null;
    } catch (e) {
      // No se guarda en caché: al volver a elegir se intenta otra vez.
      errorCurso = e.message;
      return { filas: [], error: e.message };
    }
  }
  const d = delCurso.get(clave);
  if (aplicadosA !== clave) {
    f.user_ids = new Set(d.filas.map((x) => x.id));
    aplicadosA = clave;
    paginaDocentes = 1;
  }
  return d;
}

/** Al pasar del paso 1: en «Actualizar programa» con curso y período, «Por curso» viene preseleccionado. */
async function proponerPorCurso() {
  if (!esPrograma() || !f.course_id || !f.period_id) return;
  const clave = `${f.course_id}:${f.period_id}`;
  if (aplicadosA === clave) return;                 // ya se propusieron (o el borrador ya tenía los suyos)
  f.modo = "curso";
  f.curso = { course_id: f.course_id, period_id: f.period_id };
  await cargarCurso();
}

const docentes = usuarios.filter((u) => (u.roles || []).includes("teacher"))
  .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b)));
// Quien puede revisar: revisión, coordinación o dirección (la base conserva los seis roles).
// La API solo acepta como revisor a quien tiene el rol reviewer (422 si no).
const revisores = usuarios.filter((u) => (u.roles || []).includes("reviewer"))
  .sort((a, b) => (a.id === yo.id ? -1 : b.id === yo.id ? 1 : nombreCompleto(a).localeCompare(nombreCompleto(b))));

async function cargarBorrador(id) {
  const t = await api(`/tasks/${id}`);
  if (t.status !== "draft") throw new ApiError(409, "NOT_DRAFT", "Esa tarea ya no es un borrador; ábrela desde Tareas.");
  Object.assign(f, {
    type_id: t.type_id, title: t.title || "", description: t.description || "",
    due_date: (t.due_date || "").slice(0, 10), priority: t.priority || "medium", reviewer_id: t.reviewer_id ?? null,
    course_id: t.course_id ?? null, period_id: t.period_id ?? null,
  });
  // Los destinatarios guardados del borrador mandan: no se reemplazan por los del curso.
  if (t.course_id && t.period_id) aplicadosA = `${t.course_id}:${t.period_id}`;
  const r = t.recipient_rule;
  if (r?.mode === "all") f.modo = "all";
  else if (r?.mode === "filter") { f.modo = "filter"; f.filtro = r.unit ? `unit:${r.unit}` : `campus:${r.campus}`; }
  else if (r?.mode === "users") { f.modo = "users"; f.user_ids = new Set(r.user_ids || []); }
}

// ── Tipos de tarea ──
const FORMAS = {
  texto: { titulo: "Solo texto", detalle: "Se entrega escribiendo; no lleva archivos." },
  ambos: { titulo: "Texto y archivo opcional", detalle: "Se escribe y, si hace falta, se adjunta un archivo." },
  archivo: { titulo: "Archivo obligatorio", detalle: "No se puede entregar sin adjuntar un archivo." },
};
/** Una línea que dice cómo se entrega cada tipo. */
function comoSeEntrega(t) {
  if (t.delivery_mode === "programa" || t.code === "ACTUALIZAR_PROGRAMA") return "Se entrega el programa del curso; pide curso y período.";
  if (t.requires_evidence) return "La entrega exige un archivo.";
  if (t.delivery_mode === "texto" || t.delivery_mode === "formulario") return "Se entrega solo con texto.";
  return "Texto y archivo opcional.";
}
const otro = { abierto: false, nombre: "", forma: "ambos", error: "", ocupado: false };

// ── Pintado ──
const zonaError = h("div", { "aria-live": "assertive" });
const cuerpo = h("div", { class: "v-cabecera", style: "gap: 24px" });
const indicador = h("div", { class: "v-pasos-form" });
const botones = h("div", { class: "v-acciones v-acciones--form" });
// Al corregir cualquier campo, el error del paso se quita.
for (const ev of ["input", "change"]) cuerpo.addEventListener(ev, () => poner(zonaError));

poner(raiz,
  botonVolver({ texto: "Tareas", href: RUTAS.tareas }),
  h("h1", { class: "v-h1" }, tareaId ? "Editar borrador" : "Nueva tarea"),
  h("section", { class: "v-card v-card--form", "aria-labelledby": "t-paso-form" }, indicador, zonaError, cuerpo, botones));
pintar();

function pintar(enfocar = false) {
  poner(zonaError);
  poner(indicador,
    h("div", { class: "v-linea__mini", "aria-hidden": "true" }, PASOS.map((p, i) =>
      h("span", { class: `v-linea__seg${i < paso ? " v-linea__seg--hecho" : i === paso ? " v-linea__seg--actual" : ""}` }))),
    h("p", { class: "v-eyebrow", id: "t-paso-form" }, `Paso ${paso + 1} de ${PASOS.length} · ${PASOS[paso].texto}`));
  poner(cuerpo, [pasoDatos, pasoDestinatarios, pasoRevisor, pasoConfirmar][paso]());
  poner(botones,
    paso > 0 ? h("button", { type: "button", class: "v-btn v-btn--sec", onclick: () => { paso--; pintar(true); } }, "Anterior") :
      h("a", { class: "v-btn v-btn--sec", href: tareaId ? `/app/tarea.html?id=${tareaId}` : RUTAS.tareas }, "Cancelar"),
    paso < PASOS.length - 1
      ? h("button", { type: "button", class: "v-btn", onclick: siguiente }, "Siguiente")
      : [h("button", { type: "button", class: "v-btn v-btn--sec", onclick: () => guardar(false) }, "Guardar borrador"),
        h("button", { type: "button", class: "v-btn", onclick: () => guardar(true) }, "Publicar")]);
  if (enfocar) document.getElementById("t-paso-form")?.scrollIntoView({ block: "center" });
}

function error(texto, campo) {
  poner(zonaError, mensaje("error", texto));
  if (campo) {
    const el = document.getElementById(campo);
    el?.setAttribute("aria-invalid", "true");
    el?.focus();
  }
}

async function siguiente() {
  const fallo = validar(paso);
  if (fallo) { error(fallo.texto, fallo.campo); return; }
  if (paso === 0) await proponerPorCurso();
  paso++;
  pintar(true);
}

function validar(i) {
  if (i === 0) {
    if (otro.abierto && !f.type_id) return { texto: "Crea el tipo nuevo con «Crear y elegir este tipo» o elige uno de la lista.", campo: "nombre-tipo" };
    if (!f.type_id) return { texto: "Elige el tipo de tarea.", campo: `tipo-${tipos[0]?.id}` };
    if (f.title.trim().length < 3) return { texto: "Escribe un título (al menos 3 letras).", campo: "titulo" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.due_date)) return { texto: "Elige la fecha límite.", campo: "fecha" };
    if (f.due_date < hoyGuatemala()) return { texto: "La fecha límite no puede ser anterior a hoy.", campo: "fecha" };
    if (esPrograma() && !f.course_id) return { texto: "Elige el curso cuyo programa se actualiza.", campo: "curso" };
    if (esPrograma() && !f.period_id) return { texto: "Elige el período.", campo: "periodo" };
  }
  if (i === 1) {
    if (f.modo === "curso") {
      if (!f.curso.course_id) return { texto: "Elige el curso.", campo: "curso-dest" };
      if (!f.curso.period_id) return { texto: "Elige el período.", campo: "periodo-dest" };
      const d = delCurso.get(claveCurso());
      if (!d) return { texto: errorCurso ? "No se pudieron consultar los docentes del curso. Vuelve a elegir el curso para intentarlo otra vez." : "Espera a que se carguen los docentes del curso.", campo: "curso-dest" };
      if (!d.filas.length) return { texto: "Nadie tiene asignado este curso en ese período. Elige otro curso o período, o elige a los docentes de otra forma.", campo: "curso-dest" };
    }
    if ((f.modo === "users" || f.modo === "curso") && !f.user_ids.size) return { texto: "Elige al menos un docente.", campo: "buscar-docente" };
    if (f.modo === "filter" && !f.filtro) return { texto: "Elige la sede o la unidad.", campo: "filtro" };
  }
  return null;
}


async function crearTipo(zonaError, boton) {
  const nombre = otro.nombre.trim();
  if (nombre.length < 3) { otro.error = "Escribe el nombre del tipo (al menos 3 letras)."; pintar(); document.getElementById("nombre-tipo")?.focus(); return; }
  boton.disabled = true; boton.textContent = "Creando…";
  try {
    const nuevo = await api("/task-types", { method: "POST", body: { name: nombre, delivery: otro.forma } });
    tipos = (await api("/task-types?per_page=100")).data || [];
    f.type_id = nuevo?.id ?? tipos.find((t) => t.name === nombre)?.id ?? null;
    Object.assign(otro, { abierto: false, nombre: "", forma: "ambos", error: "" });
    pintar();
    // Después de repintar: pintar() limpia la zona de mensajes.
    poner(zonaError, mensaje("ok", `Tipo «${nombre}» creado y elegido.`));
    return;
  } catch (e) {
    otro.error = e instanceof ApiError && e.status === 409 ? "Ya existe un tipo con ese nombre: elígelo de la lista." : e.message;
  }
  pintar();
  if (otro.error) document.getElementById("nombre-tipo")?.focus();
}

// ── Paso 1: datos ──
function pasoDatos() {
  const campo = (id, etiqueta, control, ayuda) => h("div", { class: "v-campo" },
    h("label", { for: id }, etiqueta), control, ayuda ? h("span", { class: "v-campo__ayuda" }, ayuda) : null);
  const zonaCurso = h("div");
  const pintarCurso = () => poner(zonaCurso, esPrograma() ? h("div", { class: "v-curso" },
    h("p", { class: "v-campo__ayuda" }, "Obligatorios en este tipo: dicen qué programa se actualiza y a qué docentes se propone la tarea."),
    h("div", { class: "v-dos" },
      campo("curso", "Curso", h("select", { id: "curso", onchange: (e) => { f.course_id = e.target.value ? Number(e.target.value) : null; } },
        h("option", { value: "" }, "Elige el curso"),
        cursos.map((c) => h("option", { value: String(c.id), selected: f.course_id === c.id }, `${c.code} · ${c.name}`)))),
      campo("periodo", "Período", h("select", { id: "periodo", onchange: (e) => { f.period_id = e.target.value ? Number(e.target.value) : null; } },
        h("option", { value: "" }, "Elige el período"),
        periodos.map((x) => h("option", { value: String(x.id), selected: f.period_id === x.id }, `${x.code}${x.name ? ` · ${x.name}` : ""}`)))))) : null);
  pintarCurso();
  return [
    h("fieldset", { class: "v-grupo" },
      h("legend", { class: "v-campo__etq" }, "Tipo de tarea"),
      h("p", { class: "v-campo__ayuda" },
        "El tipo dice cómo se entrega: solo texto, texto con archivo opcional o archivo obligatorio. Si ninguno sirve, crea otro con «Otro tipo…». Todo lo demás (título, instrucciones, fecha, prioridad y destinatarios) lo escribes tú."),
      h("div", { class: "v-opciones" },
        tipos.map((t) => h("label", { class: "v-opcion" },
          h("input", { type: "radio", name: "tipo", id: `tipo-${t.id}`, value: String(t.id), checked: !otro.abierto && f.type_id === t.id,
            onchange: () => { f.type_id = t.id; otro.abierto = false; pintar(); } }),
          h("span", { class: "v-opcion__txt" }, h("strong", {}, t.name), h("span", {}, comoSeEntrega(t))))),
        h("label", { class: "v-opcion v-opcion--otro" },
          h("input", { type: "radio", name: "tipo", id: "tipo-otro", value: "otro", checked: otro.abierto,
            onchange: () => { otro.abierto = true; f.type_id = null; pintar(); document.getElementById("nombre-tipo")?.focus(); } }),
          h("span", { class: "v-opcion__txt" }, h("strong", {}, "Otro tipo…"), h("span", {}, "Crea un tipo nuevo con su forma de entrega."))))),
    otro.abierto ? formularioOtroTipo() : null,
    zonaCurso,
    campo("titulo", "Título", h("input", { id: "titulo", type: "text", maxlength: 200, value: f.title, autocomplete: "off",
      placeholder: "Por ejemplo: Actualizar CV para la acreditación 2027",
      oninput: (e) => { f.title = e.target.value; e.target.removeAttribute("aria-invalid"); } })),
    campo("instrucciones", "Instrucciones", h("textarea", { id: "instrucciones", rows: 4, maxlength: 10000, value: f.description,
      placeholder: "Qué se pide, cómo se entrega y qué se va a revisar.",
      oninput: (e) => { f.description = e.target.value; } }), "Opcional, pero ayuda a que nadie tenga que preguntar."),
    h("div", { class: "v-dos" },
      campo("fecha", "Fecha límite", h("input", { id: "fecha", type: "date", min: hoyGuatemala(), value: f.due_date,
        onchange: (e) => { f.due_date = e.target.value; e.target.removeAttribute("aria-invalid"); } }), "Vence al final de ese día."),
      campo("prioridad", "Prioridad", h("select", { id: "prioridad", onchange: (e) => { f.priority = e.target.value; } },
        Object.entries(PRIORIDADES).map(([v, t]) => h("option", { value: v, selected: f.priority === v }, t))))),
  ];
}

function formularioOtroTipo() {
  const zona = h("div", { "aria-live": "polite" });
  const boton = h("button", { type: "button", class: "v-btn v-btn--chico", onclick: () => crearTipo(zonaError, boton) }, "Crear y elegir este tipo");
  return h("div", { class: "v-otro-tipo" },
    h("div", { class: "v-campo" },
      h("label", { for: "nombre-tipo" }, "Nombre del tipo"),
      h("input", { id: "nombre-tipo", type: "text", maxlength: 100, value: otro.nombre, autocomplete: "off",
        placeholder: "Por ejemplo: Entregar planificación semestral", "aria-invalid": otro.error ? "true" : null,
        "aria-describedby": otro.error ? "error-tipo" : null,
        oninput: (e) => { otro.nombre = e.target.value; } }),
      otro.error ? h("span", { id: "error-tipo", class: "v-campo__error", role: "alert" }, otro.error) : null),
    h("fieldset", { class: "v-grupo" },
      h("legend", { class: "v-campo__etq" }, "Cómo se entrega"),
      h("div", { class: "v-opciones v-opciones--3" }, Object.entries(FORMAS).map(([v, x]) => h("label", { class: "v-opcion" },
        h("input", { type: "radio", name: "forma-tipo", value: v, checked: otro.forma === v, onchange: () => { otro.forma = v; } }),
        h("span", { class: "v-opcion__txt" }, h("strong", {}, x.titulo), h("span", {}, x.detalle)))))),
    h("div", { class: "v-acciones" }, boton),
    zona);
}

// ── Paso 2: destinatarios ──
function pasoDestinatarios() {
  const zonaModo = h("div");
  const modo = (valor, titulo, detalle) => h("label", { class: "v-opcion" },
    h("input", { type: "radio", name: "modo", value: valor, id: `modo-${valor}`, checked: f.modo === valor,
      onchange: () => { f.modo = valor; paginaDocentes = 1; pintarModo(); } }),
    h("span", { class: "v-opcion__txt" }, h("strong", {}, titulo), h("span", {}, detalle)));

  function pintarModo() {
    if (f.modo === "all") {
      poner(zonaModo, h("p", { class: "v-nota" }, `La recibirán los ${docentes.length} docentes activos.`));
    } else if (f.modo === "filter") {
      poner(zonaModo, h("div", { class: "v-campo" },
        h("label", { for: "filtro" }, "Sede o unidad académica"),
        h("select", { id: "filtro", onchange: (e) => { f.filtro = e.target.value; e.target.removeAttribute("aria-invalid"); } },
          h("option", { value: "" }, "Elige una opción"),
          h("optgroup", { label: "Sedes" }, sedes.map((x) => h("option", { value: `campus:${x.name}`, selected: f.filtro === `campus:${x.name}` }, x.name))),
          h("optgroup", { label: "Unidades académicas" }, unidades.map((u) => h("option", { value: `unit:${u.name}`, selected: f.filtro === `unit:${u.name}` }, u.name)))),
        h("span", { class: "v-campo__ayuda" }, "La reciben los docentes activos de esa sede o unidad al momento de publicar.")));
    } else {
      poner(zonaModo, f.modo === "curso" ? elegirCurso() : null, tablaDocentes());
    }
  }

  // «Por curso»: curso y período; al tener los dos se piden sus docentes y quedan marcados.
  function elegirCurso() {
    if (!f.curso.course_id && !f.curso.period_id && f.course_id) f.curso = { course_id: f.course_id, period_id: f.period_id };
    const estado = h("p", { class: "nt-curso__estado", id: "estado-curso", "aria-live": "polite" });
    const pintarEstado = () => {
      const clave = claveCurso();
      const d = clave ? delCurso.get(clave) : null;
      if (!clave) { poner(estado, "Elige el curso y el período."); return; }
      if (cargandoCurso === clave) { poner(estado, "Buscando a los docentes de ese curso…"); return; }
      if (!d) { poner(estado); return; }
      const periodo = periodos.find((x) => x.id === f.curso.period_id)?.code || "";
      poner(estado, d.filas.length
        ? [h("strong", {}, `${d.filas.length} ${d.filas.length === 1 ? "docente da" : "docentes dan"}`),
          ` este curso en ${periodo}. ${d.filas.length === 1 ? "Quedó marcado; puedes quitarlo." : "Quedaron marcados; puedes quitar alguno."}`]
        : "Nadie tiene asignado este curso en ese período.");
    };
    const cambiar = async () => {
      poner(zonaError);
      const clave = claveCurso();
      if (!clave) { pintarEstado(); return; }
      cargandoCurso = clave;
      pintarEstado();
      const d = await cargarCurso();
      cargandoCurso = null;
      if (claveCurso() !== clave) return;            // cambió mientras se pedía
      if (d?.error) { poner(estado, mensaje("error", `No se pudieron consultar los docentes del curso: ${d.error}`)); return; }
      pintarEstado();
      pintarElegidos();
      pintarTabla();
    };
    const sel = (id, etiqueta, valor, opciones, al) => h("div", { class: "v-campo" },
      h("label", { for: id }, etiqueta),
      h("select", { id, "aria-describedby": "estado-curso", onchange: (e) => { e.target.removeAttribute("aria-invalid"); al(e.target.value ? Number(e.target.value) : null); cambiar(); } },
        h("option", { value: "" }, etiqueta === "Curso" ? "Elige el curso" : "Elige el período"),
        opciones.map(([v, t]) => h("option", { value: String(v), selected: valor === v }, t))));
    const nodo = h("div", { class: "nt-curso" },
      sel("curso-dest", "Curso", f.curso.course_id, cursos.map((c) => [c.id, `${c.code} · ${c.name}`]), (v) => { f.curso.course_id = v; }),
      sel("periodo-dest", "Período", f.curso.period_id, periodos.map((x) => [x.id, x.code]), (v) => { f.curso.period_id = v; }),
      estado);
    // Si ya hay curso y período (vienen del paso 1 o se eligieron antes), se piden o se muestran.
    if (claveCurso() && !delCurso.has(claveCurso())) cambiar(); else pintarEstado();
    return nodo;
  }

  // ── Elegidos y tabla de docentes (para «Docentes que elijo» y «Por curso») ──
  let zonaElegidos, zonaTabla, botonMarcar;
  const nombreDe = new Map(docentes.map((u) => [u.id, nombreCompleto(u)]));

  /** Filas de la tabla: todos los docentes o, en «Por curso», los que dan el curso (con su sede). */
  function filasBase() {
    if (f.modo === "curso") {
      const d = delCurso.get(claveCurso());
      return (d?.filas || []).map((x) => ({ id: x.id, nombre: x.name, correo: x.email, sede: x.sedes.join(" · ") }));
    }
    return docentes.map((u) => ({ id: u.id, nombre: nombreCompleto(u), correo: u.correo }));
  }
  const sinTildes = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filtradas = () => {
    const q = sinTildes(buscarDocente);
    return filasBase().filter((x) => !q || sinTildes(`${x.nombre} ${x.correo}`).includes(q));
  };

  function pintarElegidos() {
    if (!zonaElegidos) return;
    const ids = [...f.user_ids];
    const n = ids.length;
    const nombre = (id) => nombreDe.get(id) || delCurso.get(claveCurso())?.filas.find((x) => x.id === id)?.name || `Docente ${id}`;
    poner(zonaElegidos,
      h("div", { class: "nt-elegidos__cab" },
        h("strong", { id: "t-elegidos" }, n ? `${n} ${n === 1 ? "docente elegido" : "docentes elegidos"}` : "Todavía no eliges a ningún docente"),
        n ? h("button", { type: "button", class: "v-enlace", onclick: () => { f.user_ids.clear(); pintarElegidos(); pintarTabla(); document.getElementById("buscar-docente")?.focus(); } }, "Quitar todos") : null),
      n ? h("ul", { class: "nt-chips", "aria-labelledby": "t-elegidos" },
        ids.slice(0, MAX_CHIPS).map((id, i) => h("li", { class: "nt-chip" },
          h("span", {}, nombre(id)),
          h("button", { type: "button", class: "nt-chip__x", "data-chip": id, "aria-label": `Quitar a ${nombre(id)}`, onclick: () => {
            f.user_ids.delete(id);
            pintarElegidos();
            pintarTabla();
            // El foco pasa a la etiqueta que quedó en su lugar (o al buscador si no queda ninguna).
            const sig = [...f.user_ids][Math.min(i, f.user_ids.size - 1)];
            (sig != null && zonaElegidos.querySelector(`[data-chip="${sig}"]`) || document.getElementById("buscar-docente"))?.focus();
          } }, h("span", { "aria-hidden": "true" }, "×")))),
        n > MAX_CHIPS ? h("li", { class: "nt-chips__mas" }, `y ${n - MAX_CHIPS} más`) : null) : null);
  }

  function pintarTabla() {
    if (!zonaTabla) return;
    const v = filtradas();
    const paginas = Math.max(1, Math.ceil(v.length / POR_PAGINA_DOCENTES));
    paginaDocentes = Math.min(Math.max(1, paginaDocentes), paginas);
    const desde = (paginaDocentes - 1) * POR_PAGINA_DOCENTES;
    const filas = v.slice(desde, desde + POR_PAGINA_DOCENTES);
    const conSede = filas.some((x) => x.sede);
    const faltan = v.filter((x) => !f.user_ids.has(x.id)).length;
    botonMarcar.textContent = v.length ? `Marcar ${v.length === 1 ? "al 1" : `los ${v.length}`} de esta lista` : "Marcar los de esta lista";
    botonMarcar.disabled = !v.length || !faltan;
    if (f.modo === "curso" && !claveCurso()) { poner(zonaTabla); return; }
    poner(zonaTabla,
      filas.length ? h("table", { class: "nt-docentes" },
        h("caption", { class: "v-sr" }, "Docentes que puedes elegir"),
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Elegir")),
          h("th", { scope: "col" }, "Docente"),
          conSede ? h("th", { scope: "col" }, "Sede") : null)),
        h("tbody", {}, filas.map((x) => h("tr", {},
          h("td", { class: "nt-docentes__casilla" }, h("input", { type: "checkbox", id: `doc-${x.id}`, value: String(x.id), checked: f.user_ids.has(x.id),
            onchange: (e) => { if (e.target.checked) f.user_ids.add(x.id); else f.user_ids.delete(x.id); poner(zonaError); pintarElegidos(); pintarTabla(); document.getElementById(`doc-${x.id}`)?.focus(); } })),
          h("td", { "data-etiqueta": "Docente" }, h("label", { for: `doc-${x.id}`, class: "nt-docentes__nombre" }, h("strong", {}, x.nombre), h("span", {}, x.correo))),
          conSede ? h("td", { "data-etiqueta": "Sede" }, x.sede || "—") : null))))
        : h("p", { class: "v-nota" }, buscarDocente ? "Ningún docente coincide con la búsqueda." : f.modo === "curso" ? "Nadie tiene asignado este curso en ese período." : "No hay docentes activos."),
      v.length ? h("nav", { class: "au-paginas", "aria-label": "Páginas de docentes" },
        h("span", {}, `${v.length} ${v.length === 1 ? "docente" : "docentes"} · mostrando del ${desde + 1} al ${desde + filas.length} · ${POR_PAGINA_DOCENTES} por página`),
        h("div", { class: "au-paginas__botones" },
          h("button", { type: "button", class: "v-enlace", disabled: paginaDocentes <= 1, onclick: () => { paginaDocentes--; pintarTabla(); } }, "← Anterior"),
          h("span", {}, `Página ${paginaDocentes} de ${paginas}`),
          h("button", { type: "button", class: "v-enlace", disabled: paginaDocentes >= paginas, onclick: () => { paginaDocentes++; pintarTabla(); } }, "Siguiente →"))) : null);
  }

  function tablaDocentes() {
    zonaElegidos = h("div", { class: "nt-elegidos", "aria-live": "polite" });
    zonaTabla = h("div", { class: "nt-tabla" });
    botonMarcar = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico nt-marcar", onclick: () => {
      filtradas().forEach((x) => f.user_ids.add(x.id));
      poner(zonaError); pintarElegidos(); pintarTabla();
    } }, "Marcar los de esta lista");
    let espera = null;
    const buscar = h("input", { id: "buscar-docente", type: "search", placeholder: "Nombre o correo", value: buscarDocente, autocomplete: "off",
      oninput: (e) => {
        e.target.removeAttribute("aria-invalid");
        clearTimeout(espera);
        espera = setTimeout(() => { buscarDocente = e.target.value.trim(); paginaDocentes = 1; pintarTabla(); }, 200);
      } });
    const nodo = h("div", { class: "v-destinatarios" },
      zonaElegidos,
      h("div", { class: "nt-buscar" },
        h("div", { class: "v-campo" }, h("label", { for: "buscar-docente" }, "Buscar en la lista"), buscar),
        botonMarcar),
      zonaTabla);
    pintarElegidos();
    pintarTabla();
    return nodo;
  }

  pintarModo();
  return [
    h("fieldset", { class: "v-grupo" },
      h("legend", { class: "v-campo__etq" }, "¿A quién va dirigida?"),
      h("div", { class: "v-opciones nt-modos" },
        modo("users", "Docentes que elijo", "Busca y marca uno o varios."),
        modo("curso", "Por curso", "Los docentes que dan un curso en un período."),
        modo("filter", "Por sede o unidad", "Los de una sede o unidad académica."),
        modo("all", "Todos los docentes", "Todos los docentes activos."))),
    zonaModo,
  ];
}

// ── Paso 3: revisor ──
function pasoRevisor() {
  const opcion = (valor, titulo, detalle) => h("label", { class: "v-opcion" },
    h("input", { type: "radio", name: "revisor", value: String(valor ?? "ninguno"), checked: f.reviewer_id === valor,
      onchange: () => { f.reviewer_id = valor; } }),
    h("span", { class: "v-opcion__txt" }, h("strong", {}, titulo), h("span", {}, detalle)));
  const rolesDe = (u) => (u.roles || []).map((r) => ROLES[r] || r).join(", ");
  return [
    h("fieldset", { class: "v-grupo" },
      h("legend", { class: "v-campo__etq" }, "¿Quién revisa las entregas?"),
      h("p", { class: "v-campo__ayuda" }, "El revisor toma cada entrega, la aprueba o la devuelve con una observación. Solo aparecen quienes tienen el rol de revisión."),
      h("div", { class: "v-opciones" },
        revisores.map((u) => opcion(u.id, u.id === yo.id ? `${nombreCompleto(u)} (tú)` : nombreCompleto(u), rolesDe(u))),
        opcion(null, "Sin revisor designado", "La revisa la coordinación que crea la tarea; la aprueba quien tenga el rol de dirección."))),
  ];
}

// ── Paso 4: confirmar ──
function describirDestinatarios() {
  if (f.modo === "all") return `Todos los docentes activos (${docentes.length})`;
  if (f.modo === "filter") return f.filtro ? `Docentes de ${f.filtro.split(":").slice(1).join(":")}` : "Sin elegir";
  const n = docentes.filter((u) => f.user_ids.has(u.id)).map(nombreCompleto);
  const nombres = n.length ? n.join(", ") : "Sin elegir";
  if (f.modo === "curso" && claveCurso()) {
    const periodo = periodos.find((x) => x.id === f.curso.period_id)?.code || "";
    return `Por curso (${nombreCurso(f.curso.course_id)} en ${periodo}): ${nombres}`;
  }
  return nombres;
}

function pasoConfirmar() {
  const tipo = tipos.find((t) => t.id === f.type_id);
  const revisor = f.reviewer_id == null ? "Sin revisor designado (revisa la coordinación)"
    : f.reviewer_id === yo.id ? `${yo.nombre} (tú)` : nombreCompleto(usuarios.find((u) => u.id === f.reviewer_id) || {});
  const fila = (dt, dd, irA) => h("div", { class: "v-resumen__fila" },
    h("dt", {}, dt), h("dd", {}, dd),
    h("button", { type: "button", class: "v-enlace", onclick: () => { paso = irA; pintar(true); } }, `Cambiar ${dt.toLowerCase()}`));
  return [
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" },
      "Revisa los datos. Al publicar, a cada docente le llega su aviso y la tarea aparece en sus pendientes. Si prefieres terminarla después, guárdala como borrador."),
    h("dl", { class: "v-resumen" },
      fila("Tipo", tipo ? `${tipo.name} · ${comoSeEntrega(tipo).toLowerCase().replace(/\.$/, "")}` : "—", 0),
      esPrograma() ? fila("Curso", nombreCurso(f.course_id), 0) : null,
      esPrograma() ? fila("Período", nombrePeriodo(f.period_id), 0) : null,
      fila("Título", f.title.trim(), 0),
      fila("Instrucciones", f.description.trim() || "Sin instrucciones", 0),
      fila("Fecha límite", fechaLarga(f.due_date), 0),
      fila("Prioridad", PRIORIDADES[f.priority], 0),
      fila("Destinatarios", describirDestinatarios(), 1),
      fila("Revisor", revisor, 2)),
  ];
}

// Errores de validación de la API por campo: mensaje en español y el paso donde se corrige.
const CAMPOS = {
  type_id: { paso: 0, control: () => `tipo-${tipos[0]?.id}`, texto: "El tipo de tarea elegido ya no es válido. Elige otro." },
  title: { paso: 0, control: () => "titulo", texto: "Revisa el título: falta o es demasiado largo." },
  description: { paso: 0, control: () => "instrucciones", texto: "Revisa las instrucciones: son demasiado largas." },
  due_date: { paso: 0, control: () => "fecha", texto: "Revisa la fecha límite: no es una fecha válida." },
  priority: { paso: 0, control: () => "prioridad", texto: "Elige una prioridad de la lista." },
  course_id: { paso: 0, control: () => "curso", texto: "Ese curso no existe o ya no está activo. Elige otro." },
  period_id: { paso: 0, control: () => "periodo", texto: "Ese período no existe o ya no está activo. Elige otro." },
  user_ids: { paso: 1, control: () => "buscar-docente", texto: "Hay personas elegidas que no son docentes activos. Revisa la lista." },
  invalid_user_ids: { paso: 1, control: () => "buscar-docente", texto: "Hay personas elegidas que no son docentes activos. Revisa la lista." },
  campus: { paso: 1, control: () => "filtro", texto: "Esa sede no existe o ya no está activa. Elige otra." },
  unit: { paso: 1, control: () => "filtro", texto: "Esa unidad académica no existe o ya no está activa. Elige otra." },
  reviewer_id: { paso: 2, control: () => null, texto: "La persona elegida no puede revisar: necesita el rol de revisión. Elige otra o deja la tarea sin revisor designado." },
};
function errorDeCampo(e) {
  if (!(e instanceof ApiError) || e.status !== 422 || !e.details || typeof e.details !== "object") return null;
  const claves = [e.details.field, ...(Array.isArray(e.details.fields) ? e.details.fields : []), ...Object.keys(e.details)].filter(Boolean);
  const k = claves.find((x) => CAMPOS[x]);
  if (!k) return null;
  return { paso: CAMPOS[k].paso, control: CAMPOS[k].control(), texto: CAMPOS[k].texto };
}

// ── Guardar y publicar ──
async function guardar(publicar) {
  for (let i = 0; i < 3; i++) {
    const fallo = validar(i);
    if (fallo) { paso = i; pintar(true); error(fallo.texto, fallo.campo); return; }
  }
  const btns = [...botones.querySelectorAll("button")];
  btns.forEach((b) => { b.disabled = true; });
  const datos = {
    type_id: f.type_id, title: f.title.trim(), description: f.description.trim(),
    due_date: f.due_date, priority: f.priority, reviewer_id: f.reviewer_id,
    // Solo en "Actualizar programa"; en otro tipo se envían vacíos (por si el borrador los tenía).
    course_id: esPrograma() ? f.course_id : null,
    period_id: esPrograma() ? f.period_id : null,
  };
  const regla = f.modo === "all" ? { mode: "all" }
    : f.modo === "filter" ? { mode: "filter", [f.filtro.startsWith("unit:") ? "unit" : "campus"]: f.filtro.split(":").slice(1).join(":") }
    : { mode: "users", user_ids: [...f.user_ids] };        // «Por curso» también se guarda así
  try {
    if (tareaId) await api(`/tasks/${tareaId}`, { method: "PATCH", body: datos });
    else tareaId = (await api("/tasks", { method: "POST", body: datos })).id;
    const r = await api(`/tasks/${tareaId}/recipients`, { method: "POST", body: regla });
    if (!publicar) {
      guardarAviso({ tipo: "ok", texto: `Borrador guardado. Lo recibirán ${r.eligible_count} ${r.eligible_count === 1 ? "docente" : "docentes"} cuando lo publiques.` });
    } else {
      const p = await api(`/tasks/${tareaId}/publish`, { method: "POST" });
      guardarAviso({ tipo: "ok", texto: `Tarea publicada: ${p.assignments_created} ${p.assignments_created === 1 ? "docente recibió" : "docentes recibieron"} su aviso.` });
    }
    location.assign(`/app/tarea.html?id=${tareaId}`);
  } catch (e) {
    btns.forEach((b) => { b.disabled = false; });
    const campo = errorDeCampo(e);
    let texto = campo ? campo.texto : e.message;
    if (tareaId) texto += " La tarea quedó guardada como borrador; puedes intentarlo otra vez.";
    if (campo) { paso = campo.paso; pintar(true); }
    error(texto, campo?.control);
  }
}
