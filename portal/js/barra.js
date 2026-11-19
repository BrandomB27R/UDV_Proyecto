// Barra común: escudo, secciones según el perfil, campana, usuario y salir.
// Bajo 600 px: escudo, nombre, campana y un botón de menú con secciones, usuario y salir.
import { api, lista } from "./api.js";
import { APP_NAME, RUTAS, INTERVALO_AVISOS_MS } from "./config.js";
import { h, poner, icono, mensaje } from "./dom.js";
import { fechaCorta } from "./formato.js";
import { perfiles, nombrePerfil, cerrarSesion, puedeRevisar } from "./sesion.js";
import { destinoDeAviso, marcarAvisoLeido, marcarTodosLeidos } from "./avisos.js";

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
  // Catálogos del G6: administración. Tipos de tarea (G3): también coordinación.
  if (roles.includes("admin") || roles.includes("coordinator")) s.push({ id: "catalogos", texto: "Catálogos", href: RUTAS.catalogos });
  // GET /audit acepta administración y auditoría (G6).
  if (roles.includes("admin") || roles.includes("auditor")) s.push({ id: "auditoria", texto: "Auditoría", href: RUTAS.auditoria });
  return s;
}

export const puedeVerPanel = (yo) => (yo.roles || []).some((r) => ROLES_PANEL.includes(r));

