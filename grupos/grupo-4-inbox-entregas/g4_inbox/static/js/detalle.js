// =====================================================
// PANTALLA DE DETALLE / ENTREGA / REVISIÓN
// Conectada al backend real — igual que inbox.js, pero para una sola
// asignación, cuyo id viene en la URL: detalle.html?id=123
// =====================================================

const API_BASE = "/api/v1";

const idAsignacion = new URLSearchParams(location.search).get("id");

// Si se llegó desde la bandeja de revisión, "Volver" regresa a la bandeja
// y no al inbox (el revisor trabaja desde la bandeja).
if (new URLSearchParams(location.search).get("desde") === "revision") {
  const volver = document.getElementById("enlaceVolver");
  volver.href = "revision.html";
  volver.textContent = "← Volver a la bandeja de revisión";
}

const NOMBRE_ESTADO = {
  assigned: "Asignada", in_progress: "En progreso", submitted: "Entregada",
  under_review: "En revisión", returned: "Devuelta", approved: "Aprobada",
  closed: "Cerrada", cancelled: "Cancelada",
};

function claseBadge(estado) {
  return "badge-" + String(estado || "").replace(/_/g, "-");
}

async function apiFetch(ruta, opciones = {}) {
  const respuesta = await fetch(`${API_BASE}${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...Sesion.encabezados(), ...(opciones.headers || {}) },
  });
  const tipo = respuesta.headers.get("content-type") || "";
  const datos = tipo.includes("application/json") ? await respuesta.json() : await respuesta.text();
  if (!respuesta.ok) throw new Error(Sesion.mensajeDeError(datos, respuesta.status));
  return datos;
}

// Sube el archivo al servicio de archivos de G2 (POST /api/v1/files) y
// devuelve el id que G2 le dio en la tabla archivo. Va con FormData y SIN
// Content-Type: el navegador lo pone solo, con el separador del formulario.
async function subirArchivo(archivo) {
  const fd = new FormData();
  fd.append("file", archivo);
  const respuesta = await fetch(`${API_BASE}/files`, {
    method: "POST",
    headers: Sesion.encabezados(),
    body: fd,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(Sesion.mensajeDeError(datos, respuesta.status));
  return datos.file_id;
}

// GET /api/v1/files/{id} de G2 pide el token en el encabezado, y un enlace
// normal no lo manda: se descarga con fetch y luego se le pasa al navegador.
async function descargarArchivo(archivo) {
  ocultarAvisos();
  try {
    const respuesta = await fetch(`${API_BASE}/files/${encodeURIComponent(archivo.file_id)}`, {
      headers: Sesion.encabezados(),
    });
    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => ({}));
      throw new Error(Sesion.mensajeDeError(datos, respuesta.status));
    }
    const url = URL.createObjectURL(await respuesta.blob());
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = archivo.name;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    mostrarError(`No se pudo descargar ${archivo.name}: ${error.message}`);
  }
}

function textoTamano(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Lista de archivos, del intento más reciente al más antiguo. El reenvío no
// borra la evidencia anterior: se sigue viendo con su número de intento.
function mostrarArchivos(archivos) {
  const caja = document.getElementById("detArchivos");
  const lista = document.getElementById("listaArchivos");
  lista.innerHTML = "";
  caja.style.display = archivos.length ? "block" : "none";
  [...archivos].reverse().forEach((archivo) => {
    const fila = document.createElement("li");
    fila.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid #E5E7EB;";
    const datos = document.createElement("span");
    const partes = [
      archivo.attempt ? `Intento ${archivo.attempt}` : null,
      (archivo.mime || "").split("/").pop().toUpperCase() || null,
      textoTamano(archivo.size) || null,
      // La fecha de subida no se muestra: G2 la guarda en UTC y el resto en la
      // hora del servidor; con el docker saldría con 6 horas de diferencia.
    ].filter(Boolean);
    const nombre = document.createElement("strong");
    nombre.textContent = archivo.name;
    datos.appendChild(nombre);
    if (partes.length) datos.appendChild(document.createTextNode(` · ${partes.join(" · ")}`));
    fila.appendChild(datos);
    agregarBoton(fila, "Descargar", "btn-udv-dark btn-udv-sm", () => descargarArchivo(archivo));
    lista.appendChild(fila);
  });
}

function mostrarError(mensaje, id = "avisoError") {
  const el = document.getElementById(id);
  el.textContent = mensaje;
  el.style.display = "flex";
}

function ocultarAvisos() {
  ["avisoError", "avisoEntregaError", "avisoEntregaOk"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

// Horas que manda la API (UTC) -> hora de Guatemala, como pidió el PM.
// Si una hora llegara sin zona ("2026-11-15T16:41"), se toma como UTC.
function horaGuatemala(valor) {
  const texto = String(valor);
  const conZona = /(Z|[+-]\d{2}:?\d{2})$/.test(texto) ? texto : texto + "Z";
  const fecha = new Date(conZona);
  if (Number.isNaN(fecha.getTime())) return texto;
  return fecha.toLocaleString("es-GT", { timeZone: "America/Guatemala" });
}

function adaptarTarea(api) {
  return {
    id: api.id,
    titulo: api.title || api.task_type || `Tarea ${api.id}`,
    tipo: api.task_type || "",
    estado: api.status,
    instrucciones: api.instructions || "",
    // Observación de la última devolución (viene del historial de G3, no de
    // los comentarios: un comentario del docente no es una observación).
    devolucion: api.last_return && api.last_return.comment ? api.last_return : null,
    aprobacion: api.last_approval && api.last_approval.comment ? api.last_approval : null,
    borrador: api.draft_comment || "",
    // Quién está viendo: el docente dueño ve los botones de entregar y el
    // revisor los de revisar. Los demás (coordinación, auditoría) solo leen.
    esDestinatario: Boolean(api.viewer && api.viewer.is_assignee),
    esRevisor: Boolean(api.viewer && api.viewer.is_reviewer),
    archivos: api.files || [],
    comentarios: api.comments || [],
    historial: api.history || [],
    puedeComentar: Boolean(api.viewer && api.viewer.can_comment),
    // Por defecto true: si el backend no manda este campo (no debería
    // pasar), es más seguro seguir pidiendo evidencia que dejar de pedirla.
    requiereArchivo: api.requiere_archivo !== false,
    // Cómo se entrega según el tipo de tarea (tipo_tarea de G1, limitado a
    // lo que acepta G2): modalidad, extensiones y tamaño máximo.
    entrega: api.delivery || { mode: "ambos", extensions: ["pdf", "jpg", "jpeg", "png"], max_mb: 5, not_accepted: [] },
    versionPrograma: api.program_version || null,
  };
}

let tareaActual = null;

// ---------- Comentarios ----------

// Cada dato va con textContent, nunca con innerHTML: el texto lo escribió
// otra persona.
function itemDeLista(meta, texto) {
  const li = document.createElement("li");
  const linea = document.createElement("div");
  linea.className = "g4-lista__meta";
  linea.textContent = meta;
  li.appendChild(linea);
  if (texto) {
    const p = document.createElement("p");
    p.className = "g4-lista__texto";
    p.textContent = texto;
    li.appendChild(p);
  }
  return li;
}

function agregarComentarioALaLista(c) {
  const meta = [c.author_name || `Usuario ${c.author}`, c.at ? horaGuatemala(c.at) : null]
    .filter(Boolean).join(" · ");
  document.getElementById("listaComentarios").appendChild(itemDeLista(meta, c.text));
  document.getElementById("sinComentarios").style.display = "none";
}

function mostrarComentarios(tarea) {
  document.getElementById("listaComentarios").innerHTML = "";
  document.getElementById("sinComentarios").style.display = tarea.comentarios.length ? "none" : "block";
  tarea.comentarios.forEach(agregarComentarioALaLista);
  // Solo quien puede comentar ve la caja (auditoría solo lee).
  document.getElementById("nuevoComentario").style.display = tarea.puedeComentar ? "block" : "none";
}

async function comentar() {
  const caja = document.getElementById("textoComentario");
  const aviso = document.getElementById("avisoComentario");
  aviso.style.display = "none";
  const texto = caja.value.trim();
  if (!texto) {
    aviso.textContent = "Escribe el comentario antes de enviarlo.";
    aviso.style.display = "block";
    return;
  }
  const boton = document.getElementById("btnComentar");
  boton.disabled = true;
  try {
    const nuevo = await apiFetch(`/assignments/${tareaActual.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text: texto }),
    });
    agregarComentarioALaLista(nuevo);
    caja.value = "";
  } catch (error) {
    // El texto se queda en la caja para no perderlo.
    aviso.textContent = `No se pudo enviar el comentario: ${error.message}`;
    aviso.style.display = "block";
  } finally {
    boton.disabled = false;
  }
}

