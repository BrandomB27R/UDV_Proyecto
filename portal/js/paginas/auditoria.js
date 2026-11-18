// Auditoría (mockup vinci-auditoria): quién hizo qué y cuándo, en palabras. Administración y auditoría
// (GET /audit acepta esos dos roles). Los filtros viven en la URL para poder recargar o compartir la vista.
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { fechaCorta, fechaHora } from "../formato.js";
import { sinAcceso, textoDeError, todasLasPaginas } from "../componentes.js";
import { requerirSesion, tieneRol } from "../sesion.js";
import { opcionesEntidad, opcionesAccion, cambiosDe, accionMostrada, sobreQue, queCambio } from "../auditoria/legible.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "auditoria");
tituloPestana("Auditoría");

const SIN_PERMISO = "La auditoría la consultan administración y auditoría.";
if (!tieneRol(yo, "admin", "auditor")) await sinAcceso(raiz, "Auditoría", SIN_PERMISO);

const POR_PAGINA = 50;
const MAX_CAMBIOS = 3;
const CAMPOS_FILTRO = ["user_id", "desde", "hasta", "entity", "action"];

// ── Opciones de los filtros ──────────────────────────────────
let opciones;
try {
  opciones = await api("/audit/filters");
} catch (e) {
  await sinAcceso(raiz, "Auditoría", textoDeError(e, SIN_PERMISO));
}
// Usuarios con nombre y correo (vinci-14): el filtro muestra el nombre y el correo como dato secundario.
const usuarios = new Map((opciones.users || []).map((u) => [Number(u.id), { name: u.name || null, email: u.email || null }]));
const textoUsuario = (id, u) => (u.name && u.email ? `${u.name} · ${u.email}` : u.name || u.email || `usuario n.º ${id}`);

// ── Estado (desde la URL) ────────────────────────────────────
const leerURL = () => {
  const p = new URLSearchParams(location.search);
  return { ...Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, p.get(k) || ""])), page: Math.max(1, Number(p.get("page")) || 1) };
};
let st = leerURL();
const guardarURL = () => {
  const p = new URLSearchParams();
  for (const k of CAMPOS_FILTRO) if (st[k]) p.set(k, st[k]);
  if (st.page > 1) p.set("page", String(st.page));
  history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
};

/**
 * Las fechas del filtro son días de Guatemala; /audit filtra por días completos en UTC.
 * Un día de Guatemala (UTC−6) va de las 06:00 de ese día a las 06:00 del siguiente en UTC, así que
 * se pide del día «desde» al día siguiente a «hasta»: cubre el rango entero (NOTAS_BACKEND §9).
 */
function rangoUTC(desde, hasta) {
  const siguiente = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); };
  return { from: desde || null, to: hasta ? siguiente(hasta) : null };
}

// ── Página ───────────────────────────────────────────────────
const sel = (id, opcionesSel, valor) => h("select", { id },
  opcionesSel.map((o) => h("option", { value: o.valor, selected: o.valor === valor }, o.texto)));
const campo = (id, etiqueta, nodo) => h("div", { class: "v-campo au-control" }, h("label", { for: id }, etiqueta), nodo);

const form = h("form", { class: "au-filtros", "aria-label": "Filtrar la auditoría" },
  campo("f-usuario", "Usuario", sel("f-usuario",
    [{ valor: "", texto: "Todos" }, ...[...usuarios].sort((a, b) => textoUsuario(...a).localeCompare(textoUsuario(...b), "es"))
      .map(([id, u]) => ({ valor: String(id), texto: textoUsuario(id, u) }))], st.user_id)),
  campo("f-desde", "Desde", h("input", { id: "f-desde", type: "date", value: st.desde })),
  campo("f-hasta", "Hasta", h("input", { id: "f-hasta", type: "date", value: st.hasta })),
  campo("f-entidad", "Qué se tocó", sel("f-entidad", [{ valor: "", texto: "Todo" }, ...opcionesEntidad(opciones.entities)], st.entity)),
  campo("f-accion", "Acción", sel("f-accion", [{ valor: "", texto: "Todas" }, ...opcionesAccion(opciones.actions)], st.action)),
  h("div", { class: "au-botones" },
    h("button", { type: "submit", class: "v-btn" }, "Buscar"),
    h("button", { type: "button", class: "v-enlace", onclick: () => { st = { user_id: "", desde: "", hasta: "", entity: "", action: "", page: 1 }; form.reset(); limpiarCampos(); buscar(); } }, "Limpiar")));
