# Pruebas del PR de seguridad que pidio el PM (16-nov).
# Corren con la base SQLite temporal, igual que las demas.

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import InternalError, OperationalError
from sqlalchemy.orm import Session

from g2_api import config, openapi_docs
from g2_api.middleware.error_handler import registrar_manejadores
from g2_api.models import Archivo, Permiso, Rol, RolPermiso, Usuario, UsuarioRol
from g2_api.routers import auth
from g2_api.seguridad import hashear_contrasena, verificar_token
from tests.test_hallazgos_pm import CLAVE, _archivo, _usuario_con_rol
from tests.test_users import (
    ADMIN_CORREO, ADMIN_CLAVE, DOCENTE_CORREO, DOCENTE_CLAVE, LOGIN, URL, _crear, _login, headers_admin, sembrado,
)

PDF = b"%PDF-1.4 prueba"

# ---------- 1. errores de los triggers del G1 ----------

def _app_que_falla(error):
    app = FastAPI()
    registrar_manejadores(app)

    @app.get("/x")
    def _x():
        raise error

    return TestClient(app, raise_server_exceptions=False)

@pytest.mark.parametrize("mensaje, estado", [
    ("ERROR: transicion no permitida por el workflow de la tarea (409)", 409),
    ("ERROR: una devolucion exige una observacion (422)", 422),
])
def test_trigger_del_g1_se_traduce(mensaje, estado):
    r = _app_que_falla(OperationalError("UPDATE x", {}, Exception(1644, mensaje))).get("/x")
    assert r.status_code == estado
    error = r.json()["error"]
    assert "(409)" not in error["message"] and "(422)" not in error["message"]
    assert error["details"] == {}

def test_otro_error_de_base_sigue_siendo_500_sin_detalles():
    r = _app_que_falla(InternalError("SELECT 1", {}, Exception(2013, "se perdio la conexion"))).get("/x")
    assert r.status_code == 500
    assert "conexion" not in r.text

# ---------- 2, 3 y 4. subida de archivos ----------

def test_archivo_vacio_da_422(client, headers_admin, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))
    r = client.post("/api/v1/files", files={"file": ("vacio.pdf", b"", "application/pdf")}, headers=headers_admin)
    assert r.status_code == 422

def test_si_falla_el_insert_no_queda_archivo(client, headers_admin, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))

    def commit_que_falla(self):
        raise OperationalError("INSERT archivo", {}, Exception(1062, "duplicado"))

    monkeypatch.setattr(Session, "commit", commit_que_falla)
    try:
        r = client.post("/api/v1/files", files={"file": ("a.pdf", PDF, "application/pdf")}, headers=headers_admin)
        assert r.status_code == 500
    except OperationalError:
        pass  # segun la version, el cliente de pruebas puede relanzar el error
    assert list(tmp_path.iterdir()) == []

def test_sin_permiso_files_upload_da_403(client, db, sembrado, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))
    _usuario_con_rol(db, 8, "sinsubir@demo.udv.edu.gt", "authority", ["files.download"])
    headers = _login(client, "sinsubir@demo.udv.edu.gt", CLAVE)
    r = client.post("/api/v1/files", files={"file": ("a.pdf", PDF, "application/pdf")}, headers=headers)
    assert r.status_code == 403

def test_con_permiso_files_upload_sube(client, db, sembrado, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))
    _usuario_con_rol(db, 9, "sube@demo.udv.edu.gt", "docente_sube", ["files.upload"])
    headers = _login(client, "sube@demo.udv.edu.gt", CLAVE)
    r = client.post("/api/v1/files", files={"file": ("a.pdf", PDF, "application/pdf")}, headers=headers)
    assert r.status_code == 200

def test_archivo_muy_grande_se_corta_por_bloques(client, headers_admin, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))
    grande = PDF + b"0" * (5 * 1024 * 1024)
    r = client.post("/api/v1/files", files={"file": ("g.pdf", grande, "application/pdf")}, headers=headers_admin)
    assert r.status_code == 400
    assert list(tmp_path.iterdir()) == []