// ---------- Historial ----------

const NOMBRE_ACCION = {
  publish: "Publicada", start: "Iniciada", submit: "Entregada", resubmit: "Reenviada",
  review: "Tomada para revisión", return: "Devuelta", approve: "Aprobada",
};

function mostrarHistorial(tarea) {
  const lista = document.getElementById("listaHistorial");
  lista.innerHTML = "";
  tarea.historial.forEach((h) => {
    const accion = NOMBRE_ACCION[h.action] || NOMBRE_ESTADO[h.new_status] || h.new_status;
    const meta = [accion, h.actor, h.at ? horaGuatemala(h.at) : null].filter(Boolean).join(" · ");
    lista.appendChild(itemDeLista(meta, h.comment));
  });
  document.getElementById("detHistorial").style.display = tarea.historial.length ? "block" : "none";
}

function agregarBoton(contenedor, texto, clase, accion) {
  const btn = document.createElement("button");
  btn.className = `btn-udv ${clase}`;
  btn.textContent = texto;
  btn.onclick = accion;
  contenedor.appendChild(btn);
}

// ---------- Formulario según el tipo de tarea ----------

// Archivos ya vinculados al intento que se va a entregar. Cada entrega
// (submit o resubmit) cierra un intento: los archivos de intentos anteriores
// no cuentan para el reenvío (G3 lo rechazaría con 422).
function archivosDelIntentoActual(tarea) {
  const envios = tarea.historial.filter((h) => h.new_status === "submitted").length;
  return tarea.archivos.filter((f) => !f.attempt || f.attempt > envios);
}

