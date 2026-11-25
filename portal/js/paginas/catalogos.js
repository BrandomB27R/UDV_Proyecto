// Catálogos: las listas que usa todo el sistema. Misma estructura que la pantalla del G6
// (/app/g6/catalogos.html) con el estilo de Vinci. API del G6: GET y POST /<recurso>,
// PATCH /<recurso>/{id}; para las unidades académicas, GET /faculties y GET /campuses.
// «Tipos de tarea» es del G3 (GET /task-types?include_inactive=true, POST, PATCH /task-types/{id}).
// «Usuarios» es del G2 (GET /users, GET /roles, POST /users, PATCH /users/{id}).
// Administración ve todas las pestañas; coordinación, solo «Tipos de tarea».
//
// Claves (Usuarios): solo viven en su campo mientras se escribe. Viajan en el cuerpo de una sola
// llamada, el campo se vacía al terminar (con éxito o error) y nunca se muestran, guardan ni registran.
// Las reglas (obligatorios, rangos, código repetido) las decide el servidor: aquí solo se muestran
// sus errores junto al campo (422) o como aviso (409).
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { formaDeEntrega, ROLES, legible } from "../formato.js";
import { sinAcceso, todasLasPaginas, vacio } from "../componentes.js";
import { requerirSesion, tieneRol } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "catalogos");
tituloPestana("Catálogos");

const SIN_PERMISO = "Los catálogos los administra el rol de administración; los tipos de tarea, también coordinación.";
const esAdmin = tieneRol(yo, "admin");
if (!esAdmin && !tieneRol(yo, "coordinator")) await sinAcceso(raiz, "Catálogos", SIN_PERMISO);

const POR_PAGINA = 20;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const fecha = (v) => { const [y, m, d] = String(v || "").split("-").map(Number); return y ? `${d} ${MESES[m - 1]} ${y}` : "—"; };

// Facultades y sedes, para las listas y las columnas de «Unidades académicas» (se cargan al abrir la pestaña).
// Roles, para las casillas de «Usuarios».
const ref = { facultades: null, sedes: null, roles: null };
// Orden de las casillas de roles; un rol activo que no esté aquí va al final.
const ORDEN_ROLES = ["teacher", "coordinator", "reviewer", "authority", "auditor", "admin"];
const nombreRol = (codigo) => ROLES[codigo] || legible(codigo);
const nombresDeRoles = (roles) => ((roles || []).length
  ? [...roles].sort((a, b) => ordenRol(a) - ordenRol(b)).map(nombreRol).join(" · ") : "Sin roles");
const ordenRol = (c) => { const i = ORDEN_ROLES.indexOf(c); return i < 0 ? 99 : i; };
const nombreDe = (lista, id) => (lista || []).find((x) => Number(x.id) === Number(id))?.name || "—";

