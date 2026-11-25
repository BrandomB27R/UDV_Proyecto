import unittest

import re
from datetime import datetime

from g5_programas import pdf_service
from g5_programas.pdf_service import _pdf_text, build_pdf


def _textos(flowables):
    """Texto de los párrafos y celdas de una lista de elementos del documento."""
    salida = []
    for f in flowables:
        if hasattr(f, "_cellvalues"):
            for fila in f._cellvalues:
                salida.extend(_textos([c for c in fila if not isinstance(c, str)]))
                salida.extend(c for c in fila if isinstance(c, str))
        elif hasattr(f, "_content"):
            salida.extend(_textos(f._content))
        elif hasattr(f, "getPlainText"):
            salida.append(f.getPlainText())
    return salida


VERSION = {
    "numero_version": 2, "estado": "authorized", "nombre": "Programación Web",
    "secciones": {
        "general": {"contenido": {"codigo": "ISW-301", "asignatura": "Programación Web",
                                  "periodo_id": 1, "unidad_academica_id": 1, "area_id": 1,
                                  "nivel": "licenciatura", "horas": 4.0, "ciclo": "2026-1"}},
        "descripcion": {"contenido": {"texto": "Diseño & desarrollo <b>web</b>."}},
        "metodologia": {"contenido": {"texto": ""}},
        "prerrequisitos": {"contenido": [{"curso_id": 4, "orden": 1, "tipo": "obligatorio",
                                          "codigo": "ISW-101", "nombre": "Programación I"}]},
        "contenidos": {"contenido": [
            {"orden": 1, "titulo": "Fundamentos", "horas": 12.0, "items": [
                {"programa_unidad_id": 5, "orden": 1, "item": "HTTP", "descripcion": "Métodos",
                 "actividad": None, "evidencia": None, "punteo": None}]}]},
        "evaluacion": {"contenido": [
            {"orden": 1, "nombre": "Parcial", "descripcion": "", "ponderacion": 40.0, "semana": 8},
            {"orden": 2, "nombre": "Proyecto", "descripcion": "", "ponderacion": 60.0, "semana": 16}]},
        "responsables": {"contenido": {"docente_responsable_id": 3, "docente": "Diana Pérez",
                                       "revisor": "Rosa Revisora", "autoridad": ""}},
    },
}


class DocumentoTests(unittest.TestCase):
    def setUp(self):
        self.estilos = pdf_service._estilos()

    def test_el_pdf_se_genera_con_pie_y_varias_secciones(self):
        pdf = build_pdf({"id": 1, "asignatura": "Programación Web", "sede": "Sede Central"},
                        VERSION, {"id": 9, "creado_en": datetime(2026, 11, 18, 4, 5)})
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreaterEqual(len(re.findall(rb"/Type\s*/Page[^s]", pdf)), 1)

    def test_no_se_imprimen_llaves_internas(self):
        for campo in ("id", "curso_id", "programa_unidad_id", "orden", "docente_responsable_id"):
            self.assertTrue(pdf_service._es_interno(campo), campo)
        for campo in ("codigo", "nombre", "descripcion", "ponderacion"):
            self.assertFalse(pdf_service._es_interno(campo), campo)
        textos = " ".join(_textos(pdf_service._prerrequisitos(
            VERSION["secciones"]["prerrequisitos"]["contenido"], self.estilos)))
        self.assertIn("ISW-101", textos)
        self.assertIn("Obligatorio", textos)
        self.assertNotIn("Curso Id", textos)
        self.assertNotIn("Orden", textos)

    def test_contenidos_por_unidad_sin_columnas_vacias(self):
        textos = " ".join(_textos(pdf_service._contenidos(
            VERSION["secciones"]["contenidos"]["contenido"], self.estilos)))
        self.assertIn("Unidad 1. Fundamentos · 12 horas", textos)
        self.assertIn("HTTP", textos)
        self.assertNotIn("Actividad", textos)      # ninguna fila la trae: la columna no sale
        self.assertNotIn("Puntos", textos)

    def test_evaluacion_suma_el_total(self):
        textos = " ".join(_textos(pdf_service._evaluacion(
            VERSION["secciones"]["evaluacion"]["contenido"], self.estilos)))
        self.assertIn("40 puntos", textos)
        self.assertIn("100 puntos", textos)
        self.assertNotIn("Descripción", textos)    # todas vacías: la columna no sale

    def test_secciones_vacias_no_generan_nada(self):
        self.assertEqual(pdf_service._texto_de({"texto": "  "}), "")
        self.assertEqual(pdf_service._competencias([], self.estilos), [])
        self.assertEqual(pdf_service._bibliografia(None, self.estilos), [])

    def test_responsables_solo_los_que_tienen_nombre(self):
        textos = _textos(pdf_service._responsables(
            VERSION["secciones"]["responsables"]["contenido"], self.estilos))
        self.assertIn("Diana Pérez", textos)
        self.assertIn("Revisión", textos)
        self.assertNotIn("Autorización", textos)

    def test_la_fecha_de_autorizacion_va_en_hora_de_guatemala(self):
        # 18-nov 04:05 UTC es 17-nov 22:05 en Guatemala.
        self.assertEqual(pdf_service._fecha_larga(datetime(2026, 11, 18, 4, 5)),
                         "17 de noviembre de 2026")


class PdfTextTests(unittest.TestCase):
    def test_html_entities_are_decoded_before_pdf_markup_escaping(self):
        self.assertEqual(
            _pdf_text("R&D &amp; Química"),
            "R&amp;D &amp; Química",
        )

    def test_pdf_text_escapes_markup_and_serializes_lists(self):
        self.assertEqual(
            _pdf_text([{"referencia": "<Manual>"}]),
            '[{"referencia": "&lt;Manual&gt;"}]',
        )


if __name__ == "__main__":
    unittest.main()


class SinPrerrequisitosTests(unittest.TestCase):
    """La declaración «sin prerrequisitos» se imprime; una lista vacía sin declarar, no."""

    def _parrafos(self, seccion):
        from unittest import mock
        version = {**VERSION, "secciones": {**VERSION["secciones"], "prerrequisitos": seccion}}
        vistos, original = [], pdf_service.Paragraph

        def espia(texto, *a, **k):
            vistos.append(str(texto))
            return original(texto, *a, **k)

        with mock.patch.object(pdf_service, "Paragraph", espia):
            self.assertTrue(build_pdf({"id": 1}, version).startswith(b"%PDF"))
        return " | ".join(vistos)

    def test_declarado_sale_en_el_documento(self):
        texto = self._parrafos({"contenido": [], "sin_prerrequisitos": True})
        self.assertIn("Prerrequisitos", texto)
        self.assertIn("Este curso no tiene prerrequisitos.", texto)

    def test_lista_vacia_sin_declarar_no_imprime_la_seccion(self):
        texto = self._parrafos({"contenido": [], "sin_prerrequisitos": False})
        self.assertNotIn("Prerrequisitos", texto)

    def test_con_cursos_no_se_imprime_la_declaracion(self):
        texto = self._parrafos(VERSION["secciones"]["prerrequisitos"])
        self.assertIn("Prerrequisitos", texto)
        self.assertNotIn("no tiene prerrequisitos", texto)
