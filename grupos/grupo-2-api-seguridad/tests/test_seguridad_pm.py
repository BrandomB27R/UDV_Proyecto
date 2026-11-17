# Pruebas del PR de seguridad que pidio el PM (16-nov).
# Corren con la base SQLite temporal, igual que las demas.

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import InternalError, OperationalError
from sqlalchemy.orm import Session

from g2_api import config, openapi_docs
from g2_api.middleware.error_handler import registrar_manejadores
from g2_api.models import Usuario
from g2_api.routers import auth
from g2_api.seguridad import verificar_token
from tests.test_hallazgos_pm import CLAVE, _usuario_con_rol
from tests.test_users import (
    ADMIN_CORREO, ADMIN_CLAVE, LOGIN, URL, _crear, _login, headers_admin, sembrado,
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