// Campos del formulario: los del G6 (catalogos.py). tipo: texto, numero, fecha o lista.
const CODIGO = { id: "code", etiqueta: "Código", tipo: "texto" };
const NOMBRE = (ejemplo) => ({ id: "name", etiqueta: "Nombre", tipo: "texto", ejemplo });
const col = (titulo, valor, clase, fuerte = false) => ({ titulo, valor, clase, fuerte });
const COL_CODIGO = col("Código", (r) => r.code, "ct-codigo");
const COL_NOMBRE = col("Nombre", (r) => r.name, null, true);
const sinTildes = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const CATALOGOS = [
  { id: "cursos", recurso: "courses", titulo: "Cursos", singular: "curso", guardado: "Curso guardado.",
    columnas: [COL_CODIGO, COL_NOMBRE, col("Créditos", (r) => r.credits)],
    campos: [{ ...CODIGO, ejemplo: "ISW-302" }, NOMBRE("Programación Web II"), { id: "credits", etiqueta: "Créditos", tipo: "numero" }] },
  // Del G3. Sin código ni búsqueda en el servidor: se piden todos (activos e inactivos) y se filtran aquí.
  // La forma de entrega se cambia mientras ninguna tarea use el tipo (task_count 0, vinci-16); si no,
  // o si es «programa» o «formulario», se muestra deshabilitada con el porqué.
  { id: "tipos", recurso: "task-types", titulo: "Tipos de tarea", singular: "tipo de tarea", guardado: "Tipo de tarea guardado.",
    g3: true, campoActivo: "active", activoAlAgregar: false, buscar: "Nombre o descripción",
    nota: "Un tipo inactivo deja de ofrecerse en Nueva tarea. Las tareas que ya lo usan siguen su curso.",
    normalizar: (r) => ({ ...r, is_active: !!r.active }),
    columnas: [
      col("Nombre", (r) => h("div", { class: "pn-tarea" }, h("strong", {}, r.name), r.description ? h("span", {}, r.description) : null)),
      col("Cómo se entrega", (r) => formaDeEntrega(r.delivery_mode, r.requires_evidence)),
      col("Tareas", (r) => (r.task_count == null ? "—" : Number(r.task_count)), "ct-numero")],
    campos: [
      { id: "name", etiqueta: "Nombre", tipo: "texto", ejemplo: "Informe de tutorías" },
      { id: "delivery", etiqueta: "Cómo se entrega", tipo: "opciones", inicial: "ambos",
        valores: [["texto", "Solo texto"], ["ambos", "Texto y archivo opcional"], ["archivo", "Archivo obligatorio"]],
        valorDe: claveDeEntrega,
        // «programa» y «formulario» (tipos de la semilla del G1) tienen forma de entrega propia: siempre fija.
        bloqueo: (r) => (r.delivery_mode === "programa" ? "Es el programa de curso; la forma de entrega no se cambia."
          : r.delivery_mode === "formulario" ? "Es un formulario propio de este tipo; la forma de entrega no se cambia."
          : Number(r.task_count) > 0 ? `Ya la ${Number(r.task_count) === 1 ? "usa 1 tarea" : `usan ${Number(r.task_count)} tareas`}; la forma de entrega no se cambia.` : null) },
      { id: "description", etiqueta: "Descripción (opcional)", tipo: "area" }] },
  { id: "periodos", recurso: "periods", titulo: "Períodos", singular: "período", guardado: "Período guardado.",
    columnas: [COL_CODIGO, col("Período", (r) => r.name, null, true), col("Fechas", (r) => `${fecha(r.start_date)} – ${fecha(r.end_date)}`)],
    campos: [{ ...CODIGO, ejemplo: "2027-2" }, { id: "year", etiqueta: "Año", tipo: "numero" }, { id: "cycle", etiqueta: "Ciclo", tipo: "numero" },
      { id: "start_date", etiqueta: "Fecha de inicio", tipo: "fecha" }, { id: "end_date", etiqueta: "Fecha de fin", tipo: "fecha" }] },
  { id: "sedes", recurso: "campuses", titulo: "Sedes", singular: "sede", guardado: "Sede guardada.",
    columnas: [COL_CODIGO, COL_NOMBRE, col("Dirección", (r) => r.address || "—")],
    campos: [{ ...CODIGO, ejemplo: "S-NOR" }, NOMBRE("Sede Norte"), { id: "address", etiqueta: "Dirección (opcional)", tipo: "texto", opcional: true }] },
  { id: "modalidades", recurso: "modalities", titulo: "Modalidades", singular: "modalidad", guardado: "Modalidad guardada.",
    columnas: [COL_CODIGO, COL_NOMBRE],
    campos: [{ ...CODIGO, ejemplo: "SEMI" }, NOMBRE("Semipresencial")] },
  { id: "areas", recurso: "areas", titulo: "Áreas", singular: "área", guardado: "Área guardada.",
    columnas: [COL_CODIGO, COL_NOMBRE],
    campos: [{ ...CODIGO, ejemplo: "ADM" }, NOMBRE("Administración")] },
  { id: "unidades", recurso: "academic-units", titulo: "Unidades académicas", singular: "unidad académica", guardado: "Unidad académica guardada.",
    referencias: true,
    columnas: [COL_CODIGO, COL_NOMBRE, col("Facultad", (r) => nombreDe(ref.facultades, r.faculty_id)), col("Sede", (r) => nombreDe(ref.sedes, r.campus_id))],
    campos: [{ ...CODIGO, ejemplo: "UA-ING-N" }, NOMBRE("Ingeniería en Sistemas - Sede Norte"),
      { id: "faculty_id", etiqueta: "Facultad", tipo: "lista", opciones: () => ref.facultades, femenino: true },
      { id: "campus_id", etiqueta: "Sede", tipo: "lista", opciones: () => ref.sedes, femenino: true }] },
  // Del G2. Sin búsqueda ni filtros en el servidor: se piden todos (activos e inactivos) y se filtran aquí.
  { id: "usuarios", recurso: "users", titulo: "Usuarios", singular: "usuario", guardado: "Usuario guardado.",
    usuarios: true, campoActivo: "activo", buscar: "Nombre o correo", nota: null,
    notaActivo: "Una cuenta inactiva no puede entrar y se cierran sus sesiones.",
    normalizar: (r) => ({ ...r, is_active: !!r.activo, name: [r.nombres, r.apellidos].filter(Boolean).join(" ") }),
    columnas: [
      col("Nombre", (r) => h("div", { class: "pn-tarea" }, h("strong", {}, r.name), h("span", {}, r.correo))),
      col("Roles", (r) => nombresDeRoles(r.roles))],
    campos: [
      { id: "nombres", etiqueta: "Nombres", tipo: "texto" },
      { id: "apellidos", etiqueta: "Apellidos", tipo: "texto" },
      { id: "correo", etiqueta: "Correo", tipo: "correo" },
      { id: "roles", etiqueta: "Roles", tipo: "casillas", ayuda: "Elige al menos uno." },
      { id: "password", etiqueta: "Clave inicial", tipo: "clave", soloAlAgregar: true,
        nota: "Mínimo 8 caracteres. Entrégasela a la persona por un medio seguro." }] },
];

