// Catálogos (solo administración): las listas que usa todo el sistema. Misma estructura que la pantalla
// del G6 (/app/g6/catalogos.html) con el estilo de Vinci. API del G6: GET y POST /<recurso>,
// PATCH /<recurso>/{id}; para las unidades académicas, GET /faculties y GET /campuses.
// Las reglas (obligatorios, rangos, código repetido) las decide el servidor: aquí solo se muestran
// sus errores junto al campo (422) o como aviso (409).
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { sinAcceso, todasLasPaginas, vacio } from "../componentes.js";
import { requerirSesion, tieneRol } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "catalogos");
tituloPestana("Catálogos");

const SIN_PERMISO = "Los catálogos los administra el rol de administración.";
if (!tieneRol(yo, "admin")) await sinAcceso(raiz, "Catálogos", SIN_PERMISO);

const POR_PAGINA = 20;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const fecha = (v) => { const [y, m, d] = String(v || "").split("-").map(Number); return y ? `${d} ${MESES[m - 1]} ${y}` : "—"; };

// Facultades y sedes, para las listas y las columnas de «Unidades académicas» (se cargan al abrir la pestaña).
const ref = { facultades: null, sedes: null };
const nombreDe = (lista, id) => (lista || []).find((x) => Number(x.id) === Number(id))?.name || "—";

// Campos del formulario: los del G6 (catalogos.py). tipo: texto, numero, fecha o lista.
const CODIGO = { id: "code", etiqueta: "Código", tipo: "texto" };
const NOMBRE = (ejemplo) => ({ id: "name", etiqueta: "Nombre", tipo: "texto", ejemplo });
const col = (titulo, valor, clase) => ({ titulo, valor, clase });
const COL_CODIGO = col("Código", (r) => r.code, "ct-codigo");
const COL_NOMBRE = col("Nombre", (r) => r.name);

const CATALOGOS = [
  { id: "cursos", recurso: "courses", titulo: "Cursos", singular: "curso", guardado: "Curso guardado.",
    columnas: [COL_CODIGO, COL_NOMBRE, col("Créditos", (r) => r.credits)],
    campos: [{ ...CODIGO, ejemplo: "ISW-302" }, NOMBRE("Programación Web II"), { id: "credits", etiqueta: "Créditos", tipo: "numero" }] },
  { id: "periodos", recurso: "periods", titulo: "Períodos", singular: "período", guardado: "Período guardado.",
    columnas: [COL_CODIGO, col("Período", (r) => r.name), col("Fechas", (r) => `${fecha(r.start_date)} – ${fecha(r.end_date)}`)],
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
];

// ── Estado ───────────────────────────────────────────────────
const deHash = () => CATALOGOS.find((c) => `#${c.id}` === location.hash) || CATALOGOS[0];
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
  poner(zonaPestanas, CATALOGOS.map((c) => h("button", {
    type: "button", class: "pn-filtro", "aria-pressed": String(c === st.cat),
    onclick: () => abrir(c, true),
  }, c.titulo)));
}

async function abrir(c, guardarHash) {
  st.cat = c; st.q = ""; st.page = 1; st.editando = null;
  buscador.value = "";
  if (guardarHash) history.replaceState(null, "", `#${c.id}`);
  pintarPestanas();
  poner(zonaLista, h("p", { class: "v-nota" }, "Cargando…"));
  if (c.referencias) {
    try { await cargarReferencias(); } catch (e) { poner(zonaLista, mensaje("error", e.message)); return; }
    if (st.cat !== c) return;
  }
  pintarFormulario();
  cargarLista();
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
    const r = await api(`/${c.recurso}?${p}`);
    if (n !== st.solicitud) return;
    const paginas = Math.max(1, Math.ceil((Number(r.total) || 0) / POR_PAGINA));
    if (st.page > paginas) { st.page = paginas; cargarLista(); return; }
    pintarLista(r.data || [], Number(r.total) || 0, paginas);
  } catch (e) {
    if (n === st.solicitud) poner(zonaLista, mensaje("error", e.message));
  }
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
        c.columnas.map((x, i) => h("td", { "data-etiqueta": x.titulo, class: x.clase || null }, i === 1 ? h("strong", {}, String(x.valor(r) ?? "—")) : String(x.valor(r) ?? "—"))),
        h("td", { "data-etiqueta": "Estado" }, chipActivo(r.is_active)),
        h("td", { class: "pn-accion" }, h("button", { type: "button", class: "v-enlace ct-editar", "aria-label": `Editar ${r.code}`, onclick: () => editar(r) }, "Editar")))))),
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