// Se muestra el campo de archivo si el tipo lo exige o si su modalidad
// admite archivos; en "texto" o "programa" sin archivo obligatorio, no.
function admiteArchivos(tarea) {
  return tarea.requiereArchivo || ["archivo", "ambos"].includes(tarea.entrega.mode);
}

function textoExtensiones(extensiones) {
  return extensiones.filter((e) => e !== "jpeg").map((e) => e.toUpperCase()).join(", ");
}

function mostrarVersionPrograma(tarea) {
  const caja = document.getElementById("detPrograma");
  caja.innerHTML = "";
  if (tarea.entrega.mode !== "programa") {
    caja.style.display = "none";
    return;
  }
  caja.style.display = "block";
  const v = tarea.versionPrograma;
  const p = document.createElement("p");
  if (!v) {
    p.textContent = "Esta tarea no tiene una versión del programa enlazada. Pide a coordinación que la enlace antes de entregar.";
    caja.appendChild(p);
    return;
  }
  p.textContent = `Programa: ${v.name} · versión ${v.number} · ${NOMBRE_ESTADO_PROGRAMA[v.status] || v.status}`;
  caja.appendChild(p);
  const ayuda = document.createElement("p");
  ayuda.style.cssText = "font-size:.85rem;color:var(--udv-text-muted);";
  ayuda.textContent = "Los cambios del programa se hacen en Programas. Al entregar, esta versión queda en tu entrega.";
  caja.appendChild(ayuda);
  const enlace = document.createElement("a");
  enlace.className = "btn-udv btn-udv-dark btn-udv-sm";
  enlace.href = `/app/g5/Programa.html?program_id=${encodeURIComponent(v.program_id)}` +
    `&tarea_destinatario_origen_id=${encodeURIComponent(tarea.id)}`;
  enlace.textContent = "Abrir en Programas";
  caja.appendChild(enlace);
}

const NOMBRE_ESTADO_PROGRAMA = {
  draft: "borrador", submitted: "enviada", under_review: "en revisión", returned: "devuelta",
  approved: "aprobada", authorized: "autorizada", superseded: "reemplazada",
};

