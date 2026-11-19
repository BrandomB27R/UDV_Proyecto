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
  modo: "users", user_ids: new Set(), filtro: "",          // filtro: "campus:<nombre>" | "unit:<nombre>"
  // Por defecto revisa quien crea la tarea, si tiene el rol de revisión; si no, sin revisor designado.
  reviewer_id: (yo.roles || []).includes("reviewer") ? yo.id : null,
  course_id: null, period_id: null,                         // obligatorios si el tipo es "Actualizar programa"
};
// Docentes que dan el curso en el período (GET /tasks/eligible-teachers), por "curso:período".
const sugeridos = { clave: null, ids: new Set(), aplicadosA: null, error: null };
let paso = 0;
let tareaId = idBorrador && /^\d+$/.test(idBorrador) ? Number(idBorrador) : null;
let buscarDocente = "";

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

/** Pide los docentes del curso en el período y, la primera vez, los propone como destinatarios. */
async function cargarSugeridos() {
  if (!esPrograma() || !f.course_id) return;
  const clave = `${f.course_id}:${f.period_id ?? ""}`;
  if (sugeridos.clave !== clave) {
    try {
      const q = `course_id=${encodeURIComponent(f.course_id)}${f.period_id ? `&period_id=${encodeURIComponent(f.period_id)}` : ""}`;
      const r = await api(`/tasks/eligible-teachers?${q}`);
      sugeridos.ids = new Set((r.data || []).map((x) => x.id));
      sugeridos.error = null;
    } catch (e) {
      sugeridos.ids = new Set();
      sugeridos.error = e.message;
    }
    sugeridos.clave = clave;
  }
  if (sugeridos.aplicadosA !== clave && sugeridos.ids.size) {
    f.modo = "users";
    f.user_ids = new Set(sugeridos.ids);
    sugeridos.aplicadosA = clave;
  }
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
  // Los destinatarios guardados del borrador mandan: no se reemplazan por los sugeridos.
  if (t.course_id) sugeridos.aplicadosA = `${t.course_id}:${t.period_id ?? ""}`;
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
  if (paso === 0) await cargarSugeridos();
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
    if (f.modo === "users" && !f.user_ids.size) return { texto: "Elige al menos un docente.", campo: "buscar-docente" };
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
  const lista = h("div");
  const modo = (valor, titulo, detalle) => h("label", { class: "v-opcion" },
    h("input", { type: "radio", name: "modo", value: valor, checked: f.modo === valor,
      onchange: () => { f.modo = valor; pintarModo(); } }),
    h("span", { class: "v-opcion__txt" }, h("strong", {}, titulo), h("span", {}, detalle)));

  function pintarModo() {
    if (f.modo === "all") {
      poner(lista, h("p", { class: "v-nota" }, `La recibirán los ${docentes.length} docentes activos.`));
    } else if (f.modo === "filter") {
      poner(lista, h("div", { class: "v-campo" },
        h("label", { for: "filtro" }, "Sede o unidad académica"),
        h("select", { id: "filtro", onchange: (e) => { f.filtro = e.target.value; e.target.removeAttribute("aria-invalid"); } },
          h("option", { value: "" }, "Elige una opción"),
          h("optgroup", { label: "Sedes" }, sedes.map((s) => h("option", { value: `campus:${s.name}`, selected: f.filtro === `campus:${s.name}` }, s.name))),
          h("optgroup", { label: "Unidades académicas" }, unidades.map((u) => h("option", { value: `unit:${u.name}`, selected: f.filtro === `unit:${u.name}` }, u.name)))),
        h("span", { class: "v-campo__ayuda" }, "La reciben los docentes activos de esa sede o unidad al momento de publicar.")));
    } else {
      pintarDocentes();
    }
  }

  function pintarDocentes() {
    const contador = h("p", { class: "v-nota", "aria-live": "polite" });
    const casillas = h("div");
    const actualizar = () => { contador.textContent = `${f.user_ids.size} ${f.user_ids.size === 1 ? "docente elegido" : "docentes elegidos"}`; };
    const visibles = () => docentes.filter((u) => !buscarDocente || `${nombreCompleto(u)} ${u.correo}`.toLowerCase().includes(buscarDocente));
    const pintarCasillas = () => {
      const v = visibles();
      poner(casillas, v.length ? h("div", { class: "v-checks" }, v.map((u) => h("label", { class: "v-check" },
        h("input", { type: "checkbox", value: String(u.id), checked: f.user_ids.has(u.id), onchange: (e) => {
          if (e.target.checked) f.user_ids.add(u.id); else f.user_ids.delete(u.id);
          actualizar();
        } }),
        h("span", {}, h("strong", {}, nombreCompleto(u)), h("small", {}, u.correo),
          sugeridos.ids.has(u.id) && esPrograma() ? h("em", { class: "v-check__marca" }, "Da el curso") : null))))
        : h("p", { class: "v-nota" }, "Ningún docente coincide con la búsqueda."));
      actualizar();
    };
    const buscar = h("input", { id: "buscar-docente", type: "search", placeholder: "Buscar por nombre o correo", value: buscarDocente, autocomplete: "off",
      oninput: (e) => { buscarDocente = e.target.value.trim().toLowerCase(); e.target.removeAttribute("aria-invalid"); pintarCasillas(); } });
    poner(lista, h("div", { class: "v-destinatarios" },
      h("div", { class: "v-campo" }, h("label", { for: "buscar-docente" }, "Docentes"), buscar),
      h("div", { class: "v-acciones v-acciones--lista" },
        h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { visibles().forEach((u) => f.user_ids.add(u.id)); pintarCasillas(); } }, "Elegir todos los de la lista"),
        h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: () => { f.user_ids.clear(); pintarCasillas(); } }, "Quitar todos"),
        contador),
      casillas));
    pintarCasillas();
  }

  pintarModo();
  let avisoSugeridos = null;
  if (esPrograma() && f.course_id) {
    const donde = `${nombreCurso(f.course_id)}${f.period_id ? ` en ${nombrePeriodo(f.period_id)}` : ""}`;
    avisoSugeridos = sugeridos.error ? mensaje("aviso", `No se pudieron consultar los docentes del curso: ${sugeridos.error}`)
      : sugeridos.ids.size ? mensaje("info", `Propuestos: ${sugeridos.ids.size} ${sugeridos.ids.size === 1 ? "docente que da" : "docentes que dan"} ${donde}. Están marcados con «Da el curso»; puedes cambiarlos.`)
      : mensaje("aviso", `Nadie tiene asignado ${donde}. Elige a los docentes a mano.`);
  }
  return [
    avisoSugeridos,
    h("fieldset", { class: "v-grupo" },
      h("legend", { class: "v-campo__etq" }, "¿A quién va dirigida?"),
      h("div", { class: "v-opciones" },
        modo("users", "Docentes que elijo", "Marca uno o varios docentes."),
        modo("all", "Todos los docentes", "Todos los docentes activos."),
        modo("filter", "Por sede o unidad", "Los docentes de una sede o unidad académica."))),
    lista,
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
  return n.length ? n.join(", ") : "Sin elegir";
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
    : { mode: "users", user_ids: [...f.user_ids] };
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
