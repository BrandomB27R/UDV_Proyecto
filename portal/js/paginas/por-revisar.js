// Por revisar (revisión y coordinación), en dos pestañas:
//   «Por revisar»: la cola de /review-queue. Primero las que ya se tomaron, luego las más antiguas.
//   «Por cerrar»: TODAS las entregas aprobadas que quien mira puede cerrar (la misma fuente que
//   «Listas para cerrar» del inicio), con buscador, orden, páginas y «Cerrar la tarea» por fila.
// La pestaña se elige por la URL: ?ver=cerrar abre «Por cerrar» (los enlaces del inicio llevan ahí).
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { aInstante, chipEstado, etiquetaTipo, haceCuando } from "../formato.js";
import { filaAsignacion, vacio, todasLasPaginas, sinAcceso, textoDeError, pestanas } from "../componentes.js";
import { requerirSesion } from "../sesion.js";
import { porCerrar, ordenAprobadas, avisoSinConsultar } from "../inicio/coordinacion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "por-revisar");
tituloPestana("Por revisar");

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const cuando = (x) => aInstante(x.submitted_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
const orden = (a, b) => (a.status === b.status ? cuando(a) - cuando(b) : a.status === "under_review" ? -1 : 1);
const POR_PAGINA = 20;

const SIN_PERMISO = "«Por revisar» es para revisión, coordinación y administración.";
if (!(yo.roles || []).some((r) => ["reviewer", "coordinator", "admin"].includes(r))) await sinAcceso(raiz, "Por revisar", SIN_PERMISO);
let cola;
let cerrables = [];
try {
  // «Por cerrar» no debe tumbar la página: si falla, la pestaña lo dice.
  [cola, cerrables] = await Promise.all([
    todasLasPaginas(api, "/review-queue"),
    porCerrar(yo).catch((e) => ({ error: e })),
  ]);
} catch (e) {
  await sinAcceso(raiz, "Por revisar", textoDeError(e, SIN_PERMISO));
}
const errorCerrar = cerrables?.error || null;
const sinConsultar = errorCerrar ? 0 : cerrables.sinConsultar || 0;
if (errorCerrar) cerrables = [];

// Cada fila dice si le toca a quien mira (mine) y quién la revisa (reviewer_name).
const items = cola.data || [];
const mias = items.filter((x) => x.mine);
const otras = items.filter((x) => !x.mine)
  .map((x) => ({ ...x, teacher: `${x.teacher} · revisa ${x.reviewer_name || "otra persona"}` }));
mias.sort(orden);
otras.sort(orden);

const st = {
  pest: new URLSearchParams(location.search).get("ver") === "cerrar" ? "cerrar" : "revisar",
  buscar: "", orden: "antigua", pagina: 1,
};

const zona = h("div", { "aria-live": "polite" });
const zonaPest = h("div");
const panel = h("div", { role: "tabpanel", class: "pr-panel" });

function pintarPestanas() {
  poner(zonaPest, pestanas([
    { id: "revisar", texto: "Por revisar", n: mias.length },
    { id: "cerrar", texto: "Por cerrar", n: errorCerrar ? "—" : cerrables.length },
  ], st.pest, (id) => {
    st.pest = id;
    // La URL dice la pestaña, para volver a ella o compartirla.
    history.replaceState(null, "", id === "cerrar" ? `${location.pathname}?ver=cerrar` : location.pathname);
    poner(zona);
    pintarPanel();
  }, "Qué mostrar"));
  panel.setAttribute("aria-labelledby", `pest-${st.pest}`);
}

function pintarPanel() {
  panel.setAttribute("aria-labelledby", `pest-${st.pest}`);
  poner(panel, st.pest === "cerrar" ? panelCerrar() : panelRevisar());
}

// ── Por revisar ──
function panelRevisar() {
  const tomadas = mias.filter((x) => x.status === "under_review").length;
  const nuevas = mias.filter((x) => x.status === "submitted").length;
  const partes = [];
  if (nuevas) partes.push(`Tienes ${plural(nuevas, "entrega por revisar", "entregas por revisar")}`);
  if (tomadas) partes.push(`${plural(tomadas, "revisión en curso", "revisiones en curso")}`);
  return [
    h("p", { class: "pr-cuenta" }, partes.length ? `${partes.join(" y ")}.` : "No tienes entregas por revisar."),
    h("section", { "aria-labelledby": "t-mias" },
      h("h2", { id: "t-mias", class: "v-h2" }, "Te tocan a ti"),
      h("p", { class: "v-nota" }, "Primero las que ya tomaste; luego las entregas más antiguas."),
      mias.length ? h("ul", { class: "v-tareas" }, mias.map(filaAsignacion)) : vacio("No hay entregas esperando tu revisión.")),
    otras.length ? h("details", { class: "v-plegable pr-otras" },
      h("summary", { class: "v-h2" }, `Las revisa otra persona (${otras.length})`),
      h("p", { class: "v-nota" }, "Tienen otro revisor designado. Puedes abrirlas para seguirlas."),
      h("ul", { class: "v-tareas" }, otras.map(filaAsignacion))) : null,
  ];
}

// ── Por cerrar ──
const ORDENES = {
  antigua: { texto: "Aprobada hace más tiempo", fn: ordenAprobadas },
  reciente: { texto: "Aprobada más reciente", fn: (a, b) => ordenAprobadas(b, a) },
  titulo: { texto: "Título (A a Z)", fn: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "es") || a.id - b.id },
  docente: { texto: "Docente (A a Z)", fn: (a, b) => String(a.teacher || "").localeCompare(String(b.teacher || ""), "es") || a.id - b.id },
};
const sinTildes = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const subtituloDe = (x) => [etiquetaTipo(x.task_type), x.course_code, x.period_code].filter(Boolean).join(" · ");

