// Inicio según el perfil (mockups vinci-inicio-docente y vinci-inicio-coordinacion):
// un título con lo que toca, contadores y las tablas de lo que hay que hacer.
// Docente: js/inicio/docente.js. Coordinación, revisión y dirección: js/inicio/coordinacion.js.
// Con los dos perfiles se muestra primero lo de coordinación y debajo las tareas propias.
import { montarBarra, secciones } from "../barra.js";
import { tituloPestana } from "../config.js";
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

// «Esto es un resumen…»: enlaces a las secciones con el detalle que este perfil tiene en la barra.
const DETALLE = ["por-revisar", "tareas", "mis-tareas", "panel"];
const enlacesDetalle = secciones(yo).filter((s) => DETALLE.includes(s.id));
const conY = (els) => els.flatMap((el, i) => [i === 0 ? null : i === els.length - 1 ? " y " : ", ", el]).filter(Boolean);
const lineaResumen = enlacesDetalle.length ? h("p", { class: "ini-aviso-resumen" },
  "Esto es un resumen de lo más urgente. El detalle completo está en ",
  conY(enlacesDetalle.map((s) => h("a", { href: s.href }, s.texto))), ".") : null;

poner(raiz,
  h("div", { class: "v-cabecera v-cabecera--accion" },
    h("div", { class: "v-cabecera", style: "gap: 8px" },
      h("p", { class: "ini-hola" }, `Hola, ${yo.nombres || yo.nombre}`),
      h("h1", { class: "v-h1" }, titulos.length ? titulos.join(" ") : p.administracion ? "Consulta el panel, los catálogos y la auditoría." : "No tienes nada pendiente por hoy."),
      lineaResumen),
    gestion?.accion || null),
  errores,
  contadores.length ? h("section", { class: "v-indicadores ini-indicadores", "aria-label": "Resumen" }, contadores) : null,
  gestion?.bloques || [],
  docente?.bloques || []);
