// Programas de curso: un programa por curso, sede y modalidad, con sus versiones.
// GET /course-programs devuelve una fila por versión: aquí se agrupan por programa.
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner } from "../dom.js";
import { vacio, pestanas, sinAcceso, textoDeError } from "../componentes.js";
import { requerirSesion, tieneRol } from "../sesion.js";
import { listarProgramas } from "../programa/api-programa.js";
import { etiquetaEstadoPrograma, claseEstadoPrograma } from "../programa/flujo-programa.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "programas");
tituloPestana("Programas de curso");

const enlace = (v) => `/app/programa.html?version=${encodeURIComponent(v.id)}`;

const EN_ELABORACION = ["draft", "returned"];
const EN_REVISION = ["submitted", "under_review", "approved"];
const soloDocente = tieneRol(yo, "teacher") && !tieneRol(yo, "coordinator", "reviewer", "authority", "admin", "auditor");

let filas;
try {
  filas = (await listarProgramas()).data || [];
} catch (e) {
  await sinAcceso(raiz, "Programas de curso", textoDeError(e, "No tienes acceso a los programas de curso."));
}

// ── Agrupar por programa ──
const programas = new Map();
for (const f of filas) {
  if (!programas.has(f.id)) programas.set(f.id, { ...f, versiones: [] });
  programas.get(f.id).versiones.push({ id: f.programa_version_id, numero: f.numero_version, periodo: f.periodo, estado: f.estado });
}
const lista = [...programas.values()].map((p) => {
  p.versiones.sort((a, b) => b.numero - a.numero);
  p.vigente = p.versiones.find((v) => v.estado === "authorized") || null;
  p.abierta = p.versiones.find((v) => EN_ELABORACION.includes(v.estado) || EN_REVISION.includes(v.estado)) || null;
  return p;
}).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)) || String(a.sede).localeCompare(String(b.sede)));

const GRUPOS = [
  { id: "todos", texto: "Todos", filtro: () => true },
  { id: "elaboracion", texto: "En elaboración", filtro: (p) => p.versiones.some((v) => EN_ELABORACION.includes(v.estado)) },
  { id: "revision", texto: "En revisión", filtro: (p) => p.versiones.some((v) => EN_REVISION.includes(v.estado)) },
  { id: "vigentes", texto: "Con versión vigente", filtro: (p) => !!p.vigente },
];
let activa = GRUPOS.find((g) => `#${g.id}` === location.hash)?.id || "todos";
let buscar = "";
const panel = h("div", { role: "tabpanel" });

poner(raiz,
  h("div", { class: "v-cabecera" },
    h("h1", { class: "v-h1" }, "Programas de curso"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, soloDocente
      ? "Los programas que tienes a cargo y las versiones autorizadas de los cursos. Un programa nuevo se abre desde una tarea de «Actualizar programa»."
      : "Un programa por curso, sede y modalidad, con todas sus versiones. La vigente es la última autorizada.")),
  h("section", { class: "v-card", "aria-label": "Programas" },
    pestanas(GRUPOS.map((g) => ({ id: g.id, texto: g.texto, n: lista.filter(g.filtro).length })), activa, (id) => {
      activa = id; history.replaceState(null, "", `#${id}`); pintar();
    }, "Filtrar programas"),
    h("div", { class: "v-campo v-buscar" },
      h("label", { for: "buscar", class: "v-sr" }, "Buscar por código o nombre"),
      h("input", { id: "buscar", type: "search", placeholder: "Buscar por código o nombre", autocomplete: "off",
        oninput: (e) => { buscar = e.target.value.trim().toLowerCase(); pintar(); } })),
    panel));
pintar();

function pintar() {
  const g = GRUPOS.find((x) => x.id === activa);
  panel.setAttribute("aria-labelledby", `pest-${g.id}`);
  const visibles = lista.filter(g.filtro).filter((p) => !buscar || `${p.codigo} ${p.asignatura}`.toLowerCase().includes(buscar));
  poner(panel, visibles.length ? h("ul", { class: "v-programas" }, visibles.map(fila))
    : vacio(buscar ? "Ningún programa coincide con la búsqueda."
      : !lista.length ? (soloDocente ? "Todavía no tienes programas a tu cargo." : "Todavía no hay programas de curso.")
        : "No hay programas en este grupo."));
}

// La tarjeta muestra a lo sumo dos versiones: la vigente y la que está en trabajo.
// Las demás quedan en el historial del programa ("y N anteriores").
function fila(p) {
  const principal = p.abierta || p.vigente || p.versiones[0];
  const visibles = [p.vigente, p.abierta].filter(Boolean);
  if (!visibles.length) visibles.push(p.versiones[0]);
  const resto = p.versiones.length - visibles.length;
  return h("li", { class: "v-programa-fila" },
    h("div", { class: "v-programa-fila__info" },
      h("a", { class: "v-programa-fila__titulo", href: enlace(principal) }, `${p.codigo} · ${p.asignatura}`),
      h("span", { class: "v-tarea__dato" }, [p.sede, p.modalidad].filter(Boolean).join(" · ")),
      h("span", { class: "v-tarea__dato" }, p.vigente ? `Vigente: versión ${p.vigente.numero} (${p.vigente.periodo})` : "Sin versión vigente")),
    h("div", { class: "v-programa-fila__versiones" },
      h("ul", { class: "v-versiones", "aria-label": `Versiones de ${p.codigo}` }, visibles.map((v) => h("li", {},
        h("a", { class: "v-version-chip", href: enlace(v) },
          h("span", {}, `Versión ${v.numero} · ${v.periodo}`),
          h("span", { class: `v-chip v-chip--${claseEstadoPrograma(v.estado)}` }, etiquetaEstadoPrograma(v.estado)))))),
      resto > 0 ? h("a", { class: "v-programa-fila__mas", href: `${enlace(principal)}#historial`,
        "aria-label": `Historial de versiones de ${p.codigo}: ${resto} ${resto === 1 ? "versión anterior" : "versiones anteriores"}` },
        `y ${resto} ${resto === 1 ? "anterior" : "anteriores"}`) : null));
}
