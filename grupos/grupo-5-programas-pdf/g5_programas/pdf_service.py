"""Arma el PDF institucional del programa a partir de sus datos y secciones.

El documento se lee como un programa de curso, no como un volcado de datos:
encabezado con el escudo, datos generales, y cada sección con su propia forma
(texto, lista o tabla). No se imprimen identificadores internos (`*_id`,
`orden`) ni secciones vacías.
"""

import json
from datetime import datetime, timedelta, timezone
from html import unescape
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

AZUL = colors.HexColor("#001D4A")
DORADO = colors.HexColor("#A67C1E")
GRIS_TEXTO = colors.HexColor("#4A5361")
GRIS_LINEA = colors.HexColor("#C9CFD8")
FONDO_ETIQUETA = colors.HexColor("#EEF2F7")
ANCHO_UTIL = A4[0] - 36 * mm

# El escudo vive en la carpeta del grupo; si falta, el documento sale sin imagen.
ESCUDO = Path(__file__).resolve().parent.parent / "frontend" / "assets" / "udv-logo.jpg"

MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre")
ESTADOS = {
    "draft": "Borrador",
    "submitted": "Enviado a revisión",
    "under_review": "En revisión",
    "returned": "Devuelto",
    "approved": "Aprobado",
    "authorized": "Autorizado",
    "superseded": "Reemplazado por una versión posterior",
}
TIPOS = {
    "general": "General", "especifica": "Específica", "obligatorio": "Obligatorio",
    "sugerido": "Sugerido", "basica": "Básica", "complementaria": "Complementaria",
    "licenciatura": "Licenciatura", "tecnico": "Técnico", "maestria": "Maestría",
}
# Campos que nunca se imprimen: son llaves internas de la base, no contenido.
CAMPOS_INTERNOS = ("orden",)


def _pdf_text(value) -> str:
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    return escape(unescape(str(value if value is not None else "")))


def flatten_data(value, prefix=""):
    """Pone los datos anidados en una lista de campos fácil de imprimir."""
    if isinstance(value, dict):
        flattened = {}
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else key
            flattened.update(flatten_data(child, path))
        return flattened
    if isinstance(value, list):
        flattened = {}
        for index, child in enumerate(value):
            flattened.update(flatten_data(child, f"{prefix}[{index}]"))
        return flattened
    return {prefix: value} if prefix else {}


# ------------------------------------------------------------------ utilidades
def _vacio(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip()) or value in ([], {})


def _es_interno(campo: str) -> bool:
    return campo in CAMPOS_INTERNOS or campo == "id" or campo.endswith("_id")


def _numero(value) -> str:
    """12.0 -> '12'; 12.5 -> '12.5'."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return str(value)
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def _tipo(value) -> str:
    texto = str(value or "").strip()
    return TIPOS.get(texto.lower(), texto.capitalize())


def _fecha_larga(value) -> str:
    """Fecha en hora de Guatemala (la base guarda UTC): '17 de noviembre de 2026'."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    if not isinstance(value, datetime):
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    local = value.astimezone(timezone(timedelta(hours=-6)))
    return f"{local.day} de {MESES[local.month - 1]} de {local.year}"


def _contenido(version, seccion):
    data = version.get("secciones", {}).get(seccion)
    return data.get("contenido") if isinstance(data, dict) else None


def _lista(value) -> list:
    return [fila for fila in value if isinstance(fila, dict)] if isinstance(value, list) else []


def _ordenadas(filas: list) -> list:
    return sorted(filas, key=lambda fila: (fila.get("orden") is None, fila.get("orden") or 0))