// Lista lo que se va a subir, o lo que ya está registrado en este intento.
function mostrarArchivosElegidos(tarea) {
  const info = document.getElementById("archivoInfo");
  info.innerHTML = "";
  const elegidos = [...document.getElementById("entregaArchivo").files];
  const yaVinculados = archivosDelIntentoActual(tarea);
  if (!admiteArchivos(tarea)) {
    info.textContent = "Esta tarea no requiere evidencia adjunta.";
    return;
  }
  const nombres = elegidos.length ? elegidos.map((f) => `${f.name} (${textoTamano(f.size)})`)
    : yaVinculados.map((f) => f.name);
  if (!nombres.length) {
    info.textContent = tarea.requiereArchivo ? "Selecciona la evidencia que vas a registrar." : "";
    return;
  }
  info.textContent = elegidos.length ? "Se van a subir:" : "Ya registrados en esta entrega:";
  const ul = document.createElement("ul");
  nombres.forEach((n) => { const li = document.createElement("li"); li.textContent = n; ul.appendChild(li); });
  info.appendChild(ul);
}

// Revisa cada archivo antes de subir: así el docente sabe cuál está mal
// sin esperar a que G2 lo rechace.
function validarArchivos(tarea, archivos) {
  const maximo = tarea.entrega.max_mb * 1024 * 1024;
  for (const f of archivos) {
    const extension = (f.name.split(".").pop() || "").toLowerCase();
    if (!tarea.entrega.extensions.includes(extension)) {
      return `${f.name}: solo se aceptan ${textoExtensiones(tarea.entrega.extensions)}.`;
    }
    if (f.size === 0) return `${f.name}: el archivo está vacío.`;
    if (f.size > maximo) return `${f.name}: supera el límite de ${tarea.entrega.max_mb} MB.`;
  }
  return null;
}

function mostrarFormularioEntrega(tarea) {
  document.getElementById("formEntrega").style.display = "block";
  document.getElementById("entregaComentario").value = tarea.borrador || "";
  mostrarVersionPrograma(tarea);

  const campoArchivo = document.getElementById("entregaArchivo");
  campoArchivo.value = "";
  const visible = admiteArchivos(tarea);
  const etiquetaArchivo = document.querySelector('label[for="entregaArchivo"]');
  campoArchivo.style.display = visible ? "block" : "none";
  if (etiquetaArchivo) {
    etiquetaArchivo.style.display = visible ? "block" : "none";
    etiquetaArchivo.textContent = tarea.requiereArchivo ? "Adjuntar evidencia (obligatoria)" : "Adjuntar evidencia (opcional)";
  }
  campoArchivo.accept = tarea.entrega.extensions.map((e) => "." + e).join(",");
  const nota = document.getElementById("entregaArchivoNota");
  nota.style.display = visible ? "block" : "none";
  nota.textContent = `${textoExtensiones(tarea.entrega.extensions)}, hasta ${tarea.entrega.max_mb} MB cada uno. Puedes elegir varios.`;
  if (tarea.entrega.not_accepted && tarea.entrega.not_accepted.length) {
    nota.textContent += ` Este tipo de tarea también admite ${textoExtensiones(tarea.entrega.not_accepted)}, pero el servicio de archivos todavía no los recibe.`;
  }
  campoArchivo.onchange = () => mostrarArchivosElegidos(tarea);
  mostrarArchivosElegidos(tarea);
  const botones = document.getElementById("entregaBotones");
  botones.innerHTML = "";
  // el estilo "outline" de udv.css es blanco, para fondos oscuros: aquí no se vería
  agregarBoton(botones, "Guardar borrador", "btn-udv-dark", () => guardarBorrador(tarea));
  agregarBoton(botones, tarea.estado === "returned" ? "Reenviar" : "Entregar", "btn-udv-primary", () => confirmarEntrega(tarea));
}

