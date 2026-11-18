// Inicio según el perfil (mockups vinci-inicio-docente y vinci-inicio-coordinacion):
// un título con lo que toca, contadores y las tablas de lo que hay que hacer.
// Docente: js/inicio/docente.js. Coordinación, revisión y dirección: js/inicio/coordinacion.js.
// Con los dos perfiles se muestra primero lo de coordinación y debajo las tareas propias.
import { montarBarra } from "../barra.js";
import { RUTAS, tituloPestana } from "../config.js";
import { h, poner, mensaje } from "../dom.js";
import { requerirSesion, perfiles } from "../sesion.js";
import { inicioDocente } from "../inicio/docente.js";
import { inicioCoordinacion, lecturasDe } from "../inicio/coordinacion.js";

const raiz = document.getElementById("contenido");
const yo = await requerirSesion();
const p = perfiles(yo.roles);
montarBarra(yo, "inicio");
tituloPestana("Inicio");

const lee = lecturasDe(yo);
const conGestion = lee.cola || lee.panel;
const [gestion, docente] = await Promise.all([
  conGestion ? inicioCoordinacion(yo).catch((e) => ({ error: e })) : null,
  p.docente ? inicioDocente().catch((e) => ({ error: e })) : null,
]);

const partes = [gestion, docente].filter(Boolean);
// Con los dos perfiles, la frase del docente solo se agrega si tiene algo por hacer.
const titulos = [gestion?.titulo, docente && (!gestion || docente.porHacer) ? docente.titulo : null].filter(Boolean);
const errores = partes.filter((x) => x.error).map((x) => mensaje("error", `No se pudo cargar el inicio: ${x.error.message}`));
// Con los dos perfiles, los contadores son los de coordinación; las tareas propias van en su tabla.
const contadores = gestion?.contadores?.length ? gestion.contadores : docente?.contadores || [];

poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("div", { class: "v-cabecera", style: "gap: 8px" },
      h("p", { class: "v-eyebrow" }, `Hola, ${yo.nombres || yo.nombre}`),
      h("h1", { class: "v-h1" }, titulos.length ? titulos.join(" ") : p.administracion ? "Consulta el panel, los catálogos y la auditoría." : "No tienes nada pendiente por hoy.")),
    gestion?.accion || null),
  errores,
  contadores.length ? h("section", { class: "v-indicadores ini-indicadores", "aria-label": "Resumen" }, contadores) : null,
  gestion?.bloques || [],
  docente?.bloques || [],
  p.administracion ? h("section", { class: "v-card" },
    h("h2", { class: "v-h2" }, "Administración"),
    h("p", { class: "v-texto" }, "Panel de cumplimiento, catálogos y registro de auditoría."),
    h("div", { class: "v-acciones" },
      h("a", { class: "v-btn v-btn--sec", href: RUTAS.panel }, "Panel"),
      h("a", { class: "v-btn v-btn--sec", href: RUTAS.catalogos }, "Catálogos"),
      h("a", { class: "v-btn v-btn--sec", href: RUTAS.auditoria }, "Auditoría"))) : null);
