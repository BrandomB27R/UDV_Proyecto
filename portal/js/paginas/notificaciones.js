// Notificaciones: sin leer y todas, marcar como leída (una o todas), con enlace a la sección que corresponde.
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { fechaCorta, fechaHora } from "../formato.js";
import { pestanas, vacio, sinAcceso, textoDeError, todasLasPaginas } from "../componentes.js";
import { requerirSesion, perfiles } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "notificaciones");
tituloPestana("Notificaciones");

const POR_PAGINA = 20;
const p = perfiles(yo.roles);
// Desde la campana (#aviso-N) se abre "Todas": el aviso puede estar ya leído.
const st = { filtro: location.hash.startsWith("#aviso-") ? "todas" : "sin-leer", items: [], total: 0, pagina: 0, noLeidas: 0 };

const zona = h("div", { "aria-live": "polite" });
const listaEl = h("div", { role: "tabpanel" });
const marcarTodas = h("button", { type: "button", class: "v-btn v-btn--sec", onclick: marcarTodasLeidas }, "Marcar todas como leídas");
const pest = h("div");

// Cada aviso enlaza a su tarea (assignment_id) o a su programa (program_version_id).
// Sin ninguno de los dos, a la sección que corresponde por el tipo de evento.
function destino(n) {
  if (n.assignment_id != null) return { texto: "Ver la tarea", href: RUTAS.asignacion(n.assignment_id) };
  if (n.program_version_id != null) return { texto: "Ver el programa", href: RUTAS.programa(n.program_version_id) };
  const e = String(n.event || "");
  if (e.startsWith("task.") && (yo.roles || []).includes("coordinator")) return { texto: "Ir a Tareas", href: RUTAS.tareas };
  if (e.startsWith("task.") && p.docente) return { texto: "Ir a Mis tareas", href: RUTAS.misTareas };
  return null;
}

async function cargar(reiniciar = true) {
  if (reiniciar) { st.items = []; st.pagina = 0; }
  try {
    const [r, nl] = await Promise.all([
      api(`/notifications?page=${st.pagina + 1}&per_page=${POR_PAGINA}${st.filtro === "sin-leer" ? "&unread=true" : ""}`),
      api("/notifications?unread=true&per_page=1"),
    ]);
    st.pagina += 1;
    st.items = st.items.concat(r.data || []);
    st.total = Number(r.total) || 0;
    st.noLeidas = Number(nl.total) || 0;
  } catch (e) {
    await sinAcceso(raiz, "Notificaciones", textoDeError(e, "No se pudieron cargar tus notificaciones."));
  }
  pintar();
}

function pintar() {
  poner(pest, pestanas([
    { id: "sin-leer", texto: "Sin leer", n: st.noLeidas },
    { id: "todas", texto: "Todas" },
  ], st.filtro, (id) => { st.filtro = id; poner(zona); cargar(); }, "Filtrar notificaciones"));
  listaEl.setAttribute("aria-labelledby", `pest-${st.filtro}`);
  marcarTodas.hidden = !st.noLeidas;
  poner(listaEl,
    st.items.length
      ? h("ul", { class: "v-notifs" }, st.items.map(fila))
      : vacio(st.filtro === "sin-leer" ? "No tienes notificaciones sin leer." : "Todavía no tienes notificaciones."),
    st.items.length < st.total
      ? h("div", { class: "v-acciones" }, h("button", { type: "button", class: "v-btn v-btn--sec", onclick: () => cargar(false) }, `Ver más (${st.total - st.items.length})`))
      : null);
  // Si se llegó desde la campana (#aviso-N), se lleva la vista a ese aviso.
  const objetivo = location.hash && document.getElementById(location.hash.slice(1));
  if (objetivo) objetivo.scrollIntoView({ block: "center" });
}

function fila(n) {
  const ir = destino(n);
  const boton = n.is_read ? null : h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico", onclick: async (e) => {
    e.target.disabled = true;
    try {
      await marcarLeida(n);
      pintar();
    } catch (err) { poner(zona, mensaje("error", err.message)); e.target.disabled = false; }
  } }, "Marcar como leída");
  return h("li", { class: `v-notif${n.is_read ? "" : " v-notif--nueva"}`, id: `aviso-${n.id}` },
    h("div", { class: "v-notif__cuerpo" },
      h("span", { class: "v-notif__titulo" }, n.is_read ? null : h("span", { class: "v-notif__punto", "aria-hidden": "true" }),
        n.is_read ? null : h("span", { class: "v-sr" }, "Sin leer: "), n.title || "Aviso"),
      h("span", { class: "v-notif__texto" }, n.message || ""),
      h("span", { class: "v-notif__fecha", title: fechaHora(n.created_at) }, fechaCorta(n.created_at))),
    h("div", { class: "v-notif__acciones" },
      // Abrir el destino cuenta como leer el aviso.
      ir ? h("a", { class: "v-btn v-btn--sec v-btn--chico", href: ir.href, onclick: async (e) => {
        if (n.is_read) return;
        e.preventDefault();
        await marcarLeida(n).catch(() => {});
        location.assign(ir.href);
      } }, ir.texto) : null,
      boton));
}

async function marcarLeida(n) {
  await api(`/notifications/${n.id}/read`, { method: "PATCH" });
  n.is_read = true;
  st.noLeidas = Math.max(0, st.noLeidas - 1);
  window.dispatchEvent(new Event("vinci:avisos"));     // la campana vuelve a contar
}

async function marcarTodasLeidas() {
  marcarTodas.disabled = true;
  try {
    const todas = (await todasLasPaginas(api, "/notifications?unread=true")).data || [];
    const r = await Promise.allSettled(todas.map((n) => api(`/notifications/${n.id}/read`, { method: "PATCH" })));
    const fallos = r.filter((x) => x.status === "rejected").length;
    poner(zona, fallos ? mensaje("error", `No se pudieron marcar ${fallos} notificaciones. Intenta de nuevo.`)
      : mensaje("ok", "Todas tus notificaciones quedaron como leídas."));
    window.dispatchEvent(new Event("vinci:avisos"));
    await cargar();
  } finally { marcarTodas.disabled = false; }
}

poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("h1", { class: "v-h1" }, "Notificaciones"),
    marcarTodas),
  zona,
  h("section", { class: "v-card", "aria-label": "Notificaciones" }, pest, listaEl));
await cargar();
