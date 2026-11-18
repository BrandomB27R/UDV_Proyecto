// Tareas (coordinación): publicadas, borradores y canceladas, con el botón "Nueva tarea".
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { chipEstado, etiquetaTipo, plazo, fechaCorta } from "../formato.js";
import { vacio, pestanas, todasLasPaginas, sinAcceso, textoDeError } from "../componentes.js";
import { requerirSesion } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "tareas");
tituloPestana("Tareas");

const GRUPOS = [
  { id: "published", texto: "Publicadas", vacio: "No hay tareas publicadas." },
  { id: "draft", texto: "Borradores", vacio: "No hay borradores." },
  { id: "cancelled", texto: "Canceladas", vacio: "No hay tareas canceladas." },
];

const SIN_PERMISO = "«Tareas» es de coordinación: ahí se crean las tareas y se sigue su avance.";
if (!(yo.roles || []).includes("coordinator")) await sinAcceso(raiz, "Tareas", SIN_PERMISO);
let tareas;
let tipos = new Map();
try {
  const [t, ty] = await Promise.all([todasLasPaginas(api, "/tasks"), api("/task-types?per_page=100")]);
  tareas = t.data || [];
  for (const x of ty?.data || []) tipos.set(x.id, x);
} catch (e) {
  await sinAcceso(raiz, "Tareas", textoDeError(e, SIN_PERMISO));
}

// Avance de las publicadas: summary.by_status de cada una (una llamada por tarea).
const avances = new Map();
await Promise.all(tareas.filter((t) => t.status === "published").map(async (t) => {
  try { avances.set(t.id, (await api(`/tasks/${t.id}/assignments?per_page=1`)).summary); } catch { /* sin avance */ }
}));

const deHash = GRUPOS.find((g) => `#${g.id}` === location.hash);
let activa = (deHash || GRUPOS.find((g) => tareas.some((t) => t.status === g.id)) || GRUPOS[0]).id;
const lista = h("div", { role: "tabpanel" });
const puedeCrear = (yo.roles || []).includes("coordinator");

poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("div", { class: "v-cabecera", style: "gap: 8px" },
      h("h1", { class: "v-h1" }, "Tareas"),
      h("p", { class: "v-texto", style: "color: var(--v-muted-2)" }, "Las tareas que la coordinación asigna a los docentes y cómo van.")),
    puedeCrear ? h("a", { class: "v-btn", href: RUTAS.nuevaTarea }, "Nueva tarea") : null),
  h("section", { class: "v-card", "aria-label": "Tareas por estado" },
    pestanas(GRUPOS.map((g) => ({ id: g.id, texto: g.texto, n: tareas.filter((t) => t.status === g.id).length })), activa, (id) => {
      activa = id;
      history.replaceState(null, "", `#${id}`);
      pintar();
    }, "Tareas por estado"),
    lista));
pintar();

function pintar() {
  const g = GRUPOS.find((x) => x.id === activa);
  lista.setAttribute("aria-labelledby", `pest-${g.id}`);
  const filas = tareas.filter((t) => t.status === g.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  poner(lista, filas.length ? h("ul", { class: "v-tareas" }, filas.map(fila))
    : vacio(g.vacio, g.id !== "cancelled" && puedeCrear ? { texto: "Crear una tarea", href: RUTAS.nuevaTarea } : null));
}

function fila(t) {
  const tipo = tipos.get(t.type_id);
  const s = avances.get(t.id);
  const datos = [];
  if (t.course_code) datos.push([`${t.course_code} · ${t.course_name || ""}`.trim(), t.period_code].filter(Boolean).join(" · "));
  if (t.status === "published" && s) {
    const total = Number(s.total) || 0;
    const fin = (Number(s.by_status?.approved) || 0) + (Number(s.by_status?.closed) || 0);
    const espera = (Number(s.by_status?.submitted) || 0) + (Number(s.by_status?.under_review) || 0);
    datos.push(`${fin} de ${total} terminadas`);
    if (espera) datos.push(`${espera} por revisar`);
  }
  datos.push(`Fecha límite: ${plazo(t.due_date, { terminada: t.status !== "published" }).texto}`);
  datos.push(t.created_by === yo.id ? "Creada por ti" : `Creada por ${t.created_by_name || "coordinación"}`);
  if (t.status === "draft") datos.push(`Guardada ${fechaCorta(t.updated_at || t.created_at)}`);
  return h("li", { class: "v-tarea" },
    h("a", { class: "v-tarea__enlace", href: `/app/tarea.html?id=${encodeURIComponent(t.id)}` },
      h("span", { class: "v-tarea__cab" },
        h("span", { class: "v-eyebrow" }, tipo ? tipo.name : etiquetaTipo("")),
        chipEstado(t.status)),
      h("span", { class: "v-tarea__titulo" }, t.title),
      h("span", { class: "v-tarea__dato" }, datos.join(" · "))));
}