/** La opción de «Cómo se entrega» que corresponde a un tipo (igual que formaDeEntrega). */
function claveDeEntrega(r) {
  if (r.delivery_mode === "programa") return "programa";
  if (r.requires_evidence || r.delivery_mode === "archivo") return "archivo";
  if (r.delivery_mode === "texto" || r.delivery_mode === "formulario") return "texto";
  return "ambos";
}

// ── Estado ───────────────────────────────────────────────────
const VISIBLES = esAdmin ? CATALOGOS : CATALOGOS.filter((c) => c.id === "tipos");
const deHash = () => VISIBLES.find((c) => `#${c.id}` === location.hash) || VISIBLES[0];
const st = { cat: deHash(), q: "", page: 1, editando: null, guardando: false, solicitud: 0 };

const zonaPestanas = h("div", { class: "pn-filtros", role: "group", "aria-label": "Catálogo" });
const buscador = h("input", { id: "ct-buscar", type: "search", placeholder: "Código o nombre", autocomplete: "off" });
const zonaLista = h("div", { "aria-live": "polite" });
const zonaFormulario = h("aside", { class: "v-card ct-form", "aria-labelledby": "ct-titulo-form" });

let espera;
buscador.addEventListener("input", () => {
  clearTimeout(espera);
  espera = setTimeout(() => { st.q = buscador.value.trim(); st.page = 1; cargarLista(); }, 300);
});

poner(raiz,
  h("div", { class: "v-cabecera", style: "gap: 6px" },
    h("h1", { class: "v-h1" }, "Catálogos"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, "Las listas que usa todo el sistema al crear tareas y programas de curso.")),
  zonaPestanas,
  h("div", { class: "ct-cuerpo" },
    h("section", { class: "v-card ct-lista", "aria-label": "Registros del catálogo" },
      h("div", { class: "v-campo ct-buscar" }, h("label", { for: "ct-buscar" }, "Buscar"), buscador),
      zonaLista),
    zonaFormulario));

function pintarPestanas() {
  // Con una sola pestaña (coordinación) no hay entre qué elegir: se muestra su nombre como título.
  if (VISIBLES.length === 1) { poner(zonaPestanas, h("h2", { class: "v-h2" }, VISIBLES[0].titulo)); return; }
  poner(zonaPestanas, VISIBLES.map((c) => h("button", {
    type: "button", class: "pn-filtro", "aria-pressed": String(c === st.cat),
    onclick: () => abrir(c, true),
  }, c.titulo)));
}

async function abrir(c, guardarHash) {
  st.cat = c; st.q = ""; st.page = 1; st.editando = null;
  buscador.value = "";
  buscador.placeholder = c.buscar || "Código o nombre";
  if (guardarHash) history.replaceState(null, "", `#${c.id}`);
  pintarPestanas();
  poner(zonaLista, h("p", { class: "v-nota" }, "Cargando…"));
  if (c.referencias || c.usuarios) {
    try { await (c.usuarios ? cargarRoles() : cargarReferencias()); } catch (e) { poner(zonaLista, mensaje("error", e.message)); return; }
    if (st.cat !== c) return;
  }
  pintarFormulario();
  cargarLista();
}