# --------------------------------------------------------------------- estilos
def _estilos():
    base = getSampleStyleSheet()
    return {
        "institucion": ParagraphStyle("institucion", parent=base["Normal"], fontName="Helvetica-Bold",
                                      fontSize=12, leading=15, textColor=AZUL),
        "facultad": ParagraphStyle("facultad", parent=base["Normal"], fontSize=9.5, leading=12,
                                   textColor=GRIS_TEXTO),
        "documento": ParagraphStyle("documento", parent=base["Normal"], fontName="Helvetica-Bold",
                                    fontSize=8.5, leading=11, textColor=DORADO, alignment=TA_RIGHT),
        "titulo": ParagraphStyle("titulo", parent=base["Normal"], fontName="Helvetica-Bold",
                                 fontSize=20, leading=24, textColor=AZUL, spaceBefore=6 * mm,
                                 spaceAfter=1 * mm),
        "subtitulo": ParagraphStyle("subtitulo", parent=base["Normal"], fontSize=10.5, leading=14,
                                    textColor=GRIS_TEXTO, spaceAfter=5 * mm),
        "seccion": ParagraphStyle("seccion", parent=base["Normal"], fontName="Helvetica-Bold",
                                  fontSize=11.5, leading=15, textColor=AZUL, spaceBefore=6 * mm,
                                  spaceAfter=2 * mm),
        "unidad": ParagraphStyle("unidad", parent=base["Normal"], fontName="Helvetica-Bold",
                                 fontSize=10, leading=13, textColor=AZUL, spaceBefore=3 * mm,
                                 spaceAfter=1.5 * mm),
        "texto": ParagraphStyle("texto", parent=base["Normal"], fontSize=9.5, leading=13.5),
        "celda": ParagraphStyle("celda", parent=base["Normal"], fontSize=9, leading=12),
        "celda_fuerte": ParagraphStyle("celda_fuerte", parent=base["Normal"],
                                       fontName="Helvetica-Bold", fontSize=9, leading=12),
        "etiqueta": ParagraphStyle("etiqueta", parent=base["Normal"], fontName="Helvetica-Bold",
                                   fontSize=8.5, leading=11, textColor=AZUL),
        "encabezado": ParagraphStyle("encabezado", parent=base["Normal"], fontName="Helvetica-Bold",
                                     fontSize=8.5, leading=11, textColor=colors.white),
        "numero": ParagraphStyle("numero", parent=base["Normal"], fontSize=9, leading=12,
                                 alignment=TA_RIGHT),
        "firma": ParagraphStyle("firma", parent=base["Normal"], fontSize=9, leading=12,
                                alignment=TA_CENTER),
        "firma_rol": ParagraphStyle("firma_rol", parent=base["Normal"], fontSize=8, leading=10,
                                    textColor=GRIS_TEXTO, alignment=TA_CENTER),
    }


def _p(value, estilo):
    return Paragraph(_pdf_text(value).replace("\n", "<br/>"), estilo)


def _tabla(encabezados, filas, anchos, estilos, numericas=()):
    """Tabla con encabezado azul que se repite al cambiar de página."""
    datos = [[Paragraph(_pdf_text(e), estilos["encabezado"]) for e in encabezados]]
    for fila in filas:
        datos.append([
            celda if hasattr(celda, "wrap")
            else _p(celda, estilos["numero"] if i in numericas else estilos["celda"])
            for i, celda in enumerate(fila)
        ])
    tabla = Table(datos, colWidths=anchos, repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), AZUL),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, GRIS_LINEA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return tabla


def _anchos(*proporciones):
    total = sum(proporciones)
    return [ANCHO_UTIL * p / total for p in proporciones]


# ------------------------------------------------------------------- secciones
def _encabezado(estilos):
    textos = [
        Paragraph("UNIVERSIDAD DA VINCI DE GUATEMALA", estilos["institucion"]),
        Paragraph("Facultad de Ingeniería", estilos["facultad"]),
    ]
    etiqueta = Paragraph("PROGRAMA DE CURSO", estilos["documento"])
    if ESCUDO.exists():
        fila = [[Image(str(ESCUDO), width=17 * mm, height=17 * mm), textos, etiqueta]]
        anchos = [21 * mm, ANCHO_UTIL - 21 * mm - 45 * mm, 45 * mm]
    else:
        fila = [[textos, etiqueta]]
        anchos = [ANCHO_UTIL - 45 * mm, 45 * mm]
    tabla = Table(fila, colWidths=anchos)
    tabla.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, AZUL),
    ]))
    return tabla


