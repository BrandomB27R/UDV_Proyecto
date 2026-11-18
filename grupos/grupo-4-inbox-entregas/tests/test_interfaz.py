"""Coherencia de la pantalla (g4_inbox/static) con la API en Python y con los
estilos institucionales del PM (grupos/udv-styles/udv.css)."""
import re
from pathlib import Path

import pytest

from g4_inbox.inbox import ESTADOS_INBOX, ORDEN_PRIORIDAD_POR_DEFECTO, PER_PAGE_MAXIMO

STATIC = Path(__file__).resolve().parent.parent / "g4_inbox" / "static"
GRUPOS = STATIC.parents[2]  # .../grupos
HTML = (STATIC / "inbox.html").read_text(encoding="utf-8")
JS_PANTALLA = (STATIC / "js" / "inbox.js").read_text(encoding="utf-8")
JS_API = (STATIC / "js" / "api.js").read_text(encoding="utf-8")
UDV_CSS = GRUPOS / "udv-styles" / "udv.css"


def claves_del_objeto(js, nombre):
    cuerpo = re.search(rf"const {nombre} = \{{(.*?)\}};", js, re.S).group(1)
    return re.findall(r"(\w+)\s*:", cuerpo)


# ---------- coherencia con la API en Python ----------

def test_filtro_de_estado_ofrece_exactamente_los_estados_del_inbox():
    bloque = re.search(r'id="filtro-estado">(.*?)</select>', HTML, re.S).group(1)
    valores = [v for v in re.findall(r'value="([^"]*)"', bloque) if v]
    assert sorted(valores) == sorted(ESTADOS_INBOX)


def test_nombres_de_estado_en_pantalla_cubren_los_estados_del_inbox():
    assert sorted(claves_del_objeto(JS_PANTALLA, "nombresEstado")) == sorted(ESTADOS_INBOX)


def test_nombres_de_prioridad_cubren_las_prioridades_conocidas():
    assert sorted(claves_del_objeto(JS_PANTALLA, "nombresPrioridad")) == sorted(ORDEN_PRIORIDAD_POR_DEFECTO)


def test_la_capa_de_datos_llama_a_la_api_real_y_ya_no_trae_datos_de_prueba():
    # api.js habla con el servidor; los datos simulados (datos.js) se eliminaron.
    assert "fetch(" in JS_API
    assert "/inbox" in JS_API and "/inbox/summary" in JS_API
    assert not (STATIC / "js" / "datos.js").exists()
    assert 'src="js/datos.js"' not in HTML  # un comentario que lo mencione no cuenta


def test_las_pantallas_mandan_el_token_con_la_convencion_del_panel_de_g6():
    # El login es de G2; el token vive en sessionStorage["udv_token"] y va como
    # "Authorization: Bearer <token>", igual que g6_admin/pantallas/comun.js.
    sesion = (STATIC / "js" / "sesion.js").read_text(encoding="utf-8")
    detalle = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert '"udv_token"' in sesion and "Bearer" in sesion
    assert "Sesion.encabezados()" in JS_API and "Sesion.encabezados()" in detalle


def test_sesion_js_se_carga_antes_que_los_scripts_que_la_usan():
    detalle_html = (STATIC / "detalle.html").read_text(encoding="utf-8")
    assert HTML.index("js/sesion.js") < HTML.index("js/api.js")
    assert detalle_html.index("js/sesion.js") < detalle_html.index("js/detalle.js")