/** Todos los roles de GET /roles, en el orden de las casillas (se ofrecen los activos; ver control). */
async function cargarRoles() {
  if (ref.roles) return;
  const r = await api("/roles");
  ref.roles = (Array.isArray(r) ? r : r?.data || []).sort((a, b) => ordenRol(a.codigo) - ordenRol(b.codigo));
}

async function cargarReferencias(forzar = false) {
  const [f, s] = await Promise.all([
    ref.facultades && !forzar ? ref.facultades : api("/faculties"),
    ref.sedes && !forzar ? { data: ref.sedes } : todasLasPaginas(api, "/campuses"),
  ]);
  ref.facultades = Array.isArray(f) ? f : f?.data || [];
  ref.sedes = s.data || [];
}

// ── Lista ────────────────────────────────────────────────────
async function cargarLista() {
  const n = ++st.solicitud;
  const c = st.cat;
  const p = new URLSearchParams({ page: String(st.page), per_page: String(POR_PAGINA) });
  if (st.q) p.set("q", st.q);
  try {
    const r = c.g3 ? await listaG3(c) : c.usuarios ? await listaUsuarios() : await api(`/${c.recurso}?${p}`);
    if (c.normalizar) r.data = (r.data || []).map(c.normalizar);
    if (n !== st.solicitud) return;
    const paginas = Math.max(1, Math.ceil((Number(r.total) || 0) / POR_PAGINA));
    if (st.page > paginas) { st.page = paginas; cargarLista(); return; }
    pintarLista(r.data || [], Number(r.total) || 0, paginas);
  } catch (e) {
    if (n === st.solicitud) poner(zonaLista, mensaje("error", e.message));
  }
}

/** El G3 no busca ni pagina con filtro: se trae todo y se filtra y pagina aquí. */
async function listaG3(c) {
  const r = await todasLasPaginas(api, `/${c.recurso}?include_inactive=true`);
  const q = sinTildes(st.q);
  const todos = (r.data || []).filter((x) => !q || sinTildes(`${x.name} ${x.description || ""}`).includes(q))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  return { total: todos.length, data: todos.slice((st.page - 1) * POR_PAGINA, st.page * POR_PAGINA) };
}

/** El G2 tampoco busca: se traen todas las cuentas y se filtra por nombre o correo aquí. */
async function listaUsuarios() {
  const r = await todasLasPaginas(api, "/users");
  const q = sinTildes(st.q);
  const nombre = (x) => `${x.nombres || ""} ${x.apellidos || ""}`;
  const todos = (r.data || []).filter((x) => !q || sinTildes(`${nombre(x)} ${x.correo || ""}`).includes(q))
    .sort((a, b) => nombre(a).localeCompare(nombre(b), "es"));
  return { total: todos.length, data: todos.slice((st.page - 1) * POR_PAGINA, st.page * POR_PAGINA) };
}