# ---------- 5. contador de intentos ----------

def test_el_contador_usa_el_valor_de_la_base(client, db, sembrado):
    # otra peticion ya dejo 4 fallos en la base: el siguiente fallo debe bloquear
    db.query(Usuario).filter_by(correo=ADMIN_CORREO).update({"intentos_fallidos": config.LOGIN_MAX_INTENTOS - 1})
    db.commit()
    r = client.post(LOGIN, json={"correo": ADMIN_CORREO, "password": "Clave-Mala-1!"})
    assert r.status_code == 429

# ---------- 6. Swagger no se cae ----------

def test_swagger_sale_aunque_fallen_los_ejemplos(monkeypatch):
    app = FastAPI()
    app.include_router(auth.router)
    openapi_docs.completar_openapi(app)

    def falla():
        raise RuntimeError("ejemplo roto")

    monkeypatch.setattr(openapi_docs, "_rutas_del_g2", falla)
    assert "/api/v1/auth/login" in app.openapi()["paths"]

# ---------- acordado con el PM: token, admin y sesiones ----------

def _token(**payload):
    return jwt.encode(payload, config.SECRET_KEY, algorithm=config.ALGORITHM)

def test_token_sin_exp_o_sin_sub_no_sirve():
    vence = datetime.now(timezone.utc) + timedelta(minutes=5)
    assert verificar_token(_token(sub="1", tipo="access")) is None
    assert verificar_token(_token(exp=vence, tipo="access")) is None
    assert verificar_token(_token(sub="abc", exp=vence, tipo="access")) is None
    assert verificar_token(_token(sub="1", exp=vence, tipo="otro")) is None
    assert verificar_token(_token(sub="1", exp=vence, tipo="access")) is not None

def test_no_se_desactiva_a_un_admin(client, headers_admin):
    r = client.patch(f"{URL}/1", json={"activo": False}, headers=headers_admin)
    assert r.status_code == 409

def test_el_admin_no_se_quita_su_propio_rol(client, headers_admin):
    r = client.patch(f"{URL}/1", json={"rol": "teacher"}, headers=headers_admin)
    assert r.status_code == 409

def test_cambiar_la_clave_cierra_las_sesiones(client, headers_admin):
    usuario = _crear(client, headers_admin, password="Clave-Vieja-1!")
    headers_usuario = _login(client, usuario["correo"], "Clave-Vieja-1!")
    assert client.get("/api/v1/me", headers=headers_usuario).status_code == 200

    r = client.patch(f"{URL}/{usuario['id']}", json={"password": "Clave-Nueva-1!"}, headers=headers_admin)
    assert r.status_code == 200
    assert client.get("/api/v1/me", headers=headers_usuario).status_code == 401

# ---------- 17-nov: Descarga según la tarea de la entrega (Decision del PM) ----------

@pytest.fixture()
def tablas_de_tareas(db):
    # copia minima de las tablas del G1 que usa la regla de descarga (en la SQLite de pruebas no existen)
    for tabla in ("entrega", "tarea_destinatario", "tarea"):
        db.execute(text(f"DROP TABLE IF EXISTS {tabla}"))
    db.execute(text("CREATE TABLE tarea (id INTEGER PRIMARY KEY, creado_por INTEGER, revisor_id INTEGER, eliminado_en DATETIME)"))
    db.execute(text("CREATE TABLE tarea_destinatario (id INTEGER PRIMARY KEY, tarea_id INTEGER, usuario_id INTEGER, revisor_id INTEGER)"))
    db.execute(text("CREATE TABLE entrega (id INTEGER PRIMARY KEY, tarea_destinatario_id INTEGER)"))
    db.commit()