const zonaError = h("div", { "aria-live": "polite" });
const zonaResultado = h("div", { "aria-live": "polite" });

function limpiarCampos() {
  for (const id of ["f-usuario", "f-desde", "f-hasta", "f-entidad", "f-accion"]) document.getElementById(id).value = "";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = (id) => document.getElementById(id).value;
  const nuevo = { user_id: v("f-usuario"), desde: v("f-desde"), hasta: v("f-hasta"), entity: v("f-entidad"), action: v("f-accion"), page: 1 };
  if (nuevo.desde && nuevo.hasta && nuevo.desde > nuevo.hasta) {
    poner(zonaError, mensaje("error", "«Desde» tiene que ser igual o anterior a «Hasta»."));
    document.getElementById("f-hasta").setAttribute("aria-invalid", "true");
    return;
  }
  document.getElementById("f-hasta").removeAttribute("aria-invalid");
  st = nuevo;
  buscar();
});

poner(raiz,
  h("div", { class: "v-cabecera", style: "gap: 6px" },
    h("h1", { class: "v-h1" }, "Auditoría"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, "Quién hizo qué y cuándo. Los registros no se pueden editar ni borrar. Las fechas están en hora de Guatemala.")),
  h("section", { class: "v-card au-card", "aria-label": "Registros de auditoría" }, form, zonaError, zonaResultado));
buscar();

async function buscar() {
  guardarURL();
  poner(zonaError);
  poner(zonaResultado, h("p", { class: "v-cargando", role: "status" }, "Cargando registros…"));
  const { from, to } = rangoUTC(st.desde, st.hasta);
  const q = new URLSearchParams({ page: String(st.page), per_page: String(POR_PAGINA) });
  if (st.user_id) q.set("user_id", st.user_id);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (st.entity) q.set("entity", st.entity);
  if (st.action) q.set("action", st.action);
  let r;
  try {
    r = await api(`/audit?${q}`);
  } catch (e) {
    poner(zonaResultado);
    poner(zonaError, mensaje("error", `No se pudo cargar la auditoría: ${textoDeError(e, SIN_PERMISO)}`),
      h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: buscar }, "Reintentar"));
    return;
  }
  await nombrarTiposDeTarea(r.data || []);
  pintar(r);
}

/**
 * La auditoría no trae entity_label de los tipos de tarea (solo lo pone el G6 para sus entidades):
 * si una fila de tipo_tarea viene sin nombre, se busca en /task-types (una sola vez por página).
 * Quien no administra tipos solo recibe los activos; los demás se quedan con «n.º».
 */
let nombresTipo = null;
async function nombrarTiposDeTarea(filas) {
  const sinNombre = filas.filter((x) => x.entity === "tipo_tarea" && !x.entity_label && x.entity_id != null);
  if (!sinNombre.length) return;
  if (!nombresTipo) {
    const t = await todasLasPaginas(api, "/task-types?include_inactive=true").catch(() => ({ data: [] }));
    nombresTipo = new Map((t.data || []).map((x) => [String(x.id), x.name]));
  }
  for (const x of sinNombre) x.entity_label = nombresTipo.get(String(x.entity_id)) || null;
}