function filtradas() {
  const q = sinTildes(st.buscar.trim());
  const v = q ? cerrables.filter((x) => sinTildes([x.title, x.course_code, x.course_name, x.teacher].join(" ")).includes(q)) : [...cerrables];
  return v.sort(ORDENES[st.orden].fn);
}

let zonaTabla = null;
function panelCerrar() {
  const buscar = h("input", { id: "buscar-cerrar", type: "search", value: st.buscar, autocomplete: "off", placeholder: "Título, curso o docente" });
  let espera = null;
  buscar.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => { st.buscar = buscar.value; st.pagina = 1; pintarTabla(); }, 250);
  });
  const ordenar = h("select", { id: "orden-cerrar", onchange: (e) => { st.orden = e.target.value; st.pagina = 1; pintarTabla(); } },
    Object.entries(ORDENES).map(([k, o]) => h("option", { value: k, selected: st.orden === k }, o.texto)));
  zonaTabla = h("div", { class: "pr-cerrar__lista" });
  pintarTabla();
  if (errorCerrar) return mensaje("error", `No se pudieron cargar las tareas por cerrar: ${errorCerrar.message}`);
  const aviso = sinConsultar ? avisoSinConsultar(sinConsultar) : null;
  if (!cerrables.length) return [aviso, vacio("No hay tareas por cerrar.")];
  return [
    aviso,
    h("div", { class: "pr-filtros" },
      h("div", { class: "v-campo pr-filtros__buscar" }, h("label", { for: "buscar-cerrar" }, "Buscar"), buscar),
      h("div", { class: "v-campo pr-filtros__orden" }, h("label", { for: "orden-cerrar" }, "Ordenar por"), ordenar)),
    zonaTabla,
  ];
}

function pintarTabla() {
  if (!zonaTabla) return;
  const v = filtradas();
  const paginas = Math.max(1, Math.ceil(v.length / POR_PAGINA));
  st.pagina = Math.min(st.pagina, paginas);
  const desde = (st.pagina - 1) * POR_PAGINA;
  const filas = v.slice(desde, desde + POR_PAGINA);
  const n = cerrables.length;
  // Si alguna se puede regresar a revisión (no las de programa), el contador lo dice.
  const regresables = cerrables.some(puedeRegresar);
  const cuenta = st.buscar.trim()
    ? `${plural(v.length, "tarea coincide", "tareas coinciden")} con la búsqueda, de ${n} por cerrar.`
    : `${n === 1 ? "1 tarea aprobada espera" : `${n} tareas aprobadas esperan`} que ${n === 1 ? "la cierres" : "las cierres"}`
      + `${regresables ? ` o ${n === 1 ? "la regreses" : "las regreses"} a revisión` : ""}.`;
  poner(zonaTabla,
    h("p", { class: "pr-cuenta", role: "status" }, cuenta),
    filas.length ? h("table", { class: "pn-tabla ini-tabla" },
      h("caption", { class: "v-sr" }, "Entregas aprobadas que puedes cerrar"),
      h("thead", {}, h("tr", {}, ["Tarea", "Docente", "Estado", "Aprobó"].map((t) => h("th", { scope: "col" }, t)),
        h("th", { scope: "col" }, h("span", { class: "v-sr" }, "Acción")))),
      h("tbody", {}, filas.map(filaCerrar)))
      : vacio("Ninguna tarea coincide con la búsqueda."),
    v.length ? h("nav", { class: "au-paginas", "aria-label": "Páginas de tareas por cerrar" },
      h("span", {}, `${plural(v.length, "tarea", "tareas")} · mostrando del ${desde + 1} al ${desde + filas.length}`),
      h("div", { class: "au-paginas__botones" },
        h("button", { type: "button", class: "v-enlace", disabled: st.pagina <= 1, onclick: () => { st.pagina--; pintarTabla(); } }, "← Anterior"),
        h("span", {}, `Página ${st.pagina} de ${paginas}`),
        h("button", { type: "button", class: "v-enlace", disabled: st.pagina >= paginas, onclick: () => { st.pagina++; pintarTabla(); } }, "Siguiente →"))) : null);
}