def _usuario_en_rol(db, uid, correo, rol_id):
    db.add(Usuario(id=uid, correo=correo, nombres="Prueba", apellidos="Rol",
                   hash_contrasena=hashear_contrasena(CLAVE), activo=True))
    db.flush()
    db.add(UsuarioRol(usuario_id=uid, rol_id=rol_id))
    db.commit()

def _archivo_de_entrega(db, tmp_path, creador_id, revisor_tarea=None, revisor_destinatario=None, entrega=True):
    # tarea 1 creada por `creador_id`, con un destinatario (el docente 2) y su entrega 1; el archivo es del docente
    db.execute(text("INSERT INTO tarea (id, creado_por, revisor_id) VALUES (1, :c, :r)"),
               {"c": creador_id, "r": revisor_tarea})
    db.execute(text("INSERT INTO tarea_destinatario (id, tarea_id, usuario_id, revisor_id) VALUES (1, 1, 2, :r)"),
               {"r": revisor_destinatario})
    db.execute(text("INSERT INTO entrega (id, tarea_destinatario_id) VALUES (1, 1)"))
    archivo_id = _archivo(db, tmp_path, autor_id=2)
    if entrega:
        db.query(Archivo).filter_by(id=archivo_id).update({"entrega_id": 1})
    db.commit()
    return archivo_id

@pytest.fixture()
def roles_de_descarga(db, sembrado):
    # cuatro roles del G1, todos con files.download (como en la matriz)
    db.add(Permiso(id=50, codigo="files.download", descripcion="Descargar archivos"))
    for rol_id, codigo in ((15, "reviewer"), (17, "coordinator"), (19, "auditor"), (20, "authority")):
        db.add(Rol(id=rol_id, codigo=codigo, nombre=codigo))
    db.flush()
    for rol_id in (15, 17, 19, 20):
        db.add(RolPermiso(rol_id=rol_id, permiso_id=50))
    db.commit()
    # revisores 5 y 6, coordinaciones 7 y 8, auditoria 9 y autoridad 10
    _usuario_en_rol(db, 5, "revisor@demo.udv.edu.gt", 15)
    _usuario_en_rol(db, 6, "revisor2@demo.udv.edu.gt", 15)
    _usuario_en_rol(db, 7, "coord@demo.udv.edu.gt", 17)
    _usuario_en_rol(db, 8, "coord2@demo.udv.edu.gt", 17)
    _usuario_en_rol(db, 9, "auditor@demo.udv.edu.gt", 19)
    _usuario_en_rol(db, 10, "autoridad@demo.udv.edu.gt", 20)

def _descargar(client, correo, archivo_id, clave=CLAVE):
    return client.get(f"/api/v1/files/{archivo_id}", headers=_login(client, correo, clave)).status_code

@pytest.mark.parametrize("correo, esperado", [
    ("revisor@demo.udv.edu.gt", 200), # revisor designado de la tarea
    ("revisor2@demo.udv.edu.gt", 403), # otro revisor: la tarea ya tiene uno designado
    ("coord@demo.udv.edu.gt", 200), # coordinacion que creo la tarea
    ("coord2@demo.udv.edu.gt", 403), # otra coordinacion
    ("auditor@demo.udv.edu.gt", 200), # auditoria baja archivos vinculados
    ("autoridad@demo.udv.edu.gt", 403), # autoridad ya no descarga por id
])
def test_descarga_de_una_entrega_segun_la_tarea(client, db, tablas_de_tareas, roles_de_descarga, tmp_path, correo, esperado):
    archivo_id = _archivo_de_entrega(db, tmp_path, creador_id=7, revisor_tarea=5)
    assert _descargar(client, correo, archivo_id) == esperado

def test_tarea_sin_revisor_designado_cualquier_revisor_descarga(client, db, tablas_de_tareas, roles_de_descarga, tmp_path):
    archivo_id = _archivo_de_entrega(db, tmp_path, creador_id=7)
    assert _descargar(client, "revisor@demo.udv.edu.gt", archivo_id) == 200
    assert _descargar(client, "revisor2@demo.udv.edu.gt", archivo_id) == 200

