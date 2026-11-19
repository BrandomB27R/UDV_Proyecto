"""Pruebas de integración del PM: app completa (main.py) contra MySQL con db_udv del G1.

Cubre lo que no cubre tests/integracion del G6: G4 (inbox y entregas) y G5
(programas) dentro de la app integrada, autorización cruzada entre módulos,
archivos del G2, formato de error común y errores SQLSTATE 45000 de los triggers.

Cada prueba afirma el comportamiento que piden README, CONTRATO_COMUN y los
CONTRATO.md: si falla, es un defecto, no una prueba mal escrita.

    set UDV_TEST_MYSQL_URL=mysql+pymysql://udv_app:<clave>@127.0.0.1:3317/db_udv
    set UDV_RAIZ=<ruta del repo>
    python -m pytest test_integracion_pm.py -v

Escribe datos: usar SOLO con una base de pruebas desechable, nunca la de Railway.
"""
import importlib
import re
import os
import subprocess
import sys
import json
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest

URL = os.getenv("UDV_TEST_MYSQL_URL")
RAIZ = Path(os.getenv("UDV_RAIZ", "."))
pytestmark = pytest.mark.skipif(not URL, reason="Define UDV_TEST_MYSQL_URL")

CLAVE_DEMO = "Demo2026!"
ADMIN, COORD, DOC1, DOC2, REVISOR, DIRECCION, AUDITOR = 1, 2, 3, 4, 5, 6, 7
PDF_MINIMO = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
              b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")


# ---------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def app():
    os.environ["DATABASE_URL"] = URL
    os.environ.setdefault("SECRET_KEY", "clave-solo-para-pruebas-de-integracion-pm-32+")
    sys.path.insert(0, str(RAIZ))
    os.chdir(RAIZ)
    return importlib.import_module("main")


@pytest.fixture(scope="session")
def c(app):
    from fastapi.testclient import TestClient
    with TestClient(app.app, raise_server_exceptions=False) as cliente:
        yield cliente


def _login(c, correo):
    r = c.post("/api/v1/auth/login", json={"correo": correo, "password": CLAVE_DEMO})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def s(c):
    return {k: _login(c, f"{k}@demo.udv.edu.gt") for k in
            ("admin", "coordinacion", "docente1", "docente2", "revisor", "direccion", "auditoria")}


def _items(cuerpo):
    return cuerpo.get("data") or cuerpo.get("items") or [] if isinstance(cuerpo, dict) else cuerpo


def publicar(c, s, para=(DOC1,), dias=10, tipo=1, revisor=REVISOR):
    titulo = f"PMINT-{uuid.uuid4().hex[:6].upper()}"
    cuerpo = {"type_id": tipo, "title": titulo,
              "due_date": (date.today() + timedelta(days=dias)).isoformat()}
    if revisor:
        cuerpo["reviewer_id"] = revisor
    r = c.post("/api/v1/tasks", headers=s["coordinacion"], json=cuerpo)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert c.post(f"/api/v1/tasks/{tid}/recipients", headers=s["coordinacion"],
                  json={"mode": "users", "user_ids": list(para)}).status_code == 200
    assert c.post(f"/api/v1/tasks/{tid}/publish", headers=s["coordinacion"]).status_code == 200
    asign = _items(c.get(f"/api/v1/tasks/{tid}/assignments", headers=s["coordinacion"]).json())
    return titulo, {a.get("user_id", a.get("assignee_id")): a["id"] for a in asign}


def es_error_comun(r, codigo_http):
    assert r.status_code == codigo_http, f"{r.status_code} {r.text[:300]}"
    cuerpo = r.json()
    assert set(cuerpo) == {"error"}, f"formato no común: {cuerpo}"
    assert {"code", "message"} <= set(cuerpo["error"]), cuerpo


# ------------------------------------------------------------ 1. arranque
def test_todos_los_routers_montados_y_base_conectada(c):
    h = c.get("/health").json()
    assert h["pendientes"] == {}, h["pendientes"]
    assert len(h["routers"]) == 9
    db = c.get("/health/db").json()
    assert db["status"] == "ok" and db["tablas"] == 50, db


def test_salud_del_g6_responde(c):
    assert c.get("/api/v1/health").status_code == 200


def test_rutas_protegidas_sin_token_dan_401_con_formato_comun(c, app):
    """Toda ruta con seguridad en el OpenAPI rechaza sin token con el error común."""
    malas = []
    for ruta, metodos in app.app.openapi()["paths"].items():
        for metodo, op in metodos.items():
            if not op.get("security"):
                continue
            url = re.sub(r"\{(\w+)\}", lambda m: {"action": "start", "section": "general"}
                         .get(m.group(1), "1"), ruta)
            r = c.request(metodo.upper(), url)
            ok = r.status_code == 401 and "error" in (r.json() if r.content else {})
            if not ok:
                malas.append(f"{metodo.upper()} {ruta} -> {r.status_code} {r.text[:80]}")
    assert not malas, "\n".join(malas)


# ------------------------------------------------- 2. G3 -> G4 (inbox)
def test_tarea_publicada_por_g3_aparece_en_inbox_g4_solo_del_destinatario(c, s):
    titulo, asign = publicar(c, s)
    propio = c.get(f"/api/v1/inbox?q={titulo}", headers=s["docente1"]).json()
    ajeno = c.get(f"/api/v1/inbox?q={titulo}", headers=s["docente2"]).json()
    assert {"page", "per_page", "total", "data"} <= set(propio)
    assert propio["total"] == 1 and propio["data"][0]["id"] == asign[DOC1]
    assert ajeno["total"] == 0


def test_estado_en_g4_sigue_las_transiciones_de_g3(c, s):
    titulo, asign = publicar(c, s)
    a = asign[DOC1]
    assert c.post(f"/api/v1/assignments/{a}/actions/start", json={},
                  headers=s["docente1"]).status_code == 200
    det = c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()
    assert det["status"] == "in_progress", det


def test_docente_no_ve_detalle_de_asignacion_ajena(c, s):
    _, asign = publicar(c, s)
    r = c.get(f"/api/v1/assignments/{asign[DOC1]}", headers=s["docente2"])
    assert r.status_code in (403, 404)
    es_error_comun(r, r.status_code)


def test_docente_no_comenta_ni_vincula_archivos_en_asignacion_ajena(c, s):
    _, asign = publicar(c, s)
    a = asign[DOC1]
    assert c.post(f"/api/v1/assignments/{a}/comments", json={"text": "x"},
                  headers=s["docente2"]).status_code in (403, 404)
    assert c.post(f"/api/v1/assignments/{a}/files", json={"file_id": "1", "name": "x.pdf"},
                  headers=s["docente2"]).status_code in (403, 404)


def test_comentario_de_g4_se_guarda_en_la_base(c, s):
    _, asign = publicar(c, s)
    a = asign[DOC1]
    r = c.post(f"/api/v1/assignments/{a}/comments", json={"text": "Comentario PM"},
               headers=s["docente1"])
    assert r.status_code in (200, 201), r.text
    textos = [x["text"] for x in c.get(f"/api/v1/assignments/{a}/comments",
                                       headers=s["docente1"]).json()]
    assert "Comentario PM" in textos, f"respondió {r.status_code} pero no persistió: {textos}"


def test_borrador_de_g4_se_guarda_en_la_base(c, s):
    _, asign = publicar(c, s)
    a = asign[DOC1]
    assert c.put(f"/api/v1/assignments/{a}/submission-draft", json={"comment": "borrador PM"},
                 headers=s["docente1"]).status_code == 200
    det = c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()
    assert det.get("draft_comment") == "borrador PM", det.get("draft_comment")


def test_vincular_archivo_inexistente_se_rechaza(c, s):
    _, asign = publicar(c, s)
    r = c.post(f"/api/v1/assignments/{asign[DOC1]}/files",
               json={"file_id": "999999", "name": "no-existe.pdf"}, headers=s["docente1"])
    assert r.status_code in (404, 422), f"aceptó un archivo que no existe: {r.status_code}"


def test_auditor_no_comenta(c, s):
    _, asign = publicar(c, s)
    r = c.post(f"/api/v1/assignments/{asign[DOC1]}/comments", json={"text": "x"},
               headers=s["auditoria"])
    assert r.status_code == 403


# ----------------------------------------------------- 3. archivos (G2)
def _subir(c, cabeceras, nombre="evidencia.pdf"):
    r = c.post("/api/v1/files", headers=cabeceras,
               files={"file": (nombre, PDF_MINIMO, "application/pdf")})
    assert r.status_code in (200, 201), r.text
    cuerpo = r.json()
    return cuerpo.get("id") or cuerpo.get("archivo_id") or cuerpo.get("file_id")


def test_archivo_se_guarda_en_upload_dir(c, s, tmp_path, monkeypatch):
    destino = Path(os.environ.get("UPLOAD_DIR", "almacen_archivos")).resolve()
    antes = set(destino.rglob("*")) if destino.exists() else set()
    _subir(c, s["docente1"])
    despues = set(destino.rglob("*")) if destino.exists() else set()
    assert despues - antes, f"el archivo no quedó en UPLOAD_DIR ({destino})"