/** Pinta la barra en <header id="barra">. `actual` es el id de la sección marcada. */
export function montarBarra(yo, actual) {
  const raiz = document.getElementById("barra");
  raiz.className = "v-barra";

  // No llamarla «lista»: ese nombre es la función importada de api.js que usa la campana más abajo.
  const enlaces = secciones(yo);
  // Con seis secciones o más (administración) los enlaces se compactan para que la barra quepa en una fila.
  const nav = h("nav", { class: `v-nav${enlaces.length >= 6 ? " v-nav--compacta" : ""}`, "aria-label": "Principal" },
    enlaces.map((s) => h("a", { href: s.href, "aria-current": s.id === actual ? "page" : null }, s.texto)));
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

  // Los cinco avisos más recientes que muestra el panel, y una zona para los errores al marcar.
  let avisos = [];
  const estado = h("div", { class: "v-avisos__estado", "aria-live": "polite" });
  const bajarContador = (n = 1) => { noLeidas = Math.max(0, noLeidas - n); pintarContador(); };
  // La página de Notificaciones (si está abierta) vuelve a cargar cuando el panel marca algo.
  const avisarCambio = () => window.dispatchEvent(new Event("vinci:avisos-panel"));

  // Un aviso lleva a su destino (avisos.js); sin destino, a la página de Notificaciones en ese aviso.
  const hrefDe = (n) => destinoDeAviso(n, yo)?.href || `${RUTAS.notificaciones}#aviso-${n.id}`;

  const irAlAviso = async (e, n) => {
    if (n.is_read) return;                       // ya leído: el enlace navega solo
    const enOtraPestana = e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0;
    if (enOtraPestana) {                         // se abre aparte: se marca sin cortar el clic
      poner(estado);
      marcarAvisoLeido(n.id).then(() => {
        n.is_read = true; bajarContador(); pintarAvisos(); avisarCambio();
        panel.querySelector(`[data-aviso="${n.id}"]`)?.focus();   // el panel se re-pinta: el foco vuelve a su aviso
      }).catch((err) => {
        // El aviso se abrió en otra pestaña, pero aquí sigue sin leer: se dice en el panel.
        poner(estado, mensaje("error", `No se pudo marcar «${n.title || "Aviso"}» como leída. ${err.message || ""}`.trim()));
      });
      return;
    }
    e.preventDefault();
    const destino = e.currentTarget.href;       // antes del await: después currentTarget ya es null
    // Abrir el aviso cuenta como leerlo. Si marcar falla, se navega igual.
    try { await marcarAvisoLeido(n.id); n.is_read = true; bajarContador(); avisarCambio(); } catch { /* se navega igual */ }
    cerrarPanel();
    location.assign(destino);
  };

  const marcarUno = async (boton, n) => {
    boton.disabled = true;
    poner(estado);
    try {
      await marcarAvisoLeido(n.id);
      n.is_read = true;
      bajarContador();
      pintarAvisos();
      avisarCambio();
      panel.querySelector(`[data-aviso="${n.id}"]`)?.focus();   // el botón desaparece: el foco pasa a su aviso
    } catch (err) {
      boton.disabled = false;
      poner(estado, mensaje("error", `No se pudo marcar «${n.title || "Aviso"}» como leída. ${err.message || ""}`.trim()));
      boton.focus();
    }
  };

  const marcarTodas = async (boton) => {
    boton.disabled = true;
    poner(estado);
    try {
      const { total, fallos } = await marcarTodosLeidos();
      if (!fallos) avisos.forEach((n) => { n.is_read = true; });
      noLeidas = fallos; pintarContador();
      if (fallos) {
        poner(estado, mensaje("error", `No se pudieron marcar ${fallos} de ${total} notificaciones. Intenta de nuevo.`));
        await recargarAvisos();                  // la lista muestra cuáles quedaron sin leer
        consultar();
      } else {
        pintarAvisos();
      }
      avisarCambio();
      // Si quedaron sin marcar, el foco vuelve al botón para reintentar; si no, al enlace del pie.
      (panel.querySelector(".v-avisos__marcar-todas") || panel.querySelector(".v-avisos__todas"))?.focus();
    } catch (err) {
      boton.disabled = false;
      poner(estado, mensaje("error", `No se pudieron marcar las notificaciones. ${err.message || ""}`.trim()));
      boton.focus();
    }
  };

  function pintarAvisos() {
    const hayNuevas = avisos.some((n) => !n.is_read) || noLeidas > 0;
    poner(panel, h("h2", {}, "Notificaciones"), estado,
      avisos.length
        ? h("ul", {}, avisos.map((n) => {
          const titulo = n.title || "Aviso";
          return h("li", { class: `v-aviso${n.is_read ? "" : " v-aviso--nuevo"}` },
            h("a", { class: "v-aviso-item", href: hrefDe(n), "data-aviso": n.id, onclick: (e) => irAlAviso(e, n), onauxclick: (e) => { if (e.button === 1) irAlAviso(e, n); } },
              h("strong", {}, n.is_read ? "" : h("span", { class: "v-sr" }, "Sin leer: "), titulo),
              h("span", {}, n.message || ""),
              h("small", {}, fechaCorta(n.created_at))),
            // Botón aparte del enlace (no dentro del <a>): marca sin navegar.
            n.is_read ? null : h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico v-aviso__marcar",
              "aria-label": `Marcar como leída: ${titulo}`, onclick: (e) => marcarUno(e.currentTarget, n) }, "Marcar como leída"));
        }))
        : h("p", { class: "v-nota" }, "No tienes notificaciones."),
      h("div", { class: "v-avisos__pie" },
        h("a", { class: "v-avisos__todas", href: RUTAS.notificaciones }, "Ver todas las notificaciones"),
        hayNuevas ? h("button", { type: "button", class: "v-btn v-btn--sec v-btn--chico v-avisos__marcar-todas",
          onclick: (e) => marcarTodas(e.currentTarget) }, "Marcar todas como leídas") : null));
  }

  async function recargarAvisos() {
    avisos = lista(await api("/notifications?per_page=5"));
    pintarAvisos();
  }

  const abrirPanel = async () => {
    poner(estado);
    poner(panel, h("h2", {}, "Notificaciones"), h("p", { class: "v-nota" }, "Cargando…"));
    try {
      await recargarAvisos();
    } catch (e) {
      poner(panel, h("h2", {}, "Notificaciones"), mensaje("error", e.message),
        h("div", { class: "v-avisos__pie" }, h("a", { class: "v-avisos__todas", href: RUTAS.notificaciones }, "Ver todas las notificaciones")));
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
    const ruta = e.composedPath();
    if (!panel.hidden && !ruta.includes(panel) && !ruta.includes(campana)) cerrarPanel();
  });

  consultar();
  setInterval(consultar, INTERVALO_AVISOS_MS);
  // Otras páginas (notificaciones) avisan cuando cambian las no leídas.
  window.addEventListener("vinci:avisos", consultar);
}