def _datos_generales(datos, version, estilos):
    """Ficha de dos columnas de pares etiqueta / valor; se omiten los vacíos."""
    horas = datos.get("horas") if not _vacio(datos.get("horas")) else datos.get("horas_semanales")
    pares = [
        ("Código", datos.get("codigo")),
        ("Período", datos.get("ciclo") or datos.get("periodo") or datos.get("ciclo_academico")),
        ("Programa académico", datos.get("programa") or datos.get("programa_academico")),
        ("Departamento", datos.get("departamento")),
        ("Facultad", datos.get("facultad")),
        ("Nivel", _tipo(datos.get("nivel") or datos.get("nivel_academico"))),
        ("Modalidad", datos.get("modalidad")),
        ("Sede", datos.get("sede")),
        ("Horas por semana", _numero(horas) if not _vacio(horas) else None),
        ("Créditos", _numero(datos.get("creditos")) if not _vacio(datos.get("creditos")) else None),
        ("Pensum", datos.get("pensum")),
        ("Versión", version.get("numero_version")),
    ]
    pares = [(etq, valor) for etq, valor in pares if not _vacio(valor)]
    if not pares:
        return None
    filas = []
    for i in range(0, len(pares), 2):
        fila = []
        for etq, valor in pares[i:i + 2]:
            fila += [Paragraph(etq, estilos["etiqueta"]), _p(valor, estilos["celda"])]
        fila += [""] * (4 - len(fila))
        filas.append(fila)
    tabla = Table(filas, colWidths=_anchos(22, 33, 22, 23))
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), FONDO_ETIQUETA),
        ("BACKGROUND", (2, 0), (2, -1), FONDO_ETIQUETA),
        ("GRID", (0, 0), (-1, -1), 0.4, GRIS_LINEA),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return tabla


def _texto_de(contenido) -> str:
    if isinstance(contenido, dict):
        return str(contenido.get("texto") or "").strip()
    return str(contenido or "").strip() if isinstance(contenido, str) else ""


def _prerrequisitos(contenido, estilos):
    filas = [[f.get("codigo") or "", f.get("nombre") or "", _tipo(f.get("tipo"))]
             for f in _ordenadas(_lista(contenido)) if f.get("codigo") or f.get("nombre")]
    return [_tabla(["Código", "Curso", "Tipo"], filas, _anchos(20, 60, 20), estilos)] if filas else []


def _competencias(contenido, estilos):
    filas = [[_tipo(f.get("tipo")), f.get("descripcion")]
             for f in _ordenadas(_lista(contenido)) if not _vacio(f.get("descripcion"))]
    return [_tabla(["Tipo", "Competencia"], filas, _anchos(20, 80), estilos)] if filas else []


def _perfil(contenido, estilos):
    filas = [[f.get("codigo") or "", f.get("descripcion") or "", f.get("contribucion") or ""]
             for f in _ordenadas(_lista(contenido))
             if not _vacio(f.get("descripcion")) or not _vacio(f.get("contribucion"))]
    if not filas:
        return []
    return [_tabla(["Código", "Rasgo del perfil de egreso", "Aporte de este curso"],
                   filas, _anchos(14, 43, 43), estilos)]


def _contenidos(contenido, estilos):
    """Una tabla de temas por unidad; las columnas sin datos no se imprimen."""
    bloques = []
    for numero, unidad in enumerate(_ordenadas(_lista(contenido)), 1):
        titulo = str(unidad.get("titulo") or "").strip() or f"Unidad {numero}"
        if not titulo.lower().startswith("unidad"):
            titulo = f"Unidad {numero}. {titulo}"
        if not _vacio(unidad.get("horas")):
            titulo += f" · {_numero(unidad['horas'])} horas"
        encabezado = Paragraph(_pdf_text(titulo), estilos["unidad"])
        temas = [t for t in _ordenadas(_lista(unidad.get("items"))) if not _vacio(t.get("item"))]
        if not temas:
            bloques.append(encabezado)
            continue
        columnas = [("item", "Tema", 26), ("descripcion", "Descripción", 34)]
        columnas += [c for c in (("actividad", "Actividad", 20), ("evidencia", "Evidencia", 20),
                                 ("punteo", "Puntos", 10))
                     if any(not _vacio(t.get(c[0])) for t in temas)]
        punteo = next((i for i, c in enumerate(columnas) if c[0] == "punteo"), None)
        filas = [[(_numero(t.get(c[0])) if c[0] == "punteo" and not _vacio(t.get(c[0]))
                   else (t.get(c[0]) or "")) for c in columnas] for t in temas]
        tabla = _tabla([c[1] for c in columnas], filas, _anchos(*[c[2] for c in columnas]),
                       estilos, numericas=() if punteo is None else (punteo,))
        bloques.append(KeepTogether([encabezado, tabla]) if len(temas) <= 6 else encabezado)
        if len(temas) > 6:
            bloques.append(tabla)
    return bloques