// GET /api/v1/assignments/{id} — carga y pinta la pantalla completa
async function cargarDetalle() {
  ocultarAvisos();
  try {
    const api = await apiFetch(`/assignments/${idAsignacion}`);
    tareaActual = adaptarTarea(api);

    document.getElementById("cargando").style.display = "none";
    document.getElementById("detalle").style.display = "block";
    document.getElementById("detTipo").textContent = tareaActual.tipo;
    document.getElementById("detTitulo").textContent = tareaActual.titulo;
    document.getElementById("detInstrucciones").textContent = tareaActual.instrucciones;

    const badge = document.getElementById("detEstadoBadge");
    badge.textContent = NOMBRE_ESTADO[tareaActual.estado] || tareaActual.estado;
    badge.className = `udv-badge ${claseBadge(tareaActual.estado)}`;

    document.getElementById("obsGroup").style.display = "none";
    document.getElementById("obs").value = "";
    document.getElementById("formEntrega").style.display = "none";

    mostrarArchivos(tareaActual.archivos);
    mostrarComentarios(tareaActual);
    mostrarHistorial(tareaActual);

    const contComentario = document.getElementById("detComentario");
    contComentario.innerHTML = "";
    if (tareaActual.estado === "returned" && tareaActual.devolucion) {
      const d = tareaActual.devolucion;
      const aviso = document.createElement("div");
      aviso.className = "udv-alert udv-alert-danger";
      const fecha = d.at ? ` (${horaGuatemala(d.at)})` : "";
      aviso.textContent = `Observación del revisor${fecha}: ${d.comment}`;
      contComentario.appendChild(aviso);
    }
    if (tareaActual.estado === "approved" && tareaActual.aprobacion) {
      const d = tareaActual.aprobacion;
      const aviso = document.createElement("div");
      aviso.className = "udv-alert udv-alert-success";
      const fecha = d.at ? ` (${horaGuatemala(d.at)})` : "";
      aviso.textContent = `Comentario del revisor al aprobar${fecha}: ${d.comment}`;
      contComentario.appendChild(aviso);
    }

    // Los botones dependen del estado Y de quién mira: al docente nunca se
    // le muestra "Tomar para revisar", ni al revisor "Entregar".
    const botones = document.getElementById("detBotones");
    botones.innerHTML = "";
    const docente = tareaActual.esDestinatario;
    const revisor = tareaActual.esRevisor;
    if (docente && tareaActual.estado === "assigned") {
      agregarBoton(botones, "Iniciar tarea", "btn-udv-primary", () => transicion(tareaActual, "start"));
    } else if (docente && (tareaActual.estado === "in_progress" || tareaActual.estado === "returned")) {
      mostrarFormularioEntrega(tareaActual);
    } else if (revisor && tareaActual.estado === "submitted") {
      agregarBoton(botones, "Tomar para revisar", "btn-udv-primary", () => transicion(tareaActual, "review"));
    } else if (docente && tareaActual.estado === "submitted") {
      botones.textContent = "Tu entrega está en espera de revisión.";
    } else if (revisor && tareaActual.estado === "under_review") {
      agregarBoton(botones, "Aprobar", "btn-udv-primary", () => aprobar(tareaActual));
      agregarBoton(botones, "Devolver", "btn-udv-gold", () => devolver(tareaActual));
      document.getElementById("obsGroup").style.display = "block";
    } else {
      botones.textContent = "Sin acciones disponibles en este estado.";
    }
  } catch (error) {
    document.getElementById("cargando").style.display = "none";
    mostrarError(`No se pudo cargar la asignación: ${error.message}`);
  }
}

async function guardarBorrador(tarea) {
  try {
    const comment = document.getElementById("entregaComentario").value.trim();
    await apiFetch(`/assignments/${tarea.id}/submission-draft`, {
      method: "PUT",
      body: JSON.stringify({ comment }),
    });
    tarea.borrador = comment;
    const ok = document.getElementById("avisoEntregaOk");
    ok.textContent = "Borrador guardado en el backend. Puedes seguir editándolo antes de entregar.";
    ok.style.display = "flex";
    document.getElementById("avisoEntregaError").style.display = "none";
  } catch (error) {
    mostrarError(error.message, "avisoEntregaError");
  }
}