def test_el_rol_sale_del_token_no_de_un_encabezado_x_role():
    # G3 toma el rol del usuario autenticado; X-Role ya no significa nada.
    assert "X-Role" not in (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")


def test_los_errores_se_leen_en_el_formato_de_g2():
    # G2 responde {"error": {"code", "message"}}; hay que mostrar ese message.
    assert "error.message" in (STATIC / "js" / "sesion.js").read_text(encoding="utf-8")


def test_opciones_de_por_pagina_no_superan_el_maximo():
    bloque = re.search(r'id="por-pagina">(.*?)</select>', HTML, re.S).group(1)
    assert all(1 <= int(v) <= PER_PAGE_MAXIMO for v in re.findall(r'value="(\d+)"', bloque))


def test_la_pantalla_no_calcula_reglas_de_negocio():
    # El vencimiento llega de la API (due_state); la pantalla solo lo dibuja.
    assert "due_state" in JS_PANTALLA
    assert "DIAS_POR_VENCER" not in JS_PANTALLA


# ---------- coherencia con la interfaz del proyecto (udv.css) ----------

def test_importa_udv_css_con_la_ruta_correcta_dentro_del_repo():
    href = re.search(r'<link rel="stylesheet" href="([^"]*udv\.css)"', HTML).group(1)
    assert (STATIC / href).resolve() == GRUPOS / "udv-styles" / "udv.css"


def test_no_copia_los_estilos_institucionales():
    assert not list(STATIC.rglob("udv.css"))


def test_usa_las_clases_institucionales():
    for clase in ("udv-header", "udv-container", "udv-section-title", "udv-card",
                  "udv-card-light", "udv-badge", "udv-input", "udv-select",
                  "udv-label", "udv-alert", "btn-udv"):
        assert clase in HTML + JS_PANTALLA, clase


def test_inbox_css_usa_variables_udv_y_no_colores_propios():
    css = (STATIC / "css" / "inbox.css").read_text(encoding="utf-8")
    assert "var(--udv-" in css
    assert not re.search(r"font-family", css)


def test_la_clase_de_badge_se_arma_como_en_la_guia_de_estilos():
    # in_progress -> badge-in-progress (guion, no guion bajo)
    assert 'replace(/_/g, "-")' in JS_PANTALLA
    assert '"badge-"' in JS_PANTALLA


@pytest.mark.skipif(not UDV_CSS.exists(),
                    reason="udv.css llega al traer main a la rama (git merge origin/main)")
def test_cada_estado_del_inbox_tiene_su_badge_en_udv_css():
    css = UDV_CSS.read_text(encoding="utf-8")
    for estado in ESTADOS_INBOX:
        assert f".badge-{estado.replace('_', '-')}" in css, estado


@pytest.mark.skipif(not UDV_CSS.exists(),
                    reason="udv.css llega al traer main a la rama (git merge origin/main)")
def test_las_variables_udv_usadas_existen_en_udv_css():
    css = UDV_CSS.read_text(encoding="utf-8")
    propias = (STATIC / "css" / "inbox.css").read_text(encoding="utf-8")
    for variable in set(re.findall(r"var\((--udv-[\w-]+)\)", propias)):
        assert f"{variable}:" in css, variable


# ---------- menú y entrega (pedidos del PM del 13-nov) ----------

MENU_ESPERADO = {"Inicio": "/app/", "Tareas": "/app/g3/", "Programas": "/app/g5/Programa.html"}


@pytest.mark.parametrize("pantalla", ["inbox.html", "detalle.html"])
def test_el_menu_lleva_a_las_pantallas_de_los_otros_grupos(pantalla):
    html = (STATIC / pantalla).read_text(encoding="utf-8")
    enlaces = dict((texto, href) for href, texto in re.findall(r'<li><a href="([^"]*)"[^>]*>([^<]+)</a></li>', html))
    for texto, destino in MENU_ESPERADO.items():
        assert enlaces.get(texto) == destino, f"{pantalla}: {texto} -> {enlaces.get(texto)}"


def test_al_entregar_el_archivo_se_sube_a_g2_y_no_se_inventa_el_id():
    js = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert "demo-" not in js                       # antes: file_id: `demo-${id}-${Date.now()}`
    assert "new FormData()" in js and "/files`" in js
    assert "datos.file_id" in js                   # G2 responde {"file_id": ..., "nombre_interno": ...}
    # la subida va antes de vincular, y vincular antes del submit
    assert js.index("subirArchivo(archivo)") < js.index("/files`, {\n        method: \"POST\"") < js.index("const accion = tarea.estado")


def test_no_hay_botones_blancos_sobre_la_tarjeta_blanca():
    """btn-udv-outline de udv.css es texto y borde blancos: sobre fondo claro no se ve."""
    for archivo in [STATIC / "detalle.html", STATIC / "inbox.html", STATIC / "js" / "detalle.js", STATIC / "js" / "inbox.js"]:
        assert "btn-udv-outline" not in archivo.read_text(encoding="utf-8"), archivo.name


def test_los_botones_dependen_de_quien_mira():
    js = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert 'revisor && tareaActual.estado === "submitted"' in js
    assert 'docente && tareaActual.estado === "assigned"' in js


def test_la_observacion_sale_de_la_devolucion_y_no_de_los_comentarios():
    """Antes se mostraba el último comentario como 'Observación del revisor': la
    observación de G3 no llegaba y un comentario del docente salía como si fuera del revisor."""
    js = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert "api.last_return" in js
    assert "api.comments[api.comments.length - 1].text" not in js


def test_el_detalle_muestra_los_archivos_y_permite_descargarlos():
    """El revisor tiene que ver la evidencia que entregó el docente."""
    html = (STATIC / "detalle.html").read_text(encoding="utf-8")
    js = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert 'id="listaArchivos"' in html
    assert "mostrarArchivos(tareaActual.archivos)" in js
    # la descarga de G2 pide el token: tiene que ir con fetch y Sesion.encabezados()
    assert "${API_BASE}/files/${encodeURIComponent(archivo.file_id)}" in js
    assert "URL.createObjectURL" in js


def test_aprobar_envia_la_observacion_si_se_escribio():
    """Antes Aprobar no mandaba el texto del cuadro de observación y se perdía sin avisar."""
    js = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert '"Aprobar", "btn-udv-primary", () => aprobar(tareaActual)' in js
    inicio = js.index("async function aprobar(")
    assert 'getElementById("obs")' in js[inicio:inicio + 400]
    assert "api.last_approval" in js


# ---------- bandeja de revisión ----------

def test_la_bandeja_existe_y_cada_tarjeta_abre_el_detalle():
    html = (STATIC / "revision.html").read_text(encoding="utf-8")
    js = (STATIC / "js" / "revision.js").read_text(encoding="utf-8")
    assert 'src="js/sesion.js?v=' in html and 'src="js/revision.js?v=' in html
    assert "/review-queue?" in js
    assert "detalle.html?id=${encodeURIComponent(a.id)}&desde=revision" in js


def test_desde_la_bandeja_volver_regresa_a_la_bandeja():
    """El revisor trabaja desde la bandeja: el botón Volver del detalle lo regresa ahí."""
    html = (STATIC / "detalle.html").read_text(encoding="utf-8")
    assert 'id="enlaceVolver"' in html and 'href="inbox.html"' in html   # por defecto, al inbox
    js = (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")
    assert 'get("desde") === "revision"' in js and 'volver.href = "revision.html"' in js
    # el inbox no enlaza a la bandeja: ese enlace lo pone el portal
    assert "revision.html" not in (STATIC / "inbox.html").read_text(encoding="utf-8")


def test_la_bandeja_se_recarga_al_volver_con_atras():
    js = (STATIC / "js" / "revision.js").read_text(encoding="utf-8")
    assert 'addEventListener("pageshow"' in js and "e.persisted" in js
    assert 'cache: "no-store"' in js


@pytest.mark.parametrize("archivo", ["detalle.js", "revision.js"])
def test_las_horas_se_muestran_en_hora_de_guatemala(archivo):
    """Regla del PM (16-nov): la API en UTC y la pantalla convierte al mostrar."""
    js = (STATIC / "js" / archivo).read_text(encoding="utf-8")
    assert 'toLocaleString("es-GT", { timeZone: "America/Guatemala" })' in js
    assert 'texto + "Z"' in js            # si llega sin zona, se toma como UTC
    assert "formatearFecha(" not in js     # la función vieja mostraba la hora sin convertir


# ---------- pendientes aprobados por el PM el 17-nov ----------

def _detalle_js():
    return (STATIC / "js" / "detalle.js").read_text(encoding="utf-8")


def test_el_detalle_tiene_comentarios_e_historial():
    html = (STATIC / "detalle.html").read_text(encoding="utf-8")
    for id_ in ('id="listaComentarios"', 'id="textoComentario"', 'id="btnComentar"', 'id="listaHistorial"'):
        assert id_ in html
    js = _detalle_js()
    assert "mostrarComentarios(tareaActual)" in js and "mostrarHistorial(tareaActual)" in js
    assert "/comments`" in js
    # la caja de comentar depende de lo que dice la API (auditoría solo lee)
    assert "api.viewer.can_comment" in js
    # el texto de otras personas va con textContent, no con innerHTML
    inicio = js.index("function itemDeLista(")
    assert "innerHTML" not in js[inicio:js.index("function agregarComentarioALaLista(")]


def test_se_pueden_adjuntar_varios_archivos_con_los_limites_del_tipo():
    html = (STATIC / "detalle.html").read_text(encoding="utf-8")
    assert 'type="file" id="entregaArchivo" multiple' in html
    js = _detalle_js()
    assert "tarea.entrega.extensions" in js and "tarea.entrega.max_mb" in js
    assert "for (const [i, archivo] of nuevos.entries())" in js
    assert "validarArchivos(tarea, nuevos)" in js


def test_en_el_reenvio_no_cuenta_la_evidencia_del_intento_anterior():
    js = _detalle_js()
    assert "archivosDelIntentoActual(tarea).length" in js
    assert "tarea.archivo " not in js


def test_la_tarea_de_programa_enlaza_a_programas_con_la_asignacion():
    js = _detalle_js()
    assert "/app/g5/Programa.html?program_id=" in js
    assert "&tarea_destinatario_origen_id=" in js
    assert 'tarea.entrega.mode === "programa" && !tarea.versionPrograma' in js


@pytest.mark.parametrize("pantalla", ["inbox.html", "detalle.html", "revision.html"])
def test_el_menu_se_ve_en_el_telefono(pantalla):
    html = (STATIC / pantalla).read_text(encoding="utf-8")
    assert 'href="css/menu.css?v=' in html
    css = (STATIC / "css" / "menu.css").read_text(encoding="utf-8")
    assert "@media (max-width: 768px)" in css and ".udv-header__nav {" in css


@pytest.mark.parametrize("pantalla", ["inbox.html", "revision.html"])
def test_inbox_y_bandeja_tienen_boton_para_volver_al_inicio(pantalla):
    html = (STATIC / pantalla).read_text(encoding="utf-8")
    assert '<a href="/app/" class="btn-udv btn-udv-dark btn-udv-sm"' in html and "Volver al inicio" in html


def test_los_archivos_de_g4_llevan_la_misma_version_en_todas_las_pantallas():
    """Así el navegador descarga el JS y el CSS nuevos en vez de usar los guardados.
    Al cambiar un archivo, se sube la versión en las tres pantallas a la vez."""
    import re
    versiones = set()
    for pantalla in ("inbox.html", "detalle.html", "revision.html"):
        html = (STATIC / pantalla).read_text(encoding="utf-8")
        propios = re.findall(r'(?:src|href)="((?:js|css)/[^"]+)"', html)
        assert propios and all("?v=" in r for r in propios), (pantalla, propios)
        versiones |= {r.split("?v=")[1] for r in propios}
    assert len(versiones) == 1, versiones