def test_otro_docente_no_descarga_archivo_ajeno(c, s):
    fid = _subir(c, s["docente1"])
    assert c.get(f"/api/v1/files/{fid}", headers=s["docente1"]).status_code == 200
    assert c.get(f"/api/v1/files/{fid}", headers=s["docente2"]).status_code in (403, 404)


def _entregar_archivo(c, s, revisor):
    """Tarea para docente1 con un PDF vinculado a su entrega; devuelve el id del archivo."""
    _, asign = publicar(c, s, revisor=revisor)
    a = asign[DOC1]
    assert c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={}).status_code == 200
    fid = _subir(c, s["docente1"])
    r = c.post(f"/api/v1/assignments/{a}/files", headers=s["docente1"],
               json={"file_id": str(fid), "name": "evidencia.pdf"})
    assert r.status_code == 200, r.text
    return fid


def test_descarga_de_la_evidencia_segun_la_tarea(c, s):
    """Decisión D: dueño, admin y auditoría siempre; revisor y coordinación solo en su tarea."""
    fid = _entregar_archivo(c, s, REVISOR)
    for quien in ("docente1", "admin", "auditoria", "revisor", "coordinacion"):
        assert c.get(f"/api/v1/files/{fid}", headers=s[quien]).status_code == 200, quien
    for quien in ("docente2", "direccion"):
        assert c.get(f"/api/v1/files/{fid}", headers=s[quien]).status_code in (403, 404), quien


def test_sin_revisor_designado_descarga_la_coordinacion_no_cualquier_revisor(c, s):
    """Decisión B revisada: sin revisor designado revisa la coordinación dueña o un admin."""
    fid = _entregar_archivo(c, s, None)
    assert c.get(f"/api/v1/files/{fid}", headers=s["coordinacion"]).status_code == 200
    assert c.get(f"/api/v1/files/{fid}", headers=s["revisor"]).status_code == 403


def test_archivo_sin_vincular_solo_lo_descargan_su_dueno_y_admin(c, s):
    fid = _subir(c, s["docente1"])
    assert c.get(f"/api/v1/files/{fid}", headers=s["docente1"]).status_code == 200
    assert c.get(f"/api/v1/files/{fid}", headers=s["admin"]).status_code == 200
    for quien in ("revisor", "coordinacion", "auditoria"):
        assert c.get(f"/api/v1/files/{fid}", headers=s[quien]).status_code == 403, quien


def test_archivo_eliminado_no_se_descarga(c, s, app):
    from sqlalchemy import create_engine, text
    fid = _subir(c, s["docente1"])
    motor = create_engine(URL)
    with motor.begin() as cx:
        cx.execute(text("UPDATE archivo SET eliminado_en = NOW(3) WHERE id = :i"), {"i": fid})
    motor.dispose()
    assert c.get(f"/api/v1/files/{fid}", headers=s["docente1"]).status_code == 404


def test_tipo_no_permitido_da_error_comun(c, s):
    r = c.post("/api/v1/files", headers=s["docente1"],
               files={"file": ("x.pdf", b"MZ\x90\x00 no soy pdf", "application/pdf")})
    assert r.status_code in (400, 415, 422)
    assert r.json()["error"]["message"] != "Solicitud inválida.", r.json()


# ------------------------------------------------- 4. usuarios y roles
def test_permisos_por_rol_en_rutas_de_administracion(c, s):
    assert c.post("/api/v1/tasks", headers=s["docente1"], json={
        "type_id": 1, "title": "no", "due_date": "2030-01-01"}).status_code == 403
    assert c.post("/api/v1/users", headers=s["docente1"], json={}).status_code in (403, 422)
    assert c.post("/api/v1/roles", headers=s["docente1"],
                  json={"codigo": "x", "nombre": "x"}).status_code == 403
    assert c.post("/api/v1/campuses", headers=s["docente1"], json={"nombre": "x"}).status_code == 403


def test_coordinacion_puede_listar_usuarios(c, s):
    """El G1 da users.read a coordinator; coordinación necesita la lista para asignar tareas."""
    assert c.get("/api/v1/users", headers=s["coordinacion"]).status_code == 200


def test_crear_rol_con_codigo_invalido_da_422(c, s):
    r = c.post("/api/v1/roles", headers=s["admin"], json={"codigo": "Jefe-Area", "nombre": "Jefe"})
    es_error_comun(r, 422)


def test_crear_usuario_con_correo_invalido_da_422(c, s):
    r = c.post("/api/v1/users", headers=s["admin"], json={
        "nombres": "A", "apellidos": "B", "correo": f"no-es-correo-{uuid.uuid4().hex[:6]}",
        "password": "ClaveSegura1!", "rol": "teacher", "roles": ["teacher"]})
    es_error_comun(r, 422)


def test_nombre_demasiado_largo_da_422_y_no_500(c, s):
    r = c.post("/api/v1/users", headers=s["admin"], json={
        "nombres": "A" * 300, "apellidos": "B", "correo": f"x{uuid.uuid4().hex[:6]}@udv.edu.gt",
        "password": "ClaveSegura1!", "rol": "teacher", "roles": ["teacher"]})
    es_error_comun(r, 422)


def test_paginacion_comun_en_listados(c, s):
    for ruta, quien in [("/api/v1/users", "admin"), ("/api/v1/tasks", "coordinacion"),
                        ("/api/v1/inbox", "docente1"), ("/api/v1/course-programs", "coordinacion"),
                        ("/api/v1/notifications", "docente1"), ("/api/v1/audit", "auditoria")]:
        cuerpo = c.get(ruta, headers=s[quien]).json()
        assert {"page", "per_page", "total", "data"} <= set(cuerpo), f"{ruta}: {list(cuerpo)}"


# -------------------------------------------------------- 5. programas (G5)
def test_docente_ajeno_no_edita_programa_de_otro(c, s):
    """La versión 2 (draft) es de docente1 en la semilla; docente2 no debe poder editarla."""
    r = c.put("/api/v1/program-versions/2/sections/descripcion",
              json={"contenido": {"texto": "editado por docente2"}}, headers=s["docente2"])
    assert r.status_code in (403, 404), f"docente2 editó el programa de docente1: {r.status_code}"


def test_ponderacion_mayor_a_100_da_422_con_formato_comun(c, s):
    """El trigger del G1 lanza SQLSTATE 45000 '(422)'; debe llegar como 422, no 500."""
    r = c.put("/api/v1/program-versions/2/sections/evaluacion",
              json={"contenido": {"parcial": 60, "final": 70}}, headers=s["docente1"])
    es_error_comun(r, 422)


def test_direccion_puede_autorizar_un_programa_aprobado(c, s):
    """Rol 'authority' del G1 (usuario direccion). Recorre todo el flujo del G5."""
    assert c.put("/api/v1/program-versions/2/sections/evaluacion",
                 json={"contenido": {"parcial": 40, "final": 60}},
                 headers=s["docente1"]).status_code == 200
    r = c.post("/api/v1/program-versions/2/submit", json={}, headers=s["docente1"])
    assert r.status_code == 200, r.text
    assert c.post("/api/v1/program-versions/2/review", json={}, headers=s["revisor"]).status_code == 200
    assert c.post("/api/v1/program-versions/2/approve", json={}, headers=s["revisor"]).status_code == 200
    r = c.post("/api/v1/program-versions/2/authorize", json={}, headers=s["direccion"])
    assert r.status_code == 200, f"direccion (authority) no pudo autorizar: {r.status_code} {r.text}"
    pdf = c.get("/api/v1/program-versions/2/pdf", headers=s["docente1"])
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_pdf_de_version_no_autorizada_da_409(c, s):
    r = c.get("/api/v1/program-versions/999999/pdf", headers=s["docente1"])
    es_error_comun(r, 404)


# ---------------------------------------------------- 6. sesiones
def test_logout_invalida_el_token_en_todos_los_modulos(c):
    h = _login(c, "docente2@demo.udv.edu.gt")
    assert c.post("/api/v1/auth/logout", headers=h).status_code in (200, 204)
    for ruta in ("/api/v1/me", "/api/v1/inbox", "/api/v1/tasks", "/api/v1/notifications",
                 "/api/v1/course-programs"):
        assert c.get(ruta, headers=h).status_code == 401, ruta


