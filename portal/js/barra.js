// Barra común: escudo, secciones según el perfil, campana, usuario y salir.
// Bajo 600 px: escudo, nombre, campana y un botón de menú con secciones, usuario y salir.
import { api, lista } from "./api.js";
import { APP_NAME, RUTAS, INTERVALO_AVISOS_MS } from "./config.js";
import { h, poner, icono } from "./dom.js";
import { fechaCorta } from "./formato.js";
import { perfiles, nombrePerfil, cerrarSesion, puedeRevisar } from "./sesion.js";

// Roles que ven el panel de /dashboard (los mismos que acepta el G6).
const ROLES_PANEL = ["coordinator", "authority", "admin", "auditor"];

/** Secciones de la barra según la unión de roles. */
export function secciones(yo) {
  const roles = yo.roles || [];
  const p = perfiles(roles);
  // «Inicio» primero para todos los perfiles (se marca activo en inicio.html).
  const s = [{ id: "inicio", texto: "Inicio", href: RUTAS.inicio }];
  if (puedeRevisar(yo)) s.push({ id: "por-revisar", texto: "Por revisar", href: RUTAS.porRevisar });
  if (roles.includes("coordinator")) s.push({ id: "tareas", texto: "Tareas", href: RUTAS.tareas });
  if (p.docente) s.push({ id: "mis-tareas", texto: "Mis tareas", href: RUTAS.misTareas });
  if (roles.some((r) => ROLES_PANEL.includes(r))) s.push({ id: "panel", texto: "Panel", href: RUTAS.panel });
  if (p.docente || p.coordinacion || p.administracion) s.push({ id: "programas", texto: "Programas de curso", href: RUTAS.programas });
  return s;
}

export const puedeVerPanel = (yo) => (yo.roles || []).some((r) => ROLES_PANEL.includes(r));

/** Pinta la barra en <header id="barra">. `actual` es el id de la sección marcada. */
export function montarBarra(yo, actual) {
  const raiz = document.getElementById("barra");
  raiz.className = "v-barra";

  const nav = h("nav", { class: "v-nav", "aria-label": "Principal" },
    secciones(yo).map((s) => h("a", { href: s.href, "aria-current": s.id === actual ? "page" : null }, s.texto)));
  const cuenta = h("div", { class: "v-barra__cuenta" },
    h("div", { class: "v-usuario" },
      h("span", { class: "v-usuario__nombre" }, yo.nombre),
      h("span", { class: "v-usuario__perfil" }, nombrePerfil(yo.roles))),
    h("button", { type: "button", class: "v-salir", onclick: cerrarSesion }, "Cerrar sesión"));
  const menu = h("div", { class: "v-barra__menu", id: "menu-principal" }, nav, cuenta);

  const contador = h("span", { class: "v-campana__n", hidden: true });
  const campana = h("button", { type: "button", class: "v-campana", "aria-label": "Notificaciones", "aria-expanded": "false", "aria-controls": "avisos" },
    icono("campana", 20), contador);
  const botonMenu = h("button", { type: "button", class: "v-menu-btn", "aria-expanded": "false", "aria-controls": "menu-principal" },
    h("span", { class: "v-menu-btn__icono", "aria-hidden": "true" }, h("span"), h("span"), h("span")), "Menú");
  const panel = h("section", { class: "v-avisos", id: "avisos", hidden: true, "aria-label": "Notificaciones" });

  poner(raiz, h("div", { class: "v-barra__in" },
    h("a", { class: "v-marca", href: RUTAS.inicio },
      h("img", { src: "/udv-styles/udv-escudo.png", alt: "Escudo de la Universidad Da Vinci de Guatemala" }),
      h("span", {}, APP_NAME)),
    menu, campana, botonMenu, panel));

  botonMenu.addEventListener("click", () => {
    const abrir = !menu.classList.contains("v-barra__menu--abierto");
    menu.classList.toggle("v-barra__menu--abierto", abrir);
    botonMenu.setAttribute("aria-expanded", String(abrir));
    if (abrir) cerrarPanel();
  });

  // ── Notificaciones ──
  let noLeidas = 0;
  const pintarContador = () => {
    contador.hidden = noLeidas === 0;
    contador.textContent = noLeidas > 99 ? "99+" : String(noLeidas);
    campana.setAttribute("aria-label", noLeidas ? `Notificaciones, ${noLeidas} sin leer` : "Notificaciones");
  };
  const consultar = async () => {
    try {
      const r = await api("/notifications?unread=true&per_page=1");
      noLeidas = Number(r?.total ?? lista(r).length) || 0;
      pintarContador();
    } catch { /* la campana no debe romper la página */ }
  };

  const verTodas = () => h("a", { class: "v-avisos__todas", href: RUTAS.notificaciones }, "Ver todas las notificaciones");
  const abrirPanel = async () => {
    poner(panel, h("h2", {}, "Notificaciones"), h("p", { class: "v-nota" }, "Cargando…"));
    try {
      const avisos = lista(await api("/notifications?per_page=5"));
      poner(panel, h("h2", {}, "Notificaciones"),
        avisos.length
          ? h("ul", {}, avisos.map((n) => h("li", {},
            h("a", { class: `v-aviso-item${n.is_read ? "" : " v-aviso-item--nuevo"}`, href: `${RUTAS.notificaciones}#aviso-${n.id}` },
              h("strong", {}, n.is_read ? "" : h("span", { class: "v-sr" }, "Sin leer: "), n.title || "Aviso"),
              h("span", {}, n.message || ""),
              h("small", {}, fechaCorta(n.created_at))))))
          : h("p", { class: "v-nota" }, "No tienes notificaciones."),
        verTodas());
    } catch (e) {
      poner(panel, h("h2", {}, "Notificaciones"), h("p", { class: "v-msg v-msg--error" }, e.message), verTodas());
    }
  };
  function cerrarPanel() { panel.hidden = true; campana.setAttribute("aria-expanded", "false"); }

  campana.addEventListener("click", () => {
    const abrir = panel.hidden;
    panel.hidden = !abrir;
    campana.setAttribute("aria-expanded", String(abrir));
    if (abrir) abrirPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { cerrarPanel(); campana.focus(); }
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !campana.contains(e.target)) cerrarPanel();
  });

  consultar();
  setInterval(consultar, INTERVALO_AVISOS_MS);
  // Otras páginas (notificaciones) avisan cuando cambian las no leídas.
  window.addEventListener("vinci:avisos", consultar);
}