function filaCerrar(x) {
  const sub = subtituloDe(x);
  // porCerrar ya dejó solo las que traen «close» en viewer_actions; se vuelve a mirar por si acaso.
  const puede = (x.viewer_actions || []).includes("close");
  const boton = puede ? h("button", { type: "button", class: "v-btn v-btn--chico", "data-cerrar": x.id,
    "aria-label": `Cerrar la tarea: ${x.title} de ${x.teacher}`, onclick: (e) => cerrar(x, e.currentTarget) }, "Cerrar la tarea") : null;
  // «reopen» no viene en tareas de programa: ahí no aparece el enlace.
  const regresar = puedeRegresar(x) ? h("a", { class: "pr-regresar", href: `${RUTAS.asignacion(x.id)}#regresar`,
    "aria-label": `Regresar a revisión: ${x.title} de ${x.teacher}` }, "Regresar a revisión") : null;
  return h("tr", { class: "pn-fila pn-fila--cerrar" },
    h("td", { "data-etiqueta": "Tarea" }, h("div", { class: "pn-tarea" }, h("a", { href: RUTAS.asignacion(x.id) }, x.title || "Tarea"), sub ? h("span", {}, sub) : null)),
    h("td", { "data-etiqueta": "Docente" }, h("strong", {}, x.teacher || "—")),
    h("td", { "data-etiqueta": "Estado" }, chipEstado(x.status)),
    h("td", { "data-etiqueta": "Aprobó" }, h("div", { class: "pn-tarea" },
      h("strong", {}, x.aprobo || "—"), x.aprobadoEn ? h("span", {}, haceCuando(x.aprobadoEn)) : null)),
    h("td", { class: "pn-accion ini-accion" }, h("div", { class: "pr-acciones" }, regresar, boton)));
}

const puedeRegresar = (x) => (x.viewer_actions || []).includes("reopen");

async function cerrar(x, boton) {
  boton.disabled = true;
  boton.textContent = "Cerrando…";
  poner(zona);
  try {
    await api(`/assignments/${encodeURIComponent(x.id)}/close`, { method: "POST", body: {} });
    // Sale de la lista y baja el contador de la pestaña.
    const visibles = filtradas();
    const i = visibles.findIndex((y) => y.id === x.id);
    cerrables = cerrables.filter((y) => y.id !== x.id);
    poner(zona, mensaje("ok", `«${x.title}» de ${x.teacher} quedó cerrada.`));
    pintarPestanas();
    if (!cerrables.length) { pintarPanel(); return; }
    pintarTabla();
    // El foco pasa al botón de la fila que ocupó su lugar (o al buscador si no queda ninguna en la vista).
    const siguiente = filtradas()[Math.min(i, filtradas().length - 1)];
    (siguiente && panel.querySelector(`[data-cerrar="${siguiente.id}"]`) || document.getElementById("buscar-cerrar"))?.focus();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = "Cerrar la tarea";
    poner(zona, mensaje("error", `No se pudo cerrar «${x.title}»: ${e.message}`));
    boton.focus();
  }
}

poner(raiz,
  h("div", { class: "v-cabecera" },
    h("h1", { class: "v-h1" }, "Por revisar"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, "Lo que espera una acción tuya: revisar una entrega o cerrar una tarea ya aprobada.")),
  zona,
  h("section", { class: "v-card pr-card", "aria-label": "Por revisar y por cerrar" }, zonaPest, panel));
pintarPestanas();
pintarPanel();
