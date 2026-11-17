// =====================================================
// PANTALLA DE LA BANDEJA DE REVISIÓN
// Solo dibuja lo que responde GET /api/v1/review-queue. Quién ve qué tarea,
// el orden y los filtros los decide la API, no esta pantalla.
// Las acciones (tomar, aprobar, devolver) siguen en detalle.html.
// =====================================================

const BASE = "/api/v1";

const nombresEstado = {
  submitted: "Entregada",
  under_review: "En revisión",
  returned: "Devuelta",
  approved: "Aprobada",
  closed: "Cerrada",
};
const nombresPrioridad = { urgent: "Urgente", high: "Alta", medium: "Media", low: "Baja" };

const el = (id) => document.getElementById(id);

// Todo dato que se meta en innerHTML debe pasar por aquí.
function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const traducir = (diccionario, clave) => diccionario[clave] ?? clave ?? "—";
const claseBadge = (estado) => "badge-" + String(estado).replace(/_/g, "-");

// Horas que manda la API (UTC) -> hora de Guatemala, como pidió el PM.
// Si una hora llegara sin zona ("2026-11-15T16:41"), se toma como UTC.
function horaGuatemala(valor) {
  const texto = String(valor);
  const conZona = /(Z|[+-]\d{2}:?\d{2})$/.test(texto) ? texto : texto + "Z";
  const fecha = new Date(conZona);
  if (Number.isNaN(fecha.getTime())) return texto;
  return fecha.toLocaleString("es-GT", { timeZone: "America/Guatemala" });
}

// Fechas límite: son solo fecha (sin hora), no se convierten de zona.
// "2026-12-15" -> "15/12/2026".
function fechaSola(texto) {
  const [a, m, d] = String(texto).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// Estado de la consulta: se conserva aunque falle una carga
const consulta = { q: "", status: "pending", page: 1, per_page: 5 };

// ---------- Tarjeta ----------

function crearTarjeta(a) {
  const enlace = `detalle.html?id=${encodeURIComponent(a.id)}`;
  const datos = [
    a.submitted_at ? `Entregada: ${escapar(horaGuatemala(a.submitted_at))}` : null,
    a.attempt ? `Intento ${escapar(a.attempt)}` : null,
    a.files != null ? `${escapar(a.files)} ${a.files === 1 ? "archivo" : "archivos"}` : null,
    a.due_at ? `Vence: ${escapar(fechaSola(a.due_at))}` : null,
  ].filter(Boolean);
  return `
    <article class="udv-card inbox-tarjeta" style="cursor:pointer" onclick="location.href='${enlace}'">
      <p class="udv-card__category">${escapar(a.task_type)}</p>
      <h3 class="udv-card__title"><a href="${enlace}" style="color:inherit;text-decoration:none;">${escapar(a.title)}</a></h3>
      <p style="margin:.25rem 0 .5rem;">Docente: <strong>${escapar(a.teacher)}</strong></p>
      <div class="inbox-tarjeta__detalles">
        <span class="udv-badge ${claseBadge(a.status)}">${escapar(traducir(nombresEstado, a.status))}</span>
        <span>Prioridad: ${escapar(traducir(nombresPrioridad, a.priority))}</span>
        ${datos.map((d) => `<span>${d}</span>`).join("")}
      </div>
    </article>`;
}

// ---------- Pantalla ----------

function mostrarAviso(html, tipo) {
  el("aviso").innerHTML = html ? `<div class="udv-alert udv-alert-${tipo}" role="${tipo === "danger" ? "alert" : "status"}">${html}</div>` : "";
}

function mostrarPaginacion(r) {
  const paginas = Math.max(1, Math.ceil(r.total / r.per_page));
  el("pagina-actual").textContent = `Página ${r.page} de ${paginas}`;
  el("pagina-anterior").disabled = r.page <= 1;
  el("pagina-siguiente").disabled = r.page >= paginas;
  el("paginacion").hidden = r.total === 0;
}

function mostrar(r) {
  el("total-por-revisar").textContent = r.summary.submitted;
  el("total-en-revision").textContent = r.summary.under_review;
  el("resultado").textContent = `${r.total} ${r.total === 1 ? "entrega" : "entregas"}`;
  mostrarPaginacion(r);
  if (r.total === 0) {
    el("lista").innerHTML = "";
    mostrarAviso(consulta.status === "pending" && !consulta.q
      ? "No tienes entregas pendientes de revisar."
      : "No hay entregas que coincidan con la búsqueda.", "info");
    return;
  }
  mostrarAviso("", "info");
  el("lista").innerHTML = r.data.map(crearTarjeta).join("");
}

// Si la carga falla, se avisa y NO se borra lo que ya estaba en pantalla
// ni lo que el usuario escribió en los filtros.
async function cargar() {
  const parametros = new URLSearchParams(consulta);
  try {
    // no-store: al volver con "Atrás", Chrome reutiliza respuestas guardadas y
    // mostraría la bandeja como estaba antes de tomar o aprobar una entrega.
    const respuesta = await fetch(`${BASE}/review-queue?${parametros}`, {
      headers: Sesion.encabezados(),
      cache: "no-store",
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const error = new Error(Sesion.mensajeDeError(datos, respuesta.status));
      error.status = respuesta.status;
      throw error;
    }
    mostrar(datos);
  } catch (error) {
    if (error.status === 403) {
      mostrarAviso(`${escapar(error.message)}. <a href="inbox.html">Ir a mi inbox</a>.`, "warning");
      return;
    }
    mostrarAviso(`<span>No se pudo cargar la bandeja: ${escapar(error.message)}. Tus filtros se conservaron.</span>
      <button type="button" class="btn-udv btn-udv-primary btn-udv-sm" id="reintentar">Reintentar</button>`, "danger");
  }
}

// ---------- Eventos ----------

let temporizador;
el("buscar").addEventListener("input", (e) => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { consulta.q = e.target.value; consulta.page = 1; cargar(); }, 150);
});
el("filtro-estado").addEventListener("change", (e) => { consulta.status = e.target.value; consulta.page = 1; cargar(); });
el("por-pagina").addEventListener("change", (e) => { consulta.per_page = Number(e.target.value); consulta.page = 1; cargar(); });
el("pagina-anterior").addEventListener("click", () => { consulta.page -= 1; cargar(); });
el("pagina-siguiente").addEventListener("click", () => { consulta.page += 1; cargar(); });
el("aviso").addEventListener("click", (e) => { if (e.target.id === "reintentar") cargar(); });

// Al volver con "Atrás" desde el detalle, el navegador restaura la página
// guardada sin pedir datos: se recarga para no mostrar contadores viejos.
window.addEventListener("pageshow", (e) => { if (e.persisted) cargar(); });

cargar();
