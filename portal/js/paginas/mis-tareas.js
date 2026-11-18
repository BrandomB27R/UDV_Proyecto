// Mis tareas (docente): pestañas por estado, vencidas y por vencer resaltadas.
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { filaAsignacion, vacio, pestanas, todasLasPaginas, sinAcceso, textoDeError } from "../componentes.js";
import { requerirSesion } from "../sesion.js";

const GRUPOS = [
  { id: "por-hacer", texto: "Por hacer", estados: ["assigned"], vacio: "No tienes tareas nuevas por empezar." },
  { id: "en-curso", texto: "En curso", estados: ["in_progress"], vacio: "No tienes tareas en curso." },
  { id: "devueltas", texto: "Devueltas", estados: ["returned"], vacio: "No tienes tareas devueltas." },
  { id: "entregadas", texto: "Entregadas", estados: ["submitted", "under_review"], vacio: "No tienes entregas esperando revisión." },
  { id: "terminadas", texto: "Terminadas", estados: ["approved", "closed", "cancelled"], vacio: "Todavía no tienes tareas terminadas." },
];

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "mis-tareas");
tituloPestana("Mis tareas");

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
let datos = [];
let resumen = {};
let activa = null;
let buscar = "";

try {
  const [s, r] = await Promise.all([api("/inbox/summary"), todasLasPaginas(api, "/inbox")]);
  resumen = s || {};
  datos = r.data || [];
} catch (e) {
  await sinAcceso(raiz, "Mis tareas", textoDeError(e, "No tienes acceso a esta sección."));
}

const enGrupo = (g) => datos.filter((x) => g.estados.includes(x.status));
const deHash = GRUPOS.find((g) => `#${g.id}` === location.hash);
// Por defecto, lo que más urge: devueltas, luego en curso, luego por hacer.
activa = (deHash || ["devueltas", "en-curso", "por-hacer", "entregadas", "terminadas"]
  .map((id) => GRUPOS.find((g) => g.id === id)).find((g) => enGrupo(g).length) || GRUPOS[0]).id;

const lista = h("div", { role: "tabpanel", "aria-live": "polite" });
const campo = h("input", { id: "buscar", type: "search", placeholder: "Buscar por título", autocomplete: "off",
  oninput: (e) => { buscar = e.target.value.trim().toLowerCase(); pintarLista(); } });

poner(raiz,
  h("div", { class: "v-cabecera" },
    h("h1", { class: "v-h1" }, "Mis tareas"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, frase())),
  avisosDePlazo(),
  h("section", { class: "v-card", "aria-label": "Mis tareas por estado" },
    pestanas(GRUPOS.map((g) => ({ id: g.id, texto: g.texto, n: enGrupo(g).length })), activa, (id) => {
      activa = id;
      history.replaceState(null, "", `#${id}`);
      pintarLista();
    }, "Mis tareas por estado"),
    h("div", { class: "v-campo v-buscar" }, h("label", { for: "buscar", class: "v-sr" }, "Buscar por título"), campo),
    lista));
pintarLista();

function frase() {
  const pendientes = Number(resumen.pending) || 0;
  if (!datos.length) return "No tienes tareas asignadas.";
  if (!pendientes) return "No tienes tareas pendientes.";
  return `Tienes ${plural(pendientes, "tarea pendiente", "tareas pendientes")}.`;
}

function avisosDePlazo() {
  const vencidas = Number(resumen.overdue) || 0;
  const pronto = Number(resumen.due_soon) || 0;
  if (!vencidas && !pronto) return null;
  const partes = [];
  if (vencidas) partes.push(plural(vencidas, "tarea vencida", "tareas vencidas"));
  if (pronto) partes.push(`${plural(pronto, "tarea vence", "tareas vencen")} en los próximos días`);
  return mensaje(vencidas ? "error" : "aviso", `${partes.join(" y ")}. Están marcadas en la lista.`);
}

function pintarLista() {
  const g = GRUPOS.find((x) => x.id === activa);
  lista.setAttribute("aria-labelledby", `pest-${g.id}`);
  let filas = enGrupo(g);
  if (buscar) filas = filas.filter((x) => (x.title || "").toLowerCase().includes(buscar));
  // Vencidas primero, luego por vencer; el resto en el orden del inbox (prioridad y fecha).
  const peso = (x) => (x.due_state === "vencida" ? 0 : x.due_state === "por-vencer" ? 1 : 2);
  filas = [...filas].sort((a, b) => peso(a) - peso(b));
  poner(lista, filas.length
    ? h("ul", { class: "v-tareas" }, filas.map(filaAsignacion))
    : vacio(buscar ? "Ninguna tarea coincide con la búsqueda." : g.vacio));
}