function pintar(r) {
  const total = Number(r.total) || 0;
  const filas = r.data || [];
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (!filas.length) {
    const conFiltros = CAMPOS_FILTRO.some((k) => st[k]);
    poner(zonaResultado, h("div", { class: "v-vacio" },
      h("p", {}, conFiltros ? "Ningún registro coincide con los filtros." : "Todavía no hay registros de auditoría."),
      conFiltros ? h("button", { type: "button", class: "v-btn v-btn--sec", onclick: () => { st = { user_id: "", desde: "", hasta: "", entity: "", action: "", page: 1 }; limpiarCampos(); buscar(); } }, "Quitar los filtros") : null));
    return;
  }
  const desde = (st.page - 1) * POR_PAGINA + 1;
  const hasta = desde + filas.length - 1;
  poner(zonaResultado,
    h("p", { class: "au-resumen" }, h("strong", {}, total.toLocaleString("es-GT")), ` ${total === 1 ? "registro" : "registros"} · mostrando del ${desde} al ${hasta}, del más reciente al más antiguo`),
    h("table", { class: "pn-tabla au-tabla" },
      h("caption", { class: "v-sr" }, "Registros de auditoría"),
      h("thead", {}, h("tr", {}, ["Fecha", "Quién", "Acción", "Sobre qué", "Qué cambió"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, filas.map(fila))),
    paginas > 1 ? h("nav", { class: "au-paginas", "aria-label": "Páginas" },
      h("span", {}, `Página ${st.page} de ${paginas}`),
      h("div", { class: "au-paginas__botones" },
        h("button", { type: "button", class: "v-enlace", disabled: st.page <= 1, onclick: () => irA(st.page - 1) }, "← Anterior"),
        h("button", { type: "button", class: "v-enlace", disabled: st.page >= paginas, onclick: () => irA(st.page + 1) }, "Siguiente →"))) : null);
}

function irA(pagina) {
  st.page = pagina;
  buscar();
  raiz.querySelector(".au-card")?.scrollIntoView({ block: "start" });
}

function fila(r) {
  const cambios = cambiosDe(r, { usuarios });
  const accion = accionMostrada(r, cambios);
  const sobre = sobreQue(r);
  return h("tr", { class: "pn-fila" },
    h("td", { "data-etiqueta": "Fecha", class: "pn-fecha", title: fechaHora(r.created_at) }, fechaCorta(r.created_at)),
    h("td", { "data-etiqueta": "Quién" }, h("div", { class: "pn-tarea au-quien" },
      h("strong", {}, r.actor_name || (r.actor_id ? r.actor_email || `usuario n.º ${r.actor_id}` : "—")),
      h("span", {}, r.actor_id ? r.actor_email || "" : "correo no registrado"))),
    h("td", { "data-etiqueta": "Acción" }, h("span", { class: `au-accion${accion.tono ? ` au-accion--${accion.tono}` : ""}` }, accion.texto)),
    h("td", { "data-etiqueta": "Sobre qué" }, h("div", { class: "pn-tarea" },
      sobre.href ? h("a", { href: sobre.href }, sobre.entidad) : h("strong", { class: "au-entidad" }, sobre.entidad),
      h("span", {}, sobre.nombre || "—"))),
    h("td", { "data-etiqueta": "Qué cambió" }, celdaCambio(r, cambios)));
}

function lineaCambio(c) {
  return h("li", {},
    h("span", { class: "au-campo" }, c.campo),
    c.antes === null ? h("span", { class: "au-ahora" }, c.despues)
      : [h("span", { class: "au-antes" }, h("span", { class: "v-sr" }, "antes: "), c.antes), h("span", { class: "au-flecha", "aria-hidden": "true" }, "→"),
        h("span", { class: "au-ahora" }, h("span", { class: "v-sr" }, "después: "), c.despues)]);
}

function celdaCambio(r, cambios) {
  const q = queCambio(r, cambios);
  if (q.tipo === "vacio") return h("span", { class: "au-nada" }, "Sin cambios en los datos.");
  if (q.tipo === "texto") return h("div", { class: "au-texto" },
    h("span", { class: q.tono ? `au-texto--${q.tono}` : "" }, q.texto), q.nota ? h("span", { class: "au-nota" }, q.nota) : null);
  const lista = h("ul", { class: "au-cambios" }, q.cambios.slice(0, MAX_CAMBIOS).map(lineaCambio));
  const resto = q.cambios.length - MAX_CAMBIOS;
  const ver = resto > 0 ? h("button", { type: "button", class: "v-enlace au-ver", "aria-expanded": "false", onclick: (e) => {
    poner(lista, q.cambios.map(lineaCambio));
    e.currentTarget.remove();
  } }, `Ver los ${q.cambios.length} cambios`) : null;
  return h("div", { class: "au-cambio" }, lista, ver, q.comentario ? h("p", { class: "au-nota" }, `«${q.comentario}»`) : null);
}