def test_el_revisor_del_destinatario_manda_sobre_el_de_la_tarea(client, db, tablas_de_tareas, roles_de_descarga, tmp_path):
    archivo_id = _archivo_de_entrega(db, tmp_path, creador_id=7, revisor_tarea=5, revisor_destinatario=6)
    assert _descargar(client, "revisor2@demo.udv.edu.gt", archivo_id) == 200
    assert _descargar(client, "revisor@demo.udv.edu.gt", archivo_id) == 403

@pytest.mark.parametrize("correo", [
    "revisor@demo.udv.edu.gt", "coord@demo.udv.edu.gt", "auditor@demo.udv.edu.gt", "autoridad@demo.udv.edu.gt",
])
def test_archivo_sin_entrega_solo_dueno_y_admin(client, db, tablas_de_tareas, roles_de_descarga, tmp_path, correo):
    archivo_id = _archivo_de_entrega(db, tmp_path, creador_id=7, revisor_tarea=5, entrega=False)
    assert _descargar(client, correo, archivo_id) == 403

def test_admin_y_dueno_descargan_un_archivo_sin_entrega(client, db, tablas_de_tareas, roles_de_descarga, tmp_path):
    archivo_id = _archivo_de_entrega(db, tmp_path, creador_id=7, revisor_tarea=5, entrega=False)
    assert _descargar(client, ADMIN_CORREO, archivo_id, ADMIN_CLAVE) == 200
    assert _descargar(client, DOCENTE_CORREO, archivo_id, DOCENTE_CLAVE) == 200

def test_tarea_eliminada_no_da_acceso_al_revisor(client, db, tablas_de_tareas, roles_de_descarga, tmp_path):
    archivo_id = _archivo_de_entrega(db, tmp_path, creador_id=7, revisor_tarea=5)
    db.execute(text("UPDATE tarea SET eliminado_en = CURRENT_TIMESTAMP WHERE id = 1"))
    db.commit()
    assert _descargar(client, "revisor@demo.udv.edu.gt", archivo_id) == 403

# ---------- 17-nov: login, verificacion falsa y limite por IP ----------

def test_correo_inexistente_tambien_verifica_una_contrasena(client, db, sembrado, monkeypatch):
    # sin una verificacion falsa, el correo inexistente respondia mas rapido que uno real
    llamadas = []
    original = auth.verificar_contrasena
    monkeypatch.setattr(auth, "verificar_contrasena", lambda *a: llamadas.append(a) or original(*a))
    r = client.post(LOGIN, json={"correo": "nadie@demo.udv.edu.gt", "password": "Clave-Mala-1!"})
    assert r.status_code == 401
    assert len(llamadas) == 1
    assert llamadas[0][1] == auth._HASH_FALSO

def test_una_ip_con_muchos_fallos_recibe_429(client, db, sembrado, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_MAX_INTENTOS_IP", 3)
    for i in range(3):
        r = client.post(LOGIN, json={"correo": f"nadie{i}@demo.udv.edu.gt", "password": "Clave-Mala-1!"})
        assert r.status_code == 401
    # ya no deja entrar ni con una cuenta y una clave correctas, y no dice si el correo existe
    r = client.post(LOGIN, json={"correo": ADMIN_CORREO, "password": ADMIN_CLAVE})
    assert r.status_code == 429

def test_el_limite_por_ip_se_puede_desactivar(client, db, sembrado, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_MAX_INTENTOS_IP", 0)
    for i in range(4):
        client.post(LOGIN, json={"correo": f"nadie{i}@demo.udv.edu.gt", "password": "Clave-Mala-1!"})
    r = client.post(LOGIN, json={"correo": ADMIN_CORREO, "password": ADMIN_CLAVE})
    assert r.status_code == 200