def _evaluacion(contenido, estilos):
    actividades = [f for f in _ordenadas(_lista(contenido)) if not _vacio(f.get("nombre"))]
    if not actividades:
        return []
    con_semana = any(not _vacio(f.get("semana")) for f in actividades)
    con_detalle = any(not _vacio(f.get("descripcion")) for f in actividades)
    columnas = [("nombre", "Actividad", 30)]
    if con_detalle:
        columnas.append(("descripcion", "Descripción", 40))
    if con_semana:
        columnas.append(("semana", "Semana", 12))
    columnas.append(("ponderacion", "Ponderación", 18))
    filas, total = [], 0.0
    for f in actividades:
        puntos = f.get("ponderacion")
        if isinstance(puntos, (int, float)) and not isinstance(puntos, bool):
            total += puntos
        fila = []
        for campo, _titulo, _ancho in columnas:
            valor = f.get(campo)
            if campo == "ponderacion":
                fila.append(f"{_numero(valor)} puntos" if not _vacio(valor) else "")
            elif campo == "semana":
                fila.append(_numero(valor) if not _vacio(valor) else "")
            else:
                fila.append(valor or "")
        filas.append(fila)
    cierre = [""] * len(columnas)
    cierre[0] = Paragraph("Total", estilos["celda_fuerte"])
    cierre[-1] = Paragraph(f"<b>{_pdf_text(_numero(total))} puntos</b>", estilos["numero"])
    filas.append(cierre)
    numericas = tuple(i for i, c in enumerate(columnas) if c[0] in ("semana", "ponderacion"))
    tabla = _tabla([c[1] for c in columnas], filas, _anchos(*[c[2] for c in columnas]),
                   estilos, numericas=numericas)
    tabla.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 0.8, AZUL),
                               ("BACKGROUND", (0, -1), (-1, -1), FONDO_ETIQUETA)]))
    return [tabla]


def _bibliografia(contenido, estilos):
    bloques = []
    for numero, ref in enumerate(_ordenadas(_lista(contenido)), 1):
        if _vacio(ref.get("referencia")):
            continue
        partes = [f"{numero}. {_pdf_text(ref['referencia'])}"]
        if not _vacio(ref.get("isbn")):
            partes.append(f"ISBN {_pdf_text(ref['isbn'])}.")
        if not _vacio(ref.get("url")):
            partes.append(_pdf_text(ref["url"]))
        if not _vacio(ref.get("tipo")):
            partes.append(f"<font color='#4A5361'>({_pdf_text(_tipo(ref['tipo']))})</font>")
        bloques.append(Paragraph(" ".join(partes), estilos["texto"]))
        bloques.append(Spacer(1, 1.5 * mm))
    return bloques


def _responsables(contenido, estilos):
    """Docente, revisor y autoridad con su línea de firma."""
    if not isinstance(contenido, dict):
        return []
    personas = [(contenido.get(campo), rol) for campo, rol in
                (("docente", "Docente responsable"), ("revisor", "Revisión"),
                 ("autoridad", "Autorización"))]
    personas = [(str(nombre).strip(), rol) for nombre, rol in personas if not _vacio(nombre)]
    if not personas:
        return []
    ancho = ANCHO_UTIL / len(personas)
    linea = "_" * 30
    tabla = Table(
        [[Paragraph(linea, estilos["firma"]) for _ in personas],
         [Paragraph(_pdf_text(nombre), estilos["firma"]) for nombre, _rol in personas],
         [Paragraph(rol, estilos["firma_rol"]) for _nombre, rol in personas]],
        colWidths=[ancho] * len(personas))
    tabla.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, 0), 22),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 1), (-1, -1), 1),
    ]))
    return [tabla]