function control(campo, valor) {
  const id = `ct-${campo.id}`;
  const error = h("span", { class: "v-campo__error", id: `${id}-error`, hidden: true });
  let input;
  if (campo.tipo === "lista") {
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
  controles[campo.id] = { input, error, campo };
  return h("div", { class: "v-campo" }, h("label", { for: id }, campo.etiqueta), input, error);
}

function pintarFormulario() {
  const c = st.cat;
  const r = st.editando;
  controles = {};
  zonaAviso = h("div", { "aria-live": "polite" });
  const activo = h("input", { id: "ct-activo", type: "checkbox", checked: r ? !!r.is_active : true });
  const boton = h("button", { type: "submit", class: "v-btn" }, r ? "Guardar cambios" : `Agregar ${c.singular}`);
  const form = h("form", { class: "ct-campos", novalidate: true },
    c.campos.map((campo) => control(campo, r ? r[campo.id] : null)),
    h("label", { class: "ct-casilla", for: "ct-activo" }, activo, h("span", {}, "Activo")),
    zonaAviso,
    h("div", { class: "v-acciones" }, boton,
      r ? h("button", { type: "button", class: "v-btn v-btn--sec", onclick: cancelar }, "Cancelar") : null),
    h("p", { class: "v-nota" }, "Un registro inactivo deja de ofrecerse al crear tareas y programas."));
  form.addEventListener("submit", (e) => { e.preventDefault(); guardar(boton, activo); });
  poner(zonaFormulario,
    h("h2", { id: "ct-titulo-form", class: "v-h2" }, r ? `Editar ${c.singular}` : `Agregar ${c.singular}`),
    r ? h("p", { class: "v-nota" }, "Cambias ", h("strong", {}, `${r.code} · ${r.name}`), ".") : null,
    form);
}

/** Valor tal como lo espera el G6: número entero, fecha AAAA-MM-DD o texto. Vacío viaja como null. */
function leer(campo) {
  const v = controles[campo.id].input.value;
  if (v.trim() === "") return campo.tipo === "texto" && !campo.opcional ? "" : null;
  if (campo.tipo === "numero" || campo.tipo === "lista") return Number(v);
  return v;
}

async function guardar(boton, activo) {
  if (st.guardando) return;
  const c = st.cat;
  const r = st.editando;
  limpiarErrores();
  const datos = Object.fromEntries(c.campos.map((campo) => [campo.id, leer(campo)]));
  datos.is_active = activo.checked;
  // Al editar viaja solo lo que cambió (así la auditoría registra el cambio real).
  const cuerpo = r ? Object.fromEntries(Object.entries(datos).filter(([k, v]) => !igual(v, r[k]))) : datos;
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
    st.guardando = false; boton.disabled = false;
  }
}

const igual = (a, b) => (a ?? "") === (b ?? "") || (typeof a === "number" && Number(b) === a);

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

function mostrarError(e) {
  const lista = erroresPorCampo(e);
  const sueltos = [];
  let primero = null;
  for (const x of lista) {
    const ct = controles[x.campo];
    if (!ct) { sueltos.push(x.texto); continue; }
    ct.error.textContent = x.texto;
    ct.error.hidden = false;
    ct.input.setAttribute("aria-invalid", "true");
    ct.input.setAttribute("aria-describedby", ct.error.id);
    primero ||= ct.input;
  }
  if (e.status === 409) poner(zonaAviso, mensaje("aviso", e.message));
  else if (!lista.length || sueltos.length) poner(zonaAviso, mensaje("error", [e.message, ...sueltos].join(" ")));
  else poner(zonaAviso, mensaje("error", e.message));
  (primero || zonaAviso).scrollIntoView?.({ block: "center" });
  primero?.focus({ preventScroll: true });
}

function limpiarError(id) {
  const ct = controles[id];
  if (!ct) return;
  ct.error.hidden = true;
  ct.error.textContent = "";
  ct.input.removeAttribute("aria-invalid");
  ct.input.removeAttribute("aria-describedby");
}

function limpiarErrores() {
  for (const id of Object.keys(controles)) limpiarError(id);
  if (zonaAviso) poner(zonaAviso);
}

// ── Arranque (al final: usa las funciones y variables de arriba) ──
abrir(st.cat, false);
window.addEventListener("hashchange", () => { const c = deHash(); if (c !== st.cat) abrir(c, false); });