def test_login_fallido_no_revela_si_el_correo_existe(c):
    a = c.post("/api/v1/auth/login", json={"correo": "docente3@demo.udv.edu.gt", "password": "malamala1"})
    b = c.post("/api/v1/auth/login", json={"correo": "noexiste@demo.udv.edu.gt", "password": "malamala1"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


# ------------------------------------------- 7. reglas del workflow (G3)
def _accion(c, h, a, nombre, comentario=None):
    return c.post(f"/api/v1/assignments/{a}/{nombre}", json={"comment": comentario}, headers=h)


def test_no_se_entrega_sin_archivo_si_el_tipo_lo_exige(c, s):
    """Tipo 3 ENTREGAR_FACTURA tiene requiere_archivo=1 en el G1."""
    _, asign = publicar(c, s, tipo=3)
    a = asign[DOC1]
    assert _accion(c, s["docente1"], a, "start").status_code == 200
    r = _accion(c, s["docente1"], a, "submit")
    assert r.status_code == 422, f"entregó sin archivo: {r.status_code}"


def test_entregar_crea_registro_en_entrega(c, s):
    from sqlalchemy import create_engine, text
    _, asign = publicar(c, s)
    a = asign[DOC1]
    _accion(c, s["docente1"], a, "start")
    assert _accion(c, s["docente1"], a, "submit").status_code == 200
    motor = create_engine(URL)
    with motor.connect() as cx:
        n = cx.execute(text("SELECT COUNT(*) FROM entrega WHERE tarea_destinatario_id = :a"),
                       {"a": a}).scalar()
    motor.dispose()
    assert n == 1, "submit no dejó fila en entrega"


def test_tarea_sin_revisor_no_la_aprueba_cualquier_revisor(c, s):
    """Sin revisor designado, un revisor cualquiera no debería aprobar."""
    _, asign = publicar(c, s, revisor=None)
    a = asign[DOC1]
    _accion(c, s["docente1"], a, "start")
    _accion(c, s["docente1"], a, "submit")
    r = _accion(c, s["revisor"], a, "review")
    assert r.status_code in (403, 409), f"revisor no designado pudo revisar: {r.status_code}"


def test_existe_la_accion_close_del_contrato_g3(c, s):
    assert c.post("/api/v1/assignments/999999/close", json={},
                  headers=s["coordinacion"]).status_code != 405
    assert c.post("/api/v1/assignments/999999/close", json={},
                  headers=s["coordinacion"]).status_code in (403, 404, 409)


def test_errores_de_g3_usan_codigos_del_contrato_comun(c, s):
    _, asign = publicar(c, s)
    r = _accion(c, s["revisor"], asign[DOC1], "approve")
    es_error_comun(r, 409)
    assert r.json()["error"]["code"].isupper(), r.json()


def test_revisor_no_designado_no_lee_entrega_en_g4(c, s):
    """Revisor designado: admin (1) actuando como otro; el usuario 5 no es el revisor de esta tarea."""
    _, asign = publicar(c, s, revisor=None)
    r = c.get(f"/api/v1/assignments/{asign[DOC1]}", headers=s["revisor"])
    assert r.status_code in (403, 404), f"revisor ajeno vio la entrega: {r.status_code}"


def test_programa_admite_version_en_otro_periodo(c, s):
    """Un curso tiene un programa por período; la llave uq_pv_numero no debe impedir el período 2."""
    r = c.post("/api/v1/course-programs", headers=s["docente1"], json={
        "curso_id": 1, "sede_id": 1, "modalidad_id": 1, "periodo_id": 2})
    assert r.status_code == 201, f"{r.status_code} {r.text[:200]}"


# ------------------------------------------- 9. lo que necesita la interfaz Vinci
COORD = 2   # coordinacion@demo (coordinator + reviewer + authority desde la migración 1.2.2)


def _tarea(c, s, **extra):
    cuerpo = {"type_id": 1, "title": f"PMINT-{uuid.uuid4().hex[:6].upper()}",
              "due_date": (date.today() + timedelta(days=10)).isoformat(), **extra}
    return c.post("/api/v1/tasks", headers=s["coordinacion"], json=cuerpo)


def test_la_tarea_guarda_y_devuelve_curso_y_periodo(c, s):
    r = _tarea(c, s, course_id=1, period_id=2)
    assert r.status_code == 201, r.text
    t = r.json()
    assert (t["course_id"], t["period_id"]) == (1, 2)
    assert t["course_code"] and t["course_name"] and t["period_code"]
    leida = c.get(f"/api/v1/tasks/{t['id']}", headers=s["coordinacion"]).json()
    assert (leida["course_id"], leida["period_id"]) == (1, 2)
    r = c.patch(f"/api/v1/tasks/{t['id']}", headers=s["coordinacion"], json={"course_id": 3})
    assert r.status_code == 200 and r.json()["course_id"] == 3 and r.json()["period_id"] == 2
    sin = _tarea(c, s).json()
    assert sin["course_id"] is None and sin["period_id"] is None


def test_curso_o_periodo_inexistente_responde_422(c, s):
    es_error_comun(_tarea(c, s, course_id=999999, period_id=1), 422)
    es_error_comun(_tarea(c, s, course_id=1, period_id=999999), 422)


def test_docentes_sugeridos_por_curso(c, s):
    r = c.get("/api/v1/tasks/eligible-teachers?course_id=1&period_id=2", headers=s["coordinacion"])
    assert r.status_code == 200, r.text
    ids = {d["id"] for d in r.json()["data"]}
    assert DOC1 in ids and r.json()["total"] == len(r.json()["data"])
    assert all({"id", "name", "email", "period_code", "campus"} <= set(d) for d in r.json()["data"])
    otro = c.get("/api/v1/tasks/eligible-teachers?course_id=4&period_id=2", headers=s["coordinacion"])
    assert otro.status_code == 200 and otro.json()["data"] == []
    es_error_comun(c.get("/api/v1/tasks/eligible-teachers?course_id=1", headers=s["docente1"]), 403)
    es_error_comun(c.get("/api/v1/tasks/eligible-teachers?course_id=999999", headers=s["coordinacion"]), 422)


def test_el_detalle_trae_nombres_tarea_curso_e_intentos(c, s):
    t = _tarea(c, s, course_id=1, period_id=2, reviewer_id=REVISOR).json()
    c.post(f"/api/v1/tasks/{t['id']}/recipients", headers=s["coordinacion"],
           json={"mode": "users", "user_ids": [DOC1]})
    a = c.post(f"/api/v1/tasks/{t['id']}/publish", headers=s["coordinacion"]).json()["assignment_ids"][0]
    c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
    c.put(f"/api/v1/assignments/{a}/submission-draft", headers=s["docente1"], json={"comment": "Primer intento"})
    assert c.post(f"/api/v1/assignments/{a}/comments", headers=s["docente1"],
                  json={"text": "Una duda"}).status_code == 200
    assert c.post(f"/api/v1/assignments/{a}/submit", headers=s["docente1"], json={}).status_code == 200
    d = c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()
    assert d["task_id"] == t["id"] and d["created_by"] == COORD and d["reviewer_id"] == REVISOR
    assert d["reviewer_name"] and d["created_by_name"] and d["assignee_name"]
    assert (d["course_id"], d["period_id"]) == (1, 2) and d["course_name"] and d["period_code"]
    com = d["comments"][0]
    assert com["author_id"] == DOC1 and com["author_name"] and com["created_at"].endswith("Z")
    assert d["attempts"] == [{"number": 1, "text": "Primer intento", "created_at": d["attempts"][0]["created_at"]}]
    assert d["history"][0]["action"] == "publish"


def test_viewer_actions_cruza_el_estado_con_quien_mira(c, s):
    """allowed_actions depende del estado; viewer_actions, además, de la persona."""
    _, asign = publicar(c, s, revisor=None)          # sin revisor designado
    a = asign[DOC1]
    ver = lambda quien: c.get(f"/api/v1/assignments/{a}", headers=s[quien]).json()
    assert ver("docente1")["viewer_actions"] == ["start"]
    assert ver("coordinacion")["viewer_actions"] == []
    c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
    c.post(f"/api/v1/assignments/{a}/submit", headers=s["docente1"], json={})
    assert ver("docente1")["viewer_actions"] == []
    assert ver("coordinacion")["viewer_actions"] == ["review"]      # la creó: le toca revisar
    assert c.get(f"/api/v1/assignments/{a}", headers=s["revisor"]).status_code == 403   # no es el designado
    c.post(f"/api/v1/assignments/{a}/review", headers=s["coordinacion"], json={})
    assert set(ver("coordinacion")["viewer_actions"]) == {"return", "approve"}
    assert ver("direccion")["viewer_actions"] == ["approve"]        # la autoridad aprueba cualquiera
    assert c.post(f"/api/v1/assignments/{a}/approve", headers=s["coordinacion"], json={}).status_code == 200
    d = ver("coordinacion")
    assert d["allowed_actions"] == ["close"] and d["viewer_actions"] == ["close"]
    assert ver("docente1")["viewer_actions"] == []
    assert c.post(f"/api/v1/assignments/{a}/close", headers=s["coordinacion"], json={}).status_code == 200
    assert ver("coordinacion")["history"][-1]["action"] == "close"


def test_la_cola_de_revision_dice_de_quien_es_cada_entrega(c, s):
    _, propia = publicar(c, s, revisor=None)          # sin revisor: le toca a quien la creó
    _, ajena = publicar(c, s, revisor=REVISOR)
    for a in (propia[DOC1], ajena[DOC1]):
        c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
        assert c.post(f"/api/v1/assignments/{a}/submit", headers=s["docente1"], json={}).status_code == 200
    filas = {f["id"]: f for f in c.get("/api/v1/review-queue?per_page=100", headers=s["coordinacion"]).json()["data"]}
    assert filas[propia[DOC1]]["mine"] is True and filas[propia[DOC1]]["reviewer_id"] is None
    assert filas[ajena[DOC1]]["mine"] is False and filas[ajena[DOC1]]["reviewer_id"] == REVISOR
    assert filas[ajena[DOC1]]["reviewer_name"] and filas[ajena[DOC1]]["task_id"]
    del_revisor = c.get("/api/v1/review-queue?per_page=100", headers=s["revisor"]).json()["data"]
    assert all(f["mine"] for f in del_revisor) and ajena[DOC1] in {f["id"] for f in del_revisor}


def test_los_avisos_dicen_a_que_asignacion_se_refieren(c, s):
    _, asign = publicar(c, s, revisor=None)
    a = asign[DOC1]
    avisos = c.get("/api/v1/notifications?per_page=100", headers=s["docente1"]).json()["data"]
    assert any(n["event"] == "task.published" and n["assignment_id"] == a for n in avisos)
    c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
    c.post(f"/api/v1/assignments/{a}/submit", headers=s["docente1"], json={})
    # Sin revisor designado, la entrega le avisa a la coordinación que creó la tarea.
    avisos = c.get("/api/v1/notifications?per_page=100", headers=s["coordinacion"]).json()["data"]
    assert any(n["event"] == "assignment.submitted" and n["assignment_id"] == a for n in avisos)


# --------------------------------- 10. programas: lectura de versiones y PDF (G5)
PUBLICADAS = ("authorized", "superseded")


def _versiones(c, s):
    """Las versiones del programa 1 con su estado actual (otras pruebas las mueven)."""
    return c.get("/api/v1/course-programs/1", headers=s["coordinacion"]).json()["versiones"]


def test_un_docente_lee_las_versiones_autorizadas_de_otro_pero_no_sus_borradores(c, s):
    """El historial es del curso: una versión autorizada la lee cualquier docente; una que
    sigue en elaboración o en revisión, solo su responsable y quienes revisan."""
    versiones = _versiones(c, s)
    assert any(v["estado"] in PUBLICADAS for v in versiones)
    for v in versiones:
        esperado = 200 if v["estado"] in PUBLICADAS else 404
        r = c.get(f"/api/v1/program-versions/{v['id']}", headers=s["docente2"])
        assert r.status_code == esperado, (v["id"], v["estado"], r.status_code)
        assert c.get(f"/api/v1/program-versions/{v['id']}", headers=s["coordinacion"]).status_code == 200
    visibles = c.get("/api/v1/course-programs/1", headers=s["docente2"]).json()["versiones"]
    assert {v["id"] for v in visibles} == {v["id"] for v in versiones if v["estado"] in PUBLICADAS}
    lista = c.get("/api/v1/course-programs", headers=s["docente2"]).json()["data"]
    assert lista and all(p["estado"] in PUBLICADAS for p in lista)
    publicada = next(v for v in versiones if v["estado"] in PUBLICADAS)
    r = c.put(f"/api/v1/program-versions/{publicada['id']}/sections/metodologia",
              headers=s["docente2"], json={"contenido": {"texto": "x"}})
    assert r.status_code in (403, 409), r.text       # leer no da permiso de editar


def test_el_pdf_de_una_version_autorizada_es_un_documento(c, s):
    versiones = _versiones(c, s)
    publicada = next(v for v in versiones if v["estado"] in PUBLICADAS)
    r = c.get(f"/api/v1/program-versions/{publicada['id']}/pdf", headers=s["docente2"])
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and len(r.content) > 5000
    for v in versiones:
        if v["estado"] not in PUBLICADAS:
            es_error_comun(c.get(f"/api/v1/program-versions/{v['id']}/pdf",
                                 headers=s["coordinacion"]), 409)


def test_el_error_de_un_trigger_llega_como_mensaje_limpio(c, s):
    """Pasar de 100 puntos lo rechaza un trigger del G1: el mensaje no trae el número de MySQL."""
    borrador = next((v for v in _versiones(c, s) if v["estado"] in ("draft", "returned")), None)
    if borrador is None:
        pytest.skip("No queda una versión en borrador para probar")
    r = c.put(f"/api/v1/program-versions/{borrador['id']}/sections/evaluacion", headers=s["docente1"],
              json={"contenido": [{"nombre": "A", "ponderacion": 60}, {"nombre": "B", "ponderacion": 60}]})
    es_error_comun(r, 422)
    mensaje = r.json()["error"]["message"]
    assert "1644" not in mensaje and "ERROR" not in mensaje and "(" not in mensaje, mensaje
    assert "100" in mensaje


# ------------------------------------------------ 11. segunda tanda para Vinci
def test_el_historial_de_una_asignacion_responde(c, s):
    """GET /assignments/{id}/history dejó de responder al agregar el curso a la tarea (PR #49)."""
    _, asign = publicar(c, s)
    a = asign[DOC1]
    c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
    for quien in ("docente1", "coordinacion"):
        r = c.get(f"/api/v1/assignments/{a}/history", headers=s[quien])
        assert r.status_code == 200, (quien, r.text)
        assert [h["action"] for h in _items(r.json())] == ["publish", "start"]
    assert c.get(f"/api/v1/assignments/{a}/history", headers=s["docente2"]).status_code == 403


def test_las_bandejas_y_la_lista_de_tareas_traen_curso_y_nombres(c, s):
    t = _tarea(c, s, course_id=1, period_id=2, reviewer_id=REVISOR).json()
    assert t["created_by_name"] and t["reviewer_name"]
    c.post(f"/api/v1/tasks/{t['id']}/recipients", headers=s["coordinacion"],
           json={"mode": "users", "user_ids": [DOC1]})
    a = c.post(f"/api/v1/tasks/{t['id']}/publish", headers=s["coordinacion"]).json()["assignment_ids"][0]
    en_lista = next(x for x in c.get("/api/v1/tasks?per_page=100", headers=s["coordinacion"]).json()["data"]
                    if x["id"] == t["id"])
    assert en_lista["course_code"] and en_lista["reviewer_name"] and en_lista["created_by_name"]
    fila = next(x for x in c.get("/api/v1/inbox?per_page=100", headers=s["docente1"]).json()["data"]
                if x["id"] == a)
    assert fila["task_id"] == t["id"] and fila["course_code"] and fila["course_name"] and fila["period_code"]
    c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
    assert c.post(f"/api/v1/assignments/{a}/submit", headers=s["docente1"], json={}).status_code == 200
    en_cola = next(x for x in c.get("/api/v1/review-queue?per_page=100", headers=s["revisor"]).json()["data"]
                   if x["id"] == a)
    assert en_cola["course_code"] and en_cola["course_name"] and en_cola["period_code"]


def test_el_texto_se_puede_corregir_despues_de_adjuntar_y_antes_de_entregar(c, s):
    """Migración 1.2.3: el intento abierto toma el texto vigente del borrador al entregar;
    una vez enviado, la entrega no se modifica."""
    from sqlalchemy import create_engine, text
    _, asign = publicar(c, s, tipo=2)                 # SUBIR_CV exige archivo
    a = asign[DOC1]
    c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"], json={})
    c.put(f"/api/v1/assignments/{a}/submission-draft", headers=s["docente1"], json={"comment": "Primera versión"})
    fid = _subir(c, s["docente1"])
    assert c.post(f"/api/v1/assignments/{a}/files", headers=s["docente1"],
                  json={"file_id": str(fid), "name": "cv.pdf"}).status_code == 200
    ver = lambda: c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()
    assert ver()["attempts"][0]["text"] == "Primera versión"      # así quedó al adjuntar
    c.put(f"/api/v1/assignments/{a}/submission-draft", headers=s["docente1"], json={"comment": "Texto corregido"})
    assert c.post(f"/api/v1/assignments/{a}/submit", headers=s["docente1"], json={}).status_code == 200
    d = ver()
    assert [(i["number"], i["text"]) for i in d["attempts"]] == [(1, "Texto corregido")]
    assert [f["attempt"] for f in d["files"]] == [1]
    motor = create_engine(URL)
    try:
        with pytest.raises(Exception, match="no se modifica"):
            with motor.begin() as cx:
                cx.execute(text("UPDATE entrega SET contenido_texto = 'cambiada' "
                                "WHERE tarea_destinatario_id = :a"), {"a": a})
    finally:
        motor.dispose()
    assert ver()["attempts"][0]["text"] == "Texto corregido"



# --------------------------------- 10. el programa que pide una tarea (G5, para Vinci)
def _asignar_programa(c, s, docente=DOC2, **extra):
    t = _tarea(c, s, reviewer_id=REVISOR, **extra).json()
    c.post(f"/api/v1/tasks/{t['id']}/recipients", headers=s["coordinacion"],
           json={"mode": "users", "user_ids": [docente]})
    return c.post(f"/api/v1/tasks/{t['id']}/publish", headers=s["coordinacion"]).json()["assignment_ids"][0]


def test_la_tarea_abre_el_borrador_del_programa_a_nombre_del_docente(c, s):
    a = _asignar_programa(c, s, course_id=1, period_id=2)
    ruta = f"/api/v1/program-versions/for-assignment/{a}"
    es_error_comun(c.post(ruta, headers=s["docente1"]), 403)
    es_error_comun(c.post(ruta, headers=s["coordinacion"]), 403)
    r = c.post(ruta, headers=s["docente2"])
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["estado"] == "draft" and v["periodo_id"] == 2 and v["version_origen_id"]
    assert v["assignment_id"] == a          # la pantalla sabe qué tarea mover al revisar el programa
    assert v["secciones"] and v["viewer_actions"] == ["edit", "submit"]
    assert v["nombre"].endswith("2026-2") or "2026-1" not in v["nombre"]
    # Al ser la primera versión de su período, los cambios se comparan con la versión de origen.
    cambios = c.get(f"/api/v1/program-versions/{v['id']}/changes", headers=s["docente2"]).json()
    assert cambios["version_anterior"] == v["version_origen_id"]
    # Llamarla otra vez no abre otro borrador.
    assert c.post(ruta, headers=s["docente2"]).json()["id"] == v["id"]
    # Es suyo: lo lee, lo edita, y la entrega (G4) lo encuentra.
    leida = c.get(f"/api/v1/program-versions/{v['id']}", headers=s["docente2"])
    assert leida.status_code == 200 and leida.json()["viewer_actions"] == ["edit", "submit"]
    r = c.put(f"/api/v1/program-versions/{v['id']}/sections/metodologia", headers=s["docente2"],
              json={"contenido": {"texto": "Clases prácticas con proyecto integrador."}})
    assert r.status_code == 200, r.text
    detalle = c.get(f"/api/v1/assignments/{a}", headers=s["docente2"]).json()
    assert detalle["program_version"]["id"] == v["id"]
    # Otro docente no ve el borrador ajeno.
    es_error_comun(c.get(f"/api/v1/program-versions/{v['id']}", headers=s["docente1"]), 404)


def test_la_tarea_sin_curso_no_abre_borrador_y_el_primer_programa_se_abre_en_blanco(c, s):
    sin_curso = _asignar_programa(c, s)
    es_error_comun(c.post(f"/api/v1/program-versions/for-assignment/{sin_curso}", headers=s["docente2"]), 422)
    # Curso sin programa autorizado: el docente abre el primero, en blanco y a su nombre.
    sin_programa = _asignar_programa(c, s, course_id=4, period_id=2)
    r = c.post(f"/api/v1/program-versions/for-assignment/{sin_programa}", headers=s["docente2"])
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["estado"] == "draft" and v["periodo_id"] == 2 and v["version_origen_id"] is None
    assert v["viewer_actions"] == ["edit", "submit"] and v["nombre"].endswith("2026-2")
    assert c.post(f"/api/v1/program-versions/for-assignment/{sin_programa}", headers=s["docente2"]).json()["id"] == v["id"]
    r = c.put(f"/api/v1/program-versions/{v['id']}/sections/metodologia", headers=s["docente2"],
              json={"contenido": {"texto": "Clases prácticas."}})
    assert r.status_code == 200, r.text
    assert c.get(f"/api/v1/assignments/{sin_programa}", headers=s["docente2"]).json()["program_version"]["id"] == v["id"]
    # Otro docente con la misma tarea de ese curso abre su propio borrador en el mismo programa.
    otra = _asignar_programa(c, s, docente=DOC1, course_id=4, period_id=2)
    v2 = c.post(f"/api/v1/program-versions/for-assignment/{otra}", headers=s["docente1"]).json()
    assert v2["id"] != v["id"] and v2["programa_id"] == v["programa_id"]
    es_error_comun(c.post("/api/v1/program-versions/for-assignment/999999", headers=s["docente2"]), 404)
    es_error_comun(c.post(f"/api/v1/program-versions/for-assignment/{sin_curso}", headers=s["auditoria"]), 403)


def test_viewer_actions_del_programa_sigue_el_flujo(c, s):
    a = _asignar_programa(c, s, course_id=1, period_id=2)
    vid = c.post(f"/api/v1/program-versions/for-assignment/{a}", headers=s["docente2"]).json()["id"]

    def puede(quien):
        return c.get(f"/api/v1/program-versions/{vid}", headers=s[quien]).json()["viewer_actions"]

    def hacer(accion, quien, **cuerpo):
        r = c.post(f"/api/v1/program-versions/{vid}/{accion}", headers=s[quien], json=cuerpo)
        assert r.status_code == 200, f"{accion}: {r.status_code} {r.text[:300]}"

    assert puede("docente2") == ["edit", "submit"]
    assert puede("revisor") == ["edit_responsibles"]   # gestiona programas: no escribe el contenido
    assert puede("coordinacion") == ["edit_responsibles"]
    es_error_comun(c.post(f"/api/v1/program-versions/{vid}/submit", headers=s["coordinacion"], json={}), 403)
    seccion = f"/api/v1/program-versions/{vid}/sections"
    texto = {"contenido": {"texto": "Corregido por coordinación"}}
    es_error_comun(c.put(f"{seccion}/descripcion", headers=s["coordinacion"], json=texto), 403)
    es_error_comun(c.put(f"{seccion}/descripcion", headers=s["revisor"], json=texto), 403)
    es_error_comun(c.put(f"{seccion}/descripcion", headers=s["admin"], json=texto), 403)
    assert c.put(f"{seccion}/responsables", headers=s["coordinacion"], json={"contenido": {"coordinador": "Coordinación Demo"}}).status_code == 200
    assert c.put(f"{seccion}/descripcion", headers=s["docente2"], json={"contenido": {"texto": "Escrito por el docente"}}).status_code == 200
    assert puede("auditoria") == [] and puede("direccion") == []
    hacer("submit", "docente2")
    assert puede("docente2") == [] and puede("revisor") == ["review"]
    hacer("review", "revisor")
    assert puede("revisor") == ["return", "approve"] and puede("docente2") == []
    hacer("return", "revisor", comentario="Falta detallar la unidad 2.")
    assert puede("docente2") == ["edit", "submit"]
    hacer("submit", "docente2")
    hacer("review", "coordinacion")
    assert puede("coordinacion") == ["return", "approve"]
    hacer("approve", "coordinacion")
    assert puede("revisor") == [] and puede("direccion") == ["authorize"]
    assert puede("coordinacion") == ["authorize"]  # decisión E: coordinación también autoriza
    hacer("authorize", "direccion")
    assert puede("direccion") == [] and puede("docente2") == []


def test_solo_el_docente_responsable_envia_el_programa(c, s):
    a = _asignar_programa(c, s, docente=DOC1, course_id=1, period_id=2)
    vid = c.post(f"/api/v1/program-versions/for-assignment/{a}", headers=s["docente1"]).json()["id"]
    # Coordinación ya no lo envía en nombre del docente: lo elabora y lo envía su responsable.
    es_error_comun(c.post(f"/api/v1/program-versions/{vid}/submit", json={}, headers=s["coordinacion"]), 403)
    es_error_comun(c.post(f"/api/v1/program-versions/{vid}/submit", json={}, headers=s["docente2"]), 403)
    assert c.post(f"/api/v1/program-versions/{vid}/submit", json={}, headers=s["docente1"]).status_code == 200
    assert c.post(f"/api/v1/program-versions/{vid}/review", json={}, headers=s["coordinacion"]).status_code == 200
    acciones = c.get(f"/api/v1/program-versions/{vid}", headers=s["coordinacion"]).json()["viewer_actions"]
    assert acciones == ["return", "approve"]
    es_error_comun(c.post(f"/api/v1/program-versions/{vid}/approve", json={}, headers=s["docente1"]), 403)


def test_catalogo_de_perfiles_de_egreso(c, s):
    r = c.get("/api/v1/graduate-profiles", headers=s["docente1"])
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["total"] == len(cuerpo["data"]) >= 1
    assert all({"id", "codigo", "descripcion"} <= set(p) for p in cuerpo["data"])
    es_error_comun(c.get("/api/v1/graduate-profiles"), 401)


# ------------------------------------------- 11. tipos de tarea nuevos (G3, para Vinci)
def test_coordinacion_crea_un_tipo_de_tarea_y_recorre_su_flujo(c, s):
    nombre = f"Entregar constancia {uuid.uuid4().hex[:5]}"
    r = c.post("/api/v1/task-types", headers=s["coordinacion"],
               json={"name": nombre, "delivery": "archivo", "description": "Constancia en PDF"})
    assert r.status_code == 201, r.text
    tipo = r.json()
    assert tipo["name"] == nombre and tipo["requires_evidence"] == 1 and tipo["delivery_mode"] == "ambos"
    assert tipo["code"] and len(tipo["code"]) <= 30
    listados = _items(c.get("/api/v1/task-types?per_page=100", headers=s["docente1"]).json())
    assert tipo["id"] in {t["id"] for t in listados}
    assert all("delivery_mode" in t for t in listados)
    es_error_comun(c.post("/api/v1/task-types", headers=s["coordinacion"], json={"name": nombre}), 409)
    es_error_comun(c.post("/api/v1/task-types", headers=s["docente1"], json={"name": "Otro tipo"}), 403)
    es_error_comun(c.post("/api/v1/task-types", headers=s["coordinacion"], json={"name": "  "}), 422)
    es_error_comun(c.post("/api/v1/task-types", headers=s["coordinacion"],
                          json={"name": "Tipo raro", "delivery": "paloma"}), 422)
    # El tipo nuevo recorre el mismo flujo: exige archivo, se revisa, aprueba y cierra.
    _, asign = publicar(c, s, para=(DOC1,), tipo=tipo["id"], revisor=COORD)
    a = asign[DOC1]
    assert _accion(c, s["docente1"], a, "start").status_code == 200
    es_error_comun(_accion(c, s["docente1"], a, "submit"), 422)
    fid = _subir(c, s["docente1"])
    assert c.post(f"/api/v1/assignments/{a}/files", headers=s["docente1"],
                  json={"file_id": str(fid), "name": "Constancia"}).status_code in (200, 201)
    for quien, accion in (("docente1", "submit"), ("coordinacion", "review"),
                          ("coordinacion", "approve"), ("coordinacion", "close")):
        r = _accion(c, s[quien], a, accion)
        assert r.status_code == 200, f"{accion}: {r.status_code} {r.text[:200]}"
    detalle = c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()
    assert detalle["status"] == "closed" and detalle["task_type"]


def test_un_tipo_solo_de_texto_se_entrega_sin_archivo(c, s):
    r = c.post("/api/v1/task-types", headers=s["coordinacion"],
               json={"name": f"Responder encuesta {uuid.uuid4().hex[:5]}", "delivery": "texto"})
    assert r.status_code == 201, r.text
    assert r.json()["requires_evidence"] == 0 and r.json()["delivery_mode"] == "texto"
    _, asign = publicar(c, s, para=(DOC1,), tipo=r.json()["id"], revisor=COORD)
    a = asign[DOC1]
    assert _accion(c, s["docente1"], a, "start").status_code == 200
    assert c.put(f"/api/v1/assignments/{a}/submission-draft", headers=s["docente1"],
                 json={"comment": "Encuesta respondida."}).status_code == 200
    assert _accion(c, s["docente1"], a, "submit").status_code == 200
    assert c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()["delivery"]["mode"] == "texto"


# ------------------------------------------- 12. quitar un archivo antes de entregar (G4)
def test_el_docente_quita_un_archivo_del_intento_sin_enviar(c, s):
    _, asign = publicar(c, s, para=(DOC1,), tipo=5, revisor=COORD)
    a = asign[DOC1]
    assert _accion(c, s["docente1"], a, "start").status_code == 200
    fid = _subir(c, s["docente1"])
    assert c.post(f"/api/v1/assignments/{a}/files", headers=s["docente1"],
                  json={"file_id": str(fid), "name": "El que no era"}).status_code in (200, 201)
    ruta = f"/api/v1/assignments/{a}/files/{fid}"
    es_error_comun(c.delete(ruta, headers=s["docente2"]), 403)
    es_error_comun(c.delete(f"/api/v1/assignments/{a}/files/999999", headers=s["docente1"]), 404)
    r = c.delete(ruta, headers=s["docente1"])
    assert r.status_code == 200 and r.json()["files"] == [], r.text
    assert c.get(f"/api/v1/assignments/{a}", headers=s["docente1"]).json()["files"] == []
    es_error_comun(c.delete(ruta, headers=s["docente1"]), 404)          # ya no está
    es_error_comun(_accion(c, s["docente1"], a, "submit"), 422)         # sin archivo no se entrega
    # Con otro archivo se entrega; lo ya enviado no se puede quitar.
    fid2 = _subir(c, s["docente1"], "correcto.pdf")
    assert c.post(f"/api/v1/assignments/{a}/files", headers=s["docente1"],
                  json={"file_id": str(fid2), "name": "El correcto"}).status_code in (200, 201)
    assert _accion(c, s["docente1"], a, "submit").status_code == 200
    es_error_comun(c.delete(f"/api/v1/assignments/{a}/files/{fid2}", headers=s["docente1"]), 409)
    detalle = c.get(f"/api/v1/assignments/{a}", headers=s["coordinacion"]).json()
    assert [f["name"] for f in detalle["files"]] == ["correcto.pdf"]


# ------------------------------------------- 13. resúmenes para Panel y Tareas (G3 y G6)
def test_la_lista_de_tareas_trae_el_avance_si_se_pide(c, s):
    _, asign = publicar(c, s, para=(DOC1, DOC2), tipo=4, revisor=COORD)
    _accion(c, s["docente1"], asign[DOC1], "start")
    c.put(f"/api/v1/assignments/{asign[DOC1]}/submission-draft", headers=s["docente1"], json={"comment": "Sí asistiré."})
    assert _accion(c, s["docente1"], asign[DOC1], "submit").status_code == 200
    _, uno = publicar(c, s, para=(DOC2,), tipo=4, revisor=COORD)
    lista = c.get("/api/v1/tasks?status=published&per_page=100&include=progress", headers=s["coordinacion"]).json()["data"]
    assert all("progress" in t for t in lista)
    por_asignacion = {}
    for t in lista:
        ids = {a["id"] for a in _items(c.get(f"/api/v1/tasks/{t['id']}/assignments", headers=s["coordinacion"]).json())}
        por_asignacion[t["id"]] = ids
    dos = next(t for t in lista if asign[DOC1] in por_asignacion[t["id"]])["progress"]
    assert (dos["total"], dos["to_review"], dos["done"], dos["assignee_name"]) == (2, 1, 0, None)
    assert dos["by_status"] == {"submitted": 1, "assigned": 1}
    assert dos["assignee_names"] == ["Daniel López", "Diana Pérez"]
    solo = next(t for t in lista if uno[DOC2] in por_asignacion[t["id"]])["progress"]
    assert solo["total"] == 1 and solo["assignee_name"] == "Daniel López"
    assert solo["assignee_names"] == ["Daniel López"]
    sin = c.get("/api/v1/tasks?status=published&per_page=5", headers=s["coordinacion"]).json()["data"]
    assert all("progress" not in t for t in sin)


def test_el_resumen_por_docente_cuadra_con_el_panel(c, s):
    panel = c.get("/api/v1/dashboard?limit=100", headers=s["coordinacion"]).json()
    r = c.get("/api/v1/dashboard/teachers", headers=s["coordinacion"])
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["total"] == len(cuerpo["data"]) >= 1
    suma = lambda k: sum(d[k] for d in cuerpo["data"])
    assert suma("overdue") == panel["overdue"]["total"]
    assert suma("due_soon") == panel["due_soon"]["total"]
    estados = panel["assignments"]["by_state"]
    assert suma("to_review") == estados["submitted"] + estados["under_review"]
    assert suma("finished") == estados["approved"] + estados["closed"]
    assert suma("assigned") == panel["compliance"]["expected"]
    assert c.get("/api/v1/dashboard/teachers", headers=s["auditoria"]).status_code == 200
    es_error_comun(c.get("/api/v1/dashboard/teachers", headers=s["docente1"]), 403)


def test_una_version_nueva_no_hereda_la_tarea_de_su_origen(c, s):
    autorizada = next(v for v in _versiones(c, s) if v["estado"] == "authorized")
    periodo = c.get(f"/api/v1/program-versions/{autorizada['id']}", headers=s["coordinacion"]).json()["periodo_id"]
    r = c.post("/api/v1/course-programs/1/versions", headers=s["coordinacion"],
               json={"periodo_id": periodo, "resumen_cambios": "Ajuste menor"})
    if r.status_code == 201 or r.status_code == 200:
        assert r.json()["assignment_id"] is None
    else:   # ya hay un borrador abierto de ese período: la regla no aplica en esta corrida
        es_error_comun(r, 409)


def test_una_tarea_retirada_por_administracion_no_sale_en_ninguna_lista(c, s):
    import sqlalchemy as sa
    _, asign = publicar(c, s, para=(DOC1,), tipo=4, revisor=COORD)
    tarea_id = c.get(f"/api/v1/assignments/{asign[DOC1]}", headers=s["coordinacion"]).json()["task_id"]
    borrador = _tarea(c, s).json()["id"]
    assert c.post(f"/api/v1/tasks/{borrador}/cancel", headers=s["coordinacion"], json={}).status_code == 200
    motor = sa.create_engine(os.environ["UDV_TEST_MYSQL_URL"])
    with motor.begin() as con:
        con.execute(sa.text("UPDATE tarea SET eliminado_en = UTC_TIMESTAMP(3), eliminado_por = 1 WHERE id = :i"), {"i": tarea_id})
    def ids(estado):
        return {x["id"] for x in c.get(f"/api/v1/tasks?status={estado}&per_page=100", headers=s["coordinacion"]).json()["data"]}
    assert tarea_id not in ids("published") | ids("cancelled") | ids("draft")
    assert tarea_id not in {x["id"] for x in c.get("/api/v1/tasks?per_page=100", headers=s["coordinacion"]).json()["data"]}
    assert borrador in ids("cancelled")              # un borrador cancelado desde la aplicación sí sale
    assert asign[DOC1] not in {x["id"] for x in _items(c.get("/api/v1/inbox", headers=s["docente1"]).json())}


def test_la_bandeja_del_docente_dice_quien_revisa_cuando_entrego_y_por_que_se_devolvio(c, s):
    _, asign = publicar(c, s, para=(DOC1,), tipo=4, revisor=COORD)
    a = asign[DOC1]
    fila = lambda: next(x for x in _items(c.get("/api/v1/inbox?per_page=100", headers=s["docente1"]).json()) if x["id"] == a)
    f = fila()
    assert f["reviewer_name"] == "Carlos Coordinador" and f["submitted_at"] is None and f["last_return_comment"] is None
    _accion(c, s["docente1"], a, "start")
    c.put(f"/api/v1/assignments/{a}/submission-draft", headers=s["docente1"], json={"comment": "Asistiré."})
    assert _accion(c, s["docente1"], a, "submit").status_code == 200
    f = fila()
    assert f["submitted_at"] and f["submitted_at"].endswith("Z") and f["last_return_comment"] is None
    assert _accion(c, s["coordinacion"], a, "review").status_code == 200
    assert c.post(f"/api/v1/assignments/{a}/return", headers=s["coordinacion"], json={"comment": "Falta el horario."}).status_code == 200
    assert fila()["last_return_comment"] == "Falta el horario."
    assert _accion(c, s["docente1"], a, "resubmit").status_code == 200
    assert fila()["last_return_comment"] is None          # ya no está devuelta


def test_pantallas_piden_revalidar_para_no_mezclar_versiones(c):
    """Tras un despliegue el navegador no debe usar módulos viejos sin preguntar."""
    r = c.get("/app/js/formato.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    etag = r.headers["etag"]
    r2 = c.get("/app/js/formato.js", headers={"If-None-Match": etag})
    assert r2.status_code == 304
    assert r2.headers["cache-control"] == "no-cache"


def test_auditoria_dice_el_nombre_de_lo_que_se_toco(c, s):
    a = _asignar_programa(c, s, docente=DOC1, course_id=1, period_id=2)
    assert c.post(f"/api/v1/assignments/{a}/start", headers=s["docente1"]).status_code == 200
    vid = c.post(f"/api/v1/program-versions/for-assignment/{a}", headers=s["docente1"]).json()["id"]
    def registros(entidad):
        r = c.get(f"/api/v1/audit?entity={entidad}&per_page=50", headers=s["auditoria"])
        assert r.status_code == 200, r.text
        return r.json()["data"]

    def nombre(entidad, eid):
        return next(d["entity_label"] for d in registros(entidad) if d["entity_id"] == eid)

    asignacion = nombre("tarea_destinatario", a)
    assert asignacion and asignacion.endswith("· Diana Pérez"), asignacion
    version = nombre("programa_version", vid)
    assert version and version.startswith("ISW-301 · ") and "· versión " in version, version
    de_usuarios = registros("usuario")
    assert de_usuarios and all(d["entity_label"] for d in de_usuarios)
    assert all(d["entity_label"] is None for d in registros("sede"))
    usuarios = c.get("/api/v1/audit/filters", headers=s["auditoria"]).json()["users"]
    assert all(u["name"] for u in usuarios)


def test_programas_por_autorizar_dicen_quien_elaboro_y_quien_aprobo(c, s):
    a = _asignar_programa(c, s, docente=DOC1, course_id=1, period_id=2)
    vid = c.post(f"/api/v1/program-versions/for-assignment/{a}", headers=s["docente1"]).json()["id"]
    # El borrador nuevo no hereda al revisor de la versión de origen.
    assert not c.get(f"/api/v1/program-versions/{vid}", headers=s["docente1"]).json()["secciones"]["responsables"]["contenido"].get("revisor")
    for accion, quien in (("submit", "docente1"), ("review", "coordinacion"), ("approve", "coordinacion")):
        assert c.post(f"/api/v1/program-versions/{vid}/{accion}", json={}, headers=s[quien]).status_code == 200, accion
    fila = next(f for f in c.get("/api/v1/course-programs?estado=approved&per_page=100", headers=s["direccion"]).json()["data"]
                if f["programa_version_id"] == vid)
    assert fila["docente_responsable"] == "Diana Pérez"
    assert fila["aprobado_por"] == "Carlos Coordinador" and fila["aprobado_en"]
    v = c.get(f"/api/v1/program-versions/{vid}", headers=s["direccion"]).json()
    assert v["secciones"]["responsables"]["contenido"]["revisor"] == "Carlos Coordinador"


def test_tipo_de_tarea_se_renombra_se_desactiva_y_queda_en_auditoria(c, s):
    nombre = f"Tipo temporal {uuid.uuid4().hex[:5]}"
    tipo = c.post("/api/v1/task-types", headers=s["coordinacion"], json={"name": nombre, "delivery": "texto"}).json()
    assert tipo["active"] == 1
    url = f"/api/v1/task-types/{tipo['id']}"
    es_error_comun(c.patch(url, headers=s["docente1"], json={"active": False}), 403)
    es_error_comun(c.patch("/api/v1/task-types/999999", headers=s["coordinacion"], json={"active": False}), 404)
    es_error_comun(c.patch(url, headers=s["coordinacion"], json={"name": "  "}), 422)
    es_error_comun(c.patch(url, headers=s["coordinacion"], json={"name": "Entregar factura"}), 409)
    es_error_comun(c.patch("/api/v1/task-types/1", headers=s["admin"], json={"active": False}), 409)

    r = c.patch(url, headers=s["admin"], json={"name": nombre + " (v2)", "description": "Solo para pruebas"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == nombre + " (v2)" and r.json()["description"] == "Solo para pruebas"
    assert c.patch(url, headers=s["coordinacion"], json={"active": False}).json()["active"] == 0

    def ids(quien, extra=""):
        return {t["id"] for t in _items(c.get(f"/api/v1/task-types?per_page=100{extra}", headers=s[quien]).json())}

    assert tipo["id"] not in ids("coordinacion") and tipo["id"] not in ids("docente1")
    assert tipo["id"] in ids("coordinacion", "&include_inactive=true")
    assert tipo["id"] not in ids("docente1", "&include_inactive=true")   # solo quien los administra
    es_error_comun(_tarea(c, s, type_id=tipo["id"]), 422)                # ya no se puede asignar

    assert c.patch(url, headers=s["coordinacion"], json={"active": True}).json()["active"] == 1
    assert tipo["id"] in ids("docente1")
    registros = c.get("/api/v1/audit?entity=tipo_tarea&per_page=50", headers=s["auditoria"]).json()["data"]
    propios = [d for d in registros if d["entity_id"] == tipo["id"]]
    assert {d["action"] for d in propios} == {"insert", "update"} and len(propios) == 4


def test_la_forma_de_entrega_de_un_tipo_solo_cambia_si_no_se_ha_usado(c, s):
    tipo = c.post("/api/v1/task-types", headers=s["coordinacion"],
                  json={"name": f"Tipo editable {uuid.uuid4().hex[:5]}", "delivery": "texto"}).json()
    url = f"/api/v1/task-types/{tipo['id']}"
    assert tipo["task_count"] == 0 and tipo["delivery_mode"] == "texto"
    r = c.patch(url, headers=s["coordinacion"], json={"delivery": "archivo"})
    assert r.status_code == 200, r.text
    assert r.json()["delivery_mode"] == "ambos" and r.json()["requires_evidence"] == 1
    es_error_comun(c.patch(url, headers=s["coordinacion"], json={"delivery": "paloma"}), 422)
    es_error_comun(c.patch("/api/v1/task-types/1", headers=s["coordinacion"], json={"delivery": "texto"}), 409)

    assert _tarea(c, s, type_id=tipo["id"]).status_code == 201           # ya lo usa una tarea
    listado = {t["id"]: t for t in _items(c.get("/api/v1/task-types?per_page=100", headers=s["coordinacion"]).json())}
    assert listado[tipo["id"]]["task_count"] == 1
    es_error_comun(c.patch(url, headers=s["coordinacion"], json={"delivery": "texto"}), 409)
    # El nombre, la descripción y el estado sí se cambian aunque esté en uso; repetir la misma forma no falla.
    assert c.patch(url, headers=s["coordinacion"], json={"description": "Con constancia", "delivery": "archivo"}).status_code == 200


def test_administracion_crea_un_usuario_con_varios_roles_y_lo_gestiona(c, s):
    correo = f"nuevo.{uuid.uuid4().hex[:6]}@demo.udv.edu.gt"
    clave = "Inicial-" + uuid.uuid4().hex[:8]
    datos = {"nombres": "Nora", "apellidos": "Nueva", "correo": correo, "password": clave}
    es_error_comun(c.post("/api/v1/users", headers=s["coordinacion"], json={**datos, "roles": ["teacher"]}), 403)
    es_error_comun(c.post("/api/v1/users", headers=s["admin"], json=datos), 422)                       # sin rol
    es_error_comun(c.post("/api/v1/users", headers=s["admin"], json={**datos, "roles": ["paloma"]}), 400)
    r = c.post("/api/v1/users", headers=s["admin"], json={**datos, "roles": ["teacher", "reviewer", "teacher"]})
    assert r.status_code == 201, r.text
    u = r.json()
    assert sorted(u["roles"]) == ["reviewer", "teacher"] and u["activo"] is True
    es_error_comun(c.post("/api/v1/users", headers=s["admin"], json={**datos, "rol": "teacher"}), 409)  # correo repetido

    def entrar(password):
        return c.post("/api/v1/auth/login", json={"correo": correo, "password": password})

    token = entrar(clave).json()["access_token"]
    url = f"/api/v1/users/{u['id']}"
    r = c.patch(url, headers=s["admin"], json={"roles": ["coordinator", "reviewer", "authority"], "nombres": "Nora Elena"})
    assert r.status_code == 200 and sorted(r.json()["roles"]) == ["authority", "coordinator", "reviewer"]
    assert c.patch(url, headers=s["admin"], json={"rol": "teacher"}).json()["roles"] == ["teacher"]      # forma anterior
    # Al desactivar la cuenta se cierran sus sesiones y ya no puede entrar.
    assert c.patch(url, headers=s["admin"], json={"activo": False}).json()["activo"] is False
    assert c.get("/api/v1/tasks", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert entrar(clave).status_code in (401, 403)
    assert c.patch(url, headers=s["admin"], json={"activo": True}).json()["activo"] is True
    assert entrar(clave).status_code == 200
    # La administración no se quita su propio rol ni desactiva su propia cuenta.
    yo = next(x for x in c.get("/api/v1/users?per_page=100", headers=s["admin"]).json()["data"]
              if x["correo"] == "admin@demo.udv.edu.gt")
    es_error_comun(c.patch(f"/api/v1/users/{yo['id']}", headers=s["admin"], json={"roles": ["teacher"]}), 409)
    es_error_comun(c.patch(f"/api/v1/users/{yo['id']}", headers=s["admin"], json={"activo": False}), 409)
    # El cambio de roles queda en la auditoría, sin la contraseña.
    registros = [d for d in c.get("/api/v1/audit?entity=usuario&per_page=100", headers=s["auditoria"]).json()["data"]
                 if d["entity_id"] == u["id"]]
    con_roles = [d for d in registros if "roles" in (d["changes"].get("despues") or {})]
    assert len(con_roles) == 3 and clave not in json.dumps(registros)


# ------------------------------------------------------------ seguridad
def test_todas_las_respuestas_llevan_cabeceras_de_seguridad(c, s):
    casos = {
        "/app/": "script-src 'self'",                       # Vinci: sin scripts en línea
        "/app/js/api.js": "script-src 'self'",
        "/api/v1/tasks": "default-src 'none'",              # la API no sirve páginas
        "/app/g6/": "frame-ancestors 'none'",               # pantallas de grupo: política mínima
    }
    for ruta, parte in casos.items():
        r = c.get(ruta, headers={"x-forwarded-proto": "https"})
        assert r.headers["x-content-type-options"] == "nosniff", ruta
        assert r.headers["x-frame-options"] == "DENY", ruta
        assert r.headers["referrer-policy"] == "same-origin", ruta
        assert parte in r.headers["content-security-policy"], (ruta, r.headers["content-security-policy"])
        assert "max-age=" in r.headers["strict-transport-security"], ruta
    assert "strict-transport-security" not in c.get("/app/").headers      # sin HTTPS no se promete HTTPS
    assert "script-src" not in c.get("/app/g6/").headers["content-security-policy"]


def test_la_matriz_del_flujo_pide_sesion(c, s):
    es_error_comun(c.get("/api/v1/workflow/matrix"), 401)
    assert c.get("/api/v1/workflow/matrix", headers=s["docente1"]).status_code == 200


def test_fuera_de_desarrollo_la_app_no_cuenta_nada_sin_sesion():
    """Con APP_ENV=demostracion: sin documentación pública y salud sin detalles."""
    codigo = r"""
import importlib, json, os, sys
sys.path.insert(0, os.getcwd())
from fastapi.testclient import TestClient
app = importlib.import_module("main").app
with TestClient(app, raise_server_exceptions=False) as c:
    tok = c.post("/api/v1/auth/login", json={"correo": "docente1@demo.udv.edu.gt", "password": "Demo2026!"}).json()["access_token"]
    con = c.get("/api/v1/openapi.json", headers={"Authorization": "Bearer " + tok})
    print(json.dumps({
        "docs": c.get("/api/v1/docs").status_code,
        "esquema_sin_sesion": c.get("/api/v1/openapi.json").status_code,
        "esquema_con_sesion": con.status_code,
        "rutas": len(con.json().get("paths", {})) if con.status_code == 200 else 0,
        "health": c.get("/health").json(),
        "health_db": c.get("/health/db").json(),
        "app": c.get("/app/").status_code,
    }))
"""
    entorno = {**os.environ, "APP_ENV": "demostracion", "DATABASE_URL": URL,
               "SECRET_KEY": os.environ.get("SECRET_KEY", "clave-solo-para-pruebas-de-integracion-pm-32+")}
    entorno.pop("API_DOCS_PUBLICA", None)
    salida = subprocess.run([sys.executable, "-c", codigo], cwd=str(RAIZ.resolve()), env=entorno,
                            capture_output=True, text=True, timeout=120)
    assert salida.returncode == 0, salida.stderr[-800:]
    r = json.loads(salida.stdout.strip().splitlines()[-1])
    assert r["docs"] == 404 and r["esquema_sin_sesion"] == 401
    assert r["esquema_con_sesion"] == 200 and r["rutas"] > 50
    assert r["health"] == {"status": "ok"} and r["health_db"] == {"status": "ok"}
    assert r["app"] == 200
def test_texto_mas_largo_que_la_columna_da_422_y_no_error_interno(c, s):
    """Antes, un título de 201 caracteres daba 500 y un «Nivel» largo en el programa, 503."""
    largo = "Ñ" * 5000
    fecha = (date.today() + timedelta(days=10)).isoformat()
    r = c.post("/api/v1/tasks", headers=s["coordinacion"], json={"type_id": 4, "title": "T" * 201, "due_date": fecha})
    es_error_comun(r, 422)
    assert r.json()["error"]["details"]["field"] == "title"
    assert c.post("/api/v1/tasks", headers=s["coordinacion"],
                  json={"type_id": 4, "title": "T" * 200, "due_date": fecha}).status_code == 201
    es_error_comun(c.post("/api/v1/tasks", headers=s["coordinacion"],
                          json={"type_id": 4, "title": "x", "description": "d" * 10001, "due_date": fecha}), 422)

    a = _asignar_programa(c, s, docente=DOC1, course_id=1, period_id=2)
    vid = c.post(f"/api/v1/program-versions/for-assignment/{a}", headers=s["docente1"]).json()["id"]
    seccion = f"/api/v1/program-versions/{vid}/sections"
    r = c.put(f"{seccion}/general", headers=s["docente1"], json={"contenido": {"nivel": "N" * 16, "pensum": "P" * 51}})
    es_error_comun(r, 422)
    assert set(r.json()["error"]["details"]) == {"nivel", "pensum"}
    # «Nivel» solo admite los cuatro del esquema del G1; se acepta con mayúsculas y tildes.
    r = c.put(f"{seccion}/general", headers=s["docente1"], json={"contenido": {"nivel": "Posgrado"}})
    es_error_comun(r, 422)
    assert "licenciatura" in r.json()["error"]["details"]["nivel"]
    assert c.put(f"{seccion}/general", headers=s["docente1"],
                 json={"contenido": {"nivel": " Maestría ", "pensum": "P" * 50}}).status_code == 200
    assert c.get(f"/api/v1/program-versions/{vid}", headers=s["docente1"]).json()["secciones"]["general"]["contenido"]["nivel"] == "maestria"
    # Lo que no tiene una regla propia cae en la red común: 422, nunca 5xx ni detalles de la base.
    casos = [
        ("general", {"horas": 99999999999}), ("general", {"horas": "muchas"}),
        ("competencias", [{"descripcion": largo, "tipo": largo}]),
        ("contenidos", [{"titulo": largo, "temas": [largo]}]),
        ("bibliografia", [{"referencia": largo, "autor": largo}]),
        ("descripcion", {"texto": "x" * 70000}),
        ("competencias", [{}]), ("contenidos", [{}]), ("bibliografia", [{}]), ("evaluacion", [{}]),
        ("bibliografia", ["texto"]), ("contenidos", [1]), ("competencias", "x"),
    ]
    for nombre, contenido in casos:
        r = c.put(f"{seccion}/{nombre}", headers=s["docente1"], json={"contenido": contenido})
        assert r.status_code < 500, (nombre, r.status_code, r.text[:200])
        assert "pymysql" not in r.text and "sqlalchemy" not in r.text.lower(), nombre