// Orden de la entrega: 1) guarda el borrador, para no perder lo escrito si
// algo falla; 2) sube el archivo a G2; 3) lo vincula a la asignación con el
// id que devolvió G2; 4) pide a G3 el submit o resubmit.
async function confirmarEntrega(tarea) {
  const comentario = document.getElementById("entregaComentario").value.trim();
  const nuevos = [...document.getElementById("entregaArchivo").files];
  const aviso = document.getElementById("avisoEntregaOk");
  document.getElementById("avisoEntregaError").style.display = "none";
  aviso.style.display = "none";

  if (tarea.requiereArchivo && !archivosDelIntentoActual(tarea).length && !nuevos.length) {
    mostrarError(tarea.estado === "returned"
      ? "Para reenviar debes adjuntar la evidencia corregida."
      : "Debes seleccionar la evidencia antes de entregar.", "avisoEntregaError");
    return;
  }
  if (tarea.entrega.mode === "programa" && !tarea.versionPrograma) {
    mostrarError("No se puede entregar sin una versión del programa enlazada.", "avisoEntregaError");
    return;
  }
  const problema = validarArchivos(tarea, nuevos);
  if (problema) {
    mostrarError(problema, "avisoEntregaError");
    return;
  }
  const subidos = [];
  try {
    // El borrador va primero: lleva el comentario y, en tareas de programa,
    // la versión del programa que G3 copia a la entrega.
    await apiFetch(`/assignments/${tarea.id}/submission-draft`, {
      method: "PUT",
      body: JSON.stringify({ comment: comentario }),
    });
    for (const [i, archivo] of nuevos.entries()) {
      aviso.textContent = `Subiendo ${i + 1} de ${nuevos.length}: ${archivo.name}…`;
      aviso.style.display = "flex";
      const idArchivo = await subirArchivo(archivo);
      await apiFetch(`/assignments/${tarea.id}/files`, {
        method: "POST",
        body: JSON.stringify({ file_id: String(idArchivo), name: archivo.name }),
      });
      subidos.push(archivo.name);
    }
    const accion = tarea.estado === "returned" ? "resubmit" : "submit";
    await apiFetch(`/assignments/${tarea.id}/${accion}`, {
      method: "POST",
    });
    await cargarDetalle();
    const ok = document.getElementById("avisoEntregaOk");
    ok.textContent = accion === "resubmit" ? "Reenvío registrado correctamente." : "Entrega registrada correctamente.";
    ok.style.display = "flex";
  } catch (error) {
    aviso.style.display = "none";
    // Si algunos archivos ya se subieron, quedan en esta entrega: se dice
    // cuáles, para que el docente solo vuelva a elegir los que faltan.
    const parte = subidos.length ? ` Ya quedaron registrados: ${subidos.join(", ")}.` : "";
    if (subidos.length) await cargarDetalle();   // primero: recargar oculta los avisos
    mostrarError(`${error.message.replace(/\.$/, "")}.${parte}`, "avisoEntregaError");
  }
}

async function transicion(tarea, accion) {
  try {
    await apiFetch(`/assignments/${tarea.id}/${accion}`, {
      method: "POST",
    });
    await cargarDetalle();
  } catch (error) {
    mostrarError(error.message);
  }
}

// La observación es opcional al aprobar, pero si el revisor la escribió se
// envía: queda en el historial de G3 y el docente la ve en el detalle.
async function aprobar(tarea) {
  const comment = document.getElementById("obs").value.trim();
  try {
    await apiFetch(`/assignments/${tarea.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment: comment || null }),
    });
    await cargarDetalle();
  } catch (error) {
    mostrarError(error.message);
  }
}

async function devolver(tarea) {
  const comment = document.getElementById("obs").value.trim();
  if (!comment) {
    mostrarError("La observación es obligatoria para devolver.");
    return;
  }
  try {
    await apiFetch(`/assignments/${tarea.id}/return`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    await cargarDetalle();
  } catch (error) {
    mostrarError(error.message);
  }
}

if (!idAsignacion) {
  document.getElementById("cargando").style.display = "none";
  mostrarError("No se indicó qué asignación mostrar. Vuelve al inbox y elige una tarjeta.");
} else {
  document.getElementById("btnComentar").addEventListener("click", comentar);
  cargarDetalle();
}
