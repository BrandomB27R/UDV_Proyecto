// Por revisar (revisión y coordinación): la cola de /review-queue.
// Primero las que ya se tomaron (under_review), luego las más antiguas.
import { api } from "../api.js";
import { montarBarra } from "../barra.js";
import { tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { aInstante, nombreCompleto } from "../formato.js";
import { filaAsignacion, vacio, todasLasPaginas, sinAcceso, textoDeError } from "../componentes.js";
import { requerirSesion, tienePermiso } from "../sesion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
montarBarra(yo, "por-revisar");
tituloPestana("Por revisar");

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const cuando = (x) => aInstante(x.submitted_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
const orden = (a, b) => (a.status === b.status ? cuando(a) - cuando(b) : a.status === "under_review" ? -1 : 1);

const SIN_PERMISO = "«Por revisar» es para revisión, coordinación y administración.";
if (!(yo.roles || []).some((r) => ["reviewer", "coordinator", "admin"].includes(r))) await sinAcceso(raiz, "Por revisar", SIN_PERMISO);
let cola;
try {
  cola = await todasLasPaginas(api, "/review-queue");
} catch (e) {
  await sinAcceso(raiz, "Por revisar", textoDeError(e, SIN_PERMISO));
}

// La cola no dice quién es el revisor designado: se consulta el detalle de cada una
// (viewer.is_reviewer) para separar lo que le toca a quien mira (ver NOTAS_BACKEND.md).
const items = cola.data || [];
const detalles = await Promise.all(items.map((x) => api(`/assignments/${x.id}`).catch(() => null)));
const nombres = new Map();
if (tienePermiso(yo, "users.read")) {
  try {
    const u = await todasLasPaginas(api, "/users");
    for (const x of u.data || []) nombres.set(x.id, nombreCompleto(x));
  } catch { /* sin nombres: se dice "otra persona" */ }
}

const mias = [];
const otras = [];
items.forEach((x, i) => {
  const d = detalles[i];
  const puedeAprobar = (yo.roles || []).includes("authority") && x.status === "under_review";
  if (!d || d.viewer?.is_reviewer || puedeAprobar) mias.push(x);
  else otras.push({ ...x, teacher: `${x.teacher} · revisa ${nombres.get(d.reviewer_id) || "otra persona"}` });
});
mias.sort(orden);
otras.sort(orden);

const tomadas = mias.filter((x) => x.status === "under_review").length;
const nuevas = mias.filter((x) => x.status === "submitted").length;
const partes = [];
if (nuevas) partes.push(`Tienes ${plural(nuevas, "entrega por revisar", "entregas por revisar")}`);
if (tomadas) partes.push(`${plural(tomadas, "revisión en curso", "revisiones en curso")}`);

poner(raiz,
  h("div", { class: "v-cabecera" },
    h("h1", { class: "v-h1" }, "Por revisar"),
    h("p", { class: "v-texto", style: "color: var(--v-muted-2)" },
      partes.length ? `${partes.join(" y ")}.` : "No tienes entregas por revisar.")),
  h("section", { class: "v-card", "aria-labelledby": "t-mias" },
    h("h2", { id: "t-mias", class: "v-h2" }, "Te tocan a ti"),
    h("p", { class: "v-nota" }, "Primero las que ya tomaste; luego las entregas más antiguas."),
    mias.length ? h("ul", { class: "v-tareas" }, mias.map(filaAsignacion)) : vacio("No hay entregas esperando tu revisión.")),
  otras.length ? h("details", { class: "v-card v-plegable" },
    h("summary", { class: "v-h2" }, `Las revisa otra persona (${otras.length})`),
    h("p", { class: "v-nota" }, "Tienen un revisor designado. Puedes verlas y comentarlas, pero no revisarlas."),
    h("ul", { class: "v-tareas" }, otras.map(filaAsignacion))) : null);