def _generica(contenido, estilos):
    """Para una sección que este documento no conoce: sus campos legibles, sin llaves internas."""
    filas = []
    for campo, valor in flatten_data(contenido).items():
        hoja = campo.split(".")[-1].split("[")[0]
        if _es_interno(hoja) or _vacio(valor):
            continue
        filas.append([hoja.replace("_", " ").capitalize(), valor])
    return [_tabla(["Campo", "Contenido"], filas, _anchos(30, 70), estilos)] if filas else []


# Orden y título de las secciones del documento. `general` va en la ficha inicial.
SECCIONES = (
    ("descripcion", "Descripción del curso", None),
    ("prerrequisitos", "Prerrequisitos", _prerrequisitos),
    ("competencias", "Competencias", _competencias),
    ("perfil", "Contribución al perfil de egreso", _perfil),
    ("metodologia", "Metodología", None),
    ("contenidos", "Contenidos", _contenidos),
    ("evaluacion", "Evaluación", _evaluacion),
    ("bibliografia", "Bibliografía", _bibliografia),
    ("responsables", "Responsables", _responsables),
)


# ------------------------------------------------------------- pie de página
def _lienzo_con_pie(texto_pie: str):
    """Lienzo que escribe 'Página X de Y': el total solo se sabe al terminar."""

    class Lienzo(pdf_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._paginas = []

        def showPage(self):
            self._paginas.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._paginas)
            for estado in self._paginas:
                self.__dict__.update(estado)
                self.setStrokeColor(GRIS_LINEA)
                self.setLineWidth(0.5)
                self.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
                self.setFont("Helvetica", 7.5)
                self.setFillColor(GRIS_TEXTO)
                self.drawString(18 * mm, 9 * mm, texto_pie)
                self.drawRightString(A4[0] - 18 * mm, 9 * mm,
                                     f"Página {self._pageNumber} de {total}")
                super().showPage()
            super().save()

    return Lienzo


def build_pdf(program, version, approval=None):
    """Arma el documento y devuelve sus bytes para poder descargarlo."""
    estilos = _estilos()
    general = _contenido(version, "general")
    datos = {**(program or {}), **(general if isinstance(general, dict) else {})}
    asignatura = str(datos.get("asignatura") or version.get("nombre") or "Programa de curso")
    estado = ESTADOS.get(str(version.get("estado") or ""), "")
    autorizado = _fecha_larga((approval or {}).get("creado_en")) if approval else ""

    subtitulo = " · ".join(p for p in (
        str(datos.get("codigo") or ""),
        f"Versión {version.get('numero_version')}" if version.get("numero_version") else "",
        f"Autorizado el {autorizado}" if autorizado else estado,
    ) if p)

    story = [_encabezado(estilos), Paragraph(_pdf_text(asignatura), estilos["titulo"])]
    if subtitulo:
        story.append(Paragraph(_pdf_text(subtitulo), estilos["subtitulo"]))
    ficha = _datos_generales(datos, version, estilos)
    if ficha is not None:
        story.append(ficha)

    numero = 0
    conocidas = {"general"} | {clave for clave, _t, _f in SECCIONES}
    pendientes = list(SECCIONES) + [
        (clave, clave.replace("_", " ").capitalize(), _generica)
        for clave in version.get("secciones", {}) if clave not in conocidas
    ]
    for clave, titulo, armar in pendientes:
        contenido = _contenido(version, clave)
        if armar is None:
            texto = _texto_de(contenido)
            bloques = [_p(texto, estilos["texto"])] if texto else []
        else:
            bloques = armar(contenido, estilos)
        if not bloques:
            continue
        numero += 1
        encabezado = Paragraph(f"{numero}. {titulo}", estilos["seccion"])
        # El título nunca queda solo al final de una página.
        story.append(KeepTogether([encabezado, bloques[0]]))
        story.extend(bloques[1:])

    pie = " · ".join(p for p in (
        asignatura,
        f"Versión {version.get('numero_version')}" if version.get("numero_version") else "",
        f"Autorizado el {autorizado}" if autorizado else estado,
    ) if p)

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=20 * mm,
        title=f"Programa de curso - {asignatura}",
        author="Universidad Da Vinci de Guatemala",
    )
    document.build(story, canvasmaker=_lienzo_con_pie(pie))
    return buffer.getvalue()