function pintarLista(filas, total, paginas) {
  const c = st.cat;
  if (!filas.length) {
    poner(zonaLista, vacio(st.q ? `Ningún registro coincide con «${st.q}».` : `Todavía no hay registros en ${c.titulo.toLowerCase()}. Agrega el primero con el formulario.`));
    return;
  }
  poner(zonaLista,
    h("p", { class: "au-resumen" }, h("strong", {}, String(total)), total === 1 ? " registro" : " registros"),
    h("table", { class: "pn-tabla ct-tabla" },
      h("caption", { class: "v-sr" }, c.titulo),
      h("thead", {}, h("tr", {}, c.columnas.map((x) => h("th", { scope: "col" }, x.titulo)), h("th", { scope: "col" }, "Estado"),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map((r) => h("tr", { class: `pn-fila${st.editando?.id === r.id ? " ct-fila--editando" : ""}` },
        c.columnas.map((x) => { const v = x.valor(r); return h("td", { "data-etiqueta": x.titulo, class: x.clase || null },
          v instanceof Node ? v : x.fuerte ? h("strong", {}, String(v ?? "—")) : String(v ?? "—")); }),
        h("td", { "data-etiqueta": "Estado" }, chipActivo(r.is_active)),
        h("td", { class: "pn-accion" }, h("button", { type: "button", class: "v-enlace ct-editar", "aria-label": `Editar ${r.code || r.name}`, onclick: () => editar(r) }, "Editar")))))),
    paginas > 1 ? h("nav", { class: "au-paginas", "aria-label": "Páginas" },
      h("span", {}, `Página ${st.page} de ${paginas}`),
      h("div", { class: "au-paginas__botones" },
        h("button", { type: "button", class: "v-enlace", disabled: st.page <= 1, onclick: () => { st.page -= 1; cargarLista(); } }, "← Anterior"),
        h("button", { type: "button", class: "v-enlace", disabled: st.page >= paginas, onclick: () => { st.page += 1; cargarLista(); } }, "Siguiente →"))) : null);
}

const chipActivo = (activo) => h("span", { class: `v-chip ${activo ? "v-chip--approved" : "v-chip--reemplazada"}` }, activo ? "Activo" : "Inactivo");

// ── Formulario (agregar o editar en la misma tarjeta) ────────
let controles = {};
let zonaAviso = null;

function editar(r) {
  st.editando = r;
  pintarFormulario();
  cargarLista();
  zonaFormulario.scrollIntoView({ block: "start", behavior: "smooth" });
  controles[st.cat.campos[0].id]?.input.focus({ preventScroll: true });
}

function cancelar() {
  st.editando = null;
  pintarFormulario();
  cargarLista();
}

/**
 * Campo de clave: type=password, autocomplete=new-password (el navegador no rellena la del admin) y
 * «Mostrar». vaciar() lo deja en blanco y oculto; se llama al terminar cada llamada.
 */
function campoClave(id, etiqueta, nota) {
  const error = h("span", { class: "v-campo__error", id: `${id}-error`, hidden: true });
  const input = h("input", { id, type: "password", autocomplete: "new-password", spellcheck: "false",
    "aria-describedby": nota ? `${id}-nota` : null });
  const ver = h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico ct-ver", "aria-controls": id }, "Mostrar");
  ver.addEventListener("click", () => {
    const mostrar = input.type === "password";
    input.type = mostrar ? "text" : "password";
    ver.textContent = mostrar ? "Ocultar" : "Mostrar";
  });
  const vaciar = () => { input.value = ""; input.type = "password"; ver.textContent = "Mostrar"; };
  const nodo = h("div", { class: "v-campo" }, h("label", { for: id }, etiqueta),
    h("div", { class: "ct-clave" }, input, ver),
    nota ? h("span", { class: "v-nota", id: `${id}-nota` }, nota) : null, error);
  return { nodo, input, error, vaciar };
}

function control(campo, valor, bloqueo = null) {
  const id = `ct-${campo.id}`;
  if (campo.tipo === "clave") {
    const cl = campoClave(id, campo.etiqueta, campo.nota);
    cl.input.addEventListener("input", () => limpiarError(campo.id));
    controles[campo.id] = { input: cl.input, error: cl.error, campo, vaciar: cl.vaciar };
    return cl.nodo;
  }
  if (campo.tipo === "casillas") {
    const error = h("span", { class: "v-campo__error", id: `${id}-error`, hidden: true });
    const marcados = new Set(valor || []);
    // Se ofrecen los roles activos; uno inactivo que el usuario ya tiene también sale (marcado), para no
    // quitárselo sin querer al guardar. Un código que ni siquiera está en /roles también se conserva.
    const conocidos = new Set((ref.roles || []).map((r) => r.codigo));
    const ofrecidos = [...(ref.roles || []).filter((r) => r.activo !== false || marcados.has(r.codigo)),
      ...[...marcados].filter((c) => !conocidos.has(c)).map((c) => ({ codigo: c, activo: false }))];
    const casillas = ofrecidos.map((r) => h("input", { type: "checkbox", value: r.codigo, checked: marcados.has(r.codigo) }));
    casillas.forEach((x) => x.addEventListener("change", () => limpiarError(campo.id)));
    const grupo = h("fieldset", { class: "v-grupo ct-roles", id, "aria-describedby": `${id}-ayuda ${id}-error` },
      h("legend", {}, campo.etiqueta),
      h("span", { class: "v-nota", id: `${id}-ayuda` }, campo.ayuda),
      h("div", { class: "ct-roles__lista" }, casillas.map((x, i) => h("label", { class: "v-check" }, x,
        h("span", {}, h("strong", {}, nombreRol(ofrecidos[i].codigo)),
          ofrecidos[i].activo === false ? h("small", {}, "Rol inactivo") : null)))),
      error);
    controles[campo.id] = { input: casillas[0] || grupo, grupo, casillas, error, campo };
    return grupo;
  }
  const error = h("span", { class: "v-campo__error", id: `${id}-error`, hidden: true });
  let input;
  if (campo.tipo === "correo") {
    input = h("input", { id, name: campo.id, type: "email", value: valor == null ? "" : String(valor), autocomplete: "off", spellcheck: "false" });
  } else if (campo.tipo === "opciones") {
    // Un valor que no está entre las opciones (el programa de curso) se agrega para mostrarlo.
    const valores = campo.valores.some(([v]) => v === valor) || valor == null ? campo.valores : [...campo.valores, [valor, "Programa de curso"]];
    input = h("select", { id, name: campo.id, disabled: !!bloqueo, "aria-describedby": bloqueo ? `${id}-bloqueo` : null },
      valores.map(([v, t]) => h("option", { value: v, selected: v === (valor ?? campo.inicial) }, t)));
  } else if (campo.tipo === "area") {
    input = h("textarea", { id, name: campo.id, rows: 3, value: valor == null ? "" : String(valor) });
  } else if (campo.tipo === "lista") {
    // Se ofrecen los activos; si el registro ya usa uno inactivo, también aparece, marcado.
    const opciones = (campo.opciones() || []).filter((o) => o.is_active || Number(o.id) === Number(valor));
    input = h("select", { id, name: campo.id },
      h("option", { value: "" }, campo.femenino ? "Elige una…" : "Elige uno…"),
      opciones.map((o) => h("option", { value: String(o.id), selected: Number(o.id) === Number(valor) }, `${o.name}${o.is_active ? "" : " (inactiva)"}`)));
  } else {
    input = h("input", {
      id, name: campo.id, type: campo.tipo === "numero" ? "number" : campo.tipo === "fecha" ? "date" : "text",
      value: valor == null ? "" : String(valor), placeholder: campo.ejemplo ? `Ej.: ${campo.ejemplo}` : null, autocomplete: "off",
      inputmode: campo.tipo === "numero" ? "numeric" : null,
    });
  }
  input.addEventListener("input", () => limpiarError(campo.id));
  // Un campo bloqueado no viaja al guardar.
  if (!bloqueo) controles[campo.id] = { input, error, campo };
  return h("div", { class: "v-campo" }, h("label", { for: id }, campo.etiqueta), input,
    bloqueo ? h("span", { class: "v-nota", id: `${id}-bloqueo` }, bloqueo) : null, error);
}

function pintarFormulario() {
  const c = st.cat;
  const r = st.editando;
  controles = {};
  zonaAviso = h("div", { "aria-live": "polite" });
  const activo = h("input", { id: "ct-activo", type: "checkbox", checked: r ? !!r.is_active : true });
  const conActivo = !!r || c.activoAlAgregar !== false;
  const boton = h("button", { type: "submit", class: "v-btn" }, r ? "Guardar cambios" : `Agregar ${c.singular}`);
  const nota = c.nota === null ? null : c.nota || "Un registro inactivo deja de ofrecerse al crear tareas y programas.";
  // method=post: si el formulario llegara a enviarse sin JavaScript, nada viaja en la URL.
  const form = h("form", { class: "ct-campos", novalidate: true, method: "post", autocomplete: "off" },
    c.campos.filter((campo) => !(r && campo.soloAlAgregar))
      .map((campo) => control(campo, r ? (campo.valorDe ? campo.valorDe(r) : r[campo.id]) : null, r && campo.bloqueo ? campo.bloqueo(r) : null)),
    conActivo ? h("label", { class: "ct-casilla", for: "ct-activo" }, activo, h("span", {}, "Activo")) : null,
    conActivo && r && c.notaActivo ? h("p", { class: "v-nota ct-nota-activo" }, c.notaActivo) : null,
    zonaAviso,
    h("div", { class: "v-acciones" }, boton,
      r ? h("button", { type: "button", class: "v-btn v-btn--sec", onclick: cancelar }, "Cancelar") : null),
    nota ? h("p", { class: "v-nota" }, nota) : null);
  form.addEventListener("submit", (e) => { e.preventDefault(); guardar(boton, conActivo ? activo : null); });
  poner(zonaFormulario,
    h("h2", { id: "ct-titulo-form", class: "v-h2" }, r ? `Editar ${c.singular}` : `Agregar ${c.singular}`),
    r ? h("p", { class: "v-nota" }, "Cambias ", h("strong", {}, r.code && !c.g3 ? `${r.code} · ${r.name}` : r.name), ".") : null,
    form,
    r && c.usuarios ? bloqueRestablecer(r) : null);
}

/** «Restablecer clave»: cerrado por defecto y aparte del formulario; un PATCH propio solo con password. */
function bloqueRestablecer(r) {
  const cl = campoClave("ct-clave-nueva", "Clave nueva", "Mínimo 8 caracteres. Entrégasela a la persona por un medio seguro.");
  const aviso = h("div", { "aria-live": "polite" });
  const boton = h("button", { type: "button", class: "v-btn v-btn--sec" }, "Restablecer clave");
  const notaId = cl.input.getAttribute("aria-describedby") || "";
  const limpiar = () => {
    cl.error.hidden = true; cl.error.textContent = "";
    cl.input.removeAttribute("aria-invalid");
    if (notaId) cl.input.setAttribute("aria-describedby", notaId); else cl.input.removeAttribute("aria-describedby");
    poner(aviso);
  };
  cl.input.addEventListener("input", limpiar);
  boton.addEventListener("click", async () => {
    if (boton.disabled) return;
    limpiar();
    boton.disabled = true;
    try {
      await api(`/users/${encodeURIComponent(r.id)}`, { method: "PATCH", body: { password: cl.input.value } });
      poner(aviso, mensaje("ok", "Clave restablecida. Se cerraron las sesiones abiertas de esta persona."));
    } catch (e) {
      const deLaClave = erroresPorCampo(e).find((x) => x.campo === "password");
      if (deLaClave) {
        cl.error.textContent = deLaClave.texto; cl.error.hidden = false;
        cl.input.setAttribute("aria-invalid", "true");
        cl.input.setAttribute("aria-describedby", [notaId, cl.error.id].filter(Boolean).join(" "));
      }
      // El aviso dice qué falló (el texto del campo), no solo «Datos de entrada inválidos.».
      poner(aviso, mensaje(e.status === 409 ? "aviso" : "error", deLaClave ? `${e.message} ${deLaClave.texto}` : e.message));
    } finally {
      cl.vaciar();          // con éxito o con error, la clave no se queda en el campo
      boton.disabled = false;
      if (cl.input.getAttribute("aria-invalid") === "true") cl.input.focus();
    }
  });
  return h("details", { class: "ct-reset" },
    h("summary", {}, "Restablecer clave"),
    h("div", { class: "ct-reset__cuerpo" },
      cl.nodo,
      h("p", { class: "v-nota" }, "Al restablecerla se cierran las sesiones abiertas de esta persona."),
      aviso,
      h("div", { class: "v-acciones" }, boton)));
}

/** Valor tal como lo espera el G6: número entero, fecha AAAA-MM-DD o texto. Vacío viaja como null. */
function leer(campo) {
  const ct = controles[campo.id];
  if (campo.tipo === "casillas") return ct.casillas.filter((x) => x.checked).map((x) => x.value);
  if (campo.tipo === "clave") return ct.input.value;   // tal cual: los espacios cuentan
  const v = ct.input.value;
  if (campo.tipo === "area") return v.trim();   // vacío: se borra la descripción
  if (v.trim() === "") return campo.tipo === "texto" && !campo.opcional ? "" : null;
  if (campo.tipo === "numero" || campo.tipo === "lista") return Number(v);
  return v;
}

async function guardar(boton, activo) {
  if (st.guardando) return;
  const c = st.cat;
  const r = st.editando;
  limpiarErrores();
  const campos = c.campos.filter((campo) => controles[campo.id]);
  const datos = Object.fromEntries(campos.map((campo) => [campo.id, leer(campo)]));
  // «Al menos un rol» (regla del PM para la pantalla): sin roles no se llama al servidor.
  const sinRoles = campos.find((campo) => campo.tipo === "casillas" && !datos[campo.id].length);
  if (sinRoles) {
    const casilla = marcarError(sinRoles.id, "Elige al menos un rol.");
    poner(zonaAviso, mensaje("error", "Elige al menos un rol."));
    casilla?.focus();
    return;
  }
  const campoActivo = c.campoActivo || "is_active";
  if (activo) datos[campoActivo] = activo.checked;
  // Al editar viaja solo lo que cambió (así la auditoría registra el cambio real).
  const valorAntes = (k) => { const campo = c.campos.find((x) => x.id === k); return campo?.valorDe ? campo.valorDe(r) : r[k]; };
  const antes = (k) => (k === campoActivo ? r.is_active : valorAntes(k));
  const cuerpo = r ? Object.fromEntries(Object.entries(datos).filter(([k, v]) => !igual(v, antes(k)))) : datos;
  if (r && !Object.keys(cuerpo).length) { poner(zonaAviso, mensaje("info", "No cambiaste nada.")); return; }
  st.guardando = true; boton.disabled = true;
  try {
    await api(r ? `/${c.recurso}/${encodeURIComponent(r.id)}` : `/${c.recurso}`, { method: r ? "PATCH" : "POST", body: cuerpo });
    const texto = r ? "Cambios guardados." : c.guardado;
    st.editando = null;
    if (c.recurso === "campuses") ref.sedes = null;   // la lista de sedes de las unidades cambia
    pintarFormulario();
    poner(zonaAviso, mensaje("ok", texto));
    cargarLista();
  } catch (e) {
    mostrarError(e);
  } finally {
    vaciarClaves();         // con éxito o con error, la clave no se queda en el campo
    st.guardando = false; boton.disabled = false;
  }
}

function vaciarClaves() {
  for (const ct of Object.values(controles)) if (ct.vaciar) ct.vaciar();
}

// Las listas (roles) se comparan sin importar el orden.
const igual = (a, b) => (Array.isArray(a) || Array.isArray(b)
  ? JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
  : (a ?? "") === (b ?? "") || (typeof a === "number" && Number(b) === a));

// ── Errores del servidor ─────────────────────────────────────
// 422 del G6: details.items = [{field, code, message}]. 422 de FastAPI: details = {campo: mensaje}.
// 409: aviso resaltado con el mensaje del servidor y, si señala un campo, también junto a él.
function erroresPorCampo(e) {
  const d = e.details;
  if (!d || typeof d !== "object") return [];
  if (Array.isArray(d.items)) return d.items.filter((x) => x && x.field).map((x) => ({ campo: x.field, texto: x.message }));
  if (d.field) return [{ campo: d.field, texto: d.message || e.message }];
  return Object.entries(d).filter(([, v]) => typeof v === "string").map(([k, v]) => ({ campo: k.split(".").pop(), texto: v }));
}

/** Marca un campo con su error (texto del servidor, o «Elige al menos un rol.»). Devuelve el control. */
function marcarError(id, texto) {
  const ct = controles[id];
  if (!ct) return null;
  ct.error.textContent = texto;
  ct.error.hidden = false;
  const blanco = ct.grupo || ct.input;
  blanco.setAttribute("aria-invalid", "true");
  if (!ct.grupo) {
    if (ct.input.dataset.desc === undefined) ct.input.dataset.desc = ct.input.getAttribute("aria-describedby") || "";
    ct.input.setAttribute("aria-describedby", [ct.input.dataset.desc, ct.error.id].filter(Boolean).join(" "));
  }
  return ct.input;
}

function mostrarError(e) {
  // (No se llama «lista»: ese nombre es una función de api.js.)
  const errores = erroresPorCampo(e);
  const sueltos = [];
  let primero = null;
  for (const x of errores) {
    const input = marcarError(x.campo, x.texto);
    if (!input) { sueltos.push(x.texto); continue; }
    primero ||= input;
  }
  if (e.status === 409) poner(zonaAviso, mensaje("aviso", e.message));
  else if (!errores.length || sueltos.length) poner(zonaAviso, mensaje("error", [e.message, ...sueltos].join(" ")));
  else poner(zonaAviso, mensaje("error", e.message));
  (primero || zonaAviso).scrollIntoView?.({ block: "center" });
  primero?.focus({ preventScroll: true });
}

function limpiarError(id) {
  const ct = controles[id];
  if (!ct) return;
  ct.error.hidden = true;
  ct.error.textContent = "";
  (ct.grupo || ct.input).removeAttribute("aria-invalid");
  // Vuelve la descripción que el campo tenía antes del error (p. ej. la nota de la clave).
  if (!ct.grupo && ct.input.dataset.desc !== undefined) {
    if (ct.input.dataset.desc) ct.input.setAttribute("aria-describedby", ct.input.dataset.desc);
    else ct.input.removeAttribute("aria-describedby");
  }
}

function limpiarErrores() {
  for (const id of Object.keys(controles)) limpiarError(id);
  if (zonaAviso) poner(zonaAviso);
}

// ── Arranque (al final: usa las funciones y variables de arriba) ──
abrir(st.cat, false);
window.addEventListener("hashchange", () => { const c = deHash(); if (c !== st.cat) abrir(c, false); });
