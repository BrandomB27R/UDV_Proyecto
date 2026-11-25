// Notificaciones: sin leer y todas, marcar como leída (una o todas), con enlace a la sección que corresponde.
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { fechaCorta, fechaHora } from "../formato.js";
import { pestanas, vacio, sinAcceso, textoDeError } from "../componentes.js";
import { requerirSesion } from "../sesion.js";
import { destinoDeAviso, marcarAvisoLeido, marcarTodosLeidos } from "../avisos.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "notificaciones");
tituloPestana("Notificaciones");

const POR_PAGINA = 20;
// Desde la campana (#aviso-N) se abre "Todas": el aviso puede estar ya leído.
const st = { filtro: location.hash.startsWith("#aviso-") ? "todas" : "sin-leer", items: [], total: 0, pagina: 0, noLeidas: 0, turno: 0 };

const zona = h("div", { "aria-live": "polite" });
const listaEl = h("div", { role: "tabpanel" });
const marcarTodas = h("button", { type: "button", class: "v-btn v-btn--sec", onclick: marcarTodasLeidas }, "Marcar todas como leídas");
const pest = h("div");

async function cargar(reiniciar = true) {
  // La campana, el cambio de #aviso-N y los botones pueden pedir cargas a la vez: vale solo la última.
  const turno = ++st.turno;
  const pagina = reiniciar ? 0 : st.pagina;
  try {
    const [r, nl] = await Promise.all([
      api(`/notifications?page=${pagina + 1}&per_page=${POR_PAGINA}${st.filtro === "sin-leer" ? "&unread=true" : ""}`),
      api("/notifications?unread=true&per_page=1"),
    ]);
    if (turno !== st.turno) return;
    st.pagina = pagina + 1;
    st.items = (reiniciar ? [] : st.items).concat(r.data || []);
    st.total = Number(r.total) || 0;
    st.noLeidas = Number(nl.total) || 0;
  } catch (e) {
    if (turno !== st.turno) return;
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
  const ir = destinoDeAviso(n, yo);
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
  await marcarAvisoLeido(n.id);
  n.is_read = true;
  st.noLeidas = Math.max(0, st.noLeidas - 1);
  window.dispatchEvent(new Event("vinci:avisos"));     // la campana vuelve a contar
}

async function marcarTodasLeidas() {
  marcarTodas.disabled = true;
  try {
    const { fallos } = await marcarTodosLeidos();
    poner(zona, fallos ? mensaje("error", `No se pudieron marcar ${fallos} notificaciones. Intenta de nuevo.`)
      : mensaje("ok", "Todas tus notificaciones quedaron como leídas."));
    window.dispatchEvent(new Event("vinci:avisos"));
    await cargar();
  } finally { marcarTodas.disabled = false; }
}

// Si se marca algo desde la campana estando en esta página, la lista se pone al día.
window.addEventListener("vinci:avisos-panel", () => cargar());
// Un aviso sin destino lleva aquí (#aviso-N); si ya se está en esta página no hay recarga.
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#aviso-") && st.filtro !== "todas") { st.filtro = "todas"; poner(zona); cargar(); }
  else pintar();
});

poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("h1", { class: "v-h1" }, "Notificaciones"),
    marcarTodas),
  zona,
  h("section", { class: "v-card", "aria-label": "Notificaciones" }, pest, listaEl));
await cargar();
