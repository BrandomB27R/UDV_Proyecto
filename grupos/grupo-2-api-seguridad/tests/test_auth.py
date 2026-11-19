# Pruebas de autenticación (Persona 1: Daniel): login, logout, /me, auditoría y bloqueo.
# Corren contra una base SQLite temporal (tests/conftest.py), nunca contra MySQL.
# Correr: pytest tests/test_auth.py -v

from datetime import datetime, timedelta, timezone

from g2_api import config
from g2_api.models import Auditoria, Permiso, Rol, RolPermiso, SesionToken, Usuario, UsuarioRol
from g2_api.seguridad import hash_token, hashear_contrasena, verificar_token

CORREO = "admin@demo.udv.edu.gt"
CLAVE = "Demo2026!"
URL = "/api/v1/auth/login"
URL_LOGOUT = "/api/v1/auth/logout"
URL_ME = "/api/v1/me"


def _crear_admin(db, activo=True):
    # Siembra el rol "admin" con un permiso y un usuario con ese rol, igual que los datos del Grupo 1.
    db.add(Rol(id=1, codigo="admin", nombre="Administrador"))
    db.add(Permiso(id=1, codigo="users.read", descripcion="Consultar usuarios"))
    db.add(
        Usuario(
            id=1,
            correo=CORREO,
            nombres="Ana",
            apellidos="Administradora",
            hash_contrasena=hashear_contrasena(CLAVE),
            activo=activo,
        )
    )
    db.flush()
    db.add(RolPermiso(rol_id=1, permiso_id=1))
    db.add(UsuarioRol(usuario_id=1, rol_id=1))
    db.commit()


def _token(client):
    return client.post(URL, json={"correo": CORREO, "password": CLAVE}).json()["access_token"]


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- LOGIN ----------

def test_login_correcto_devuelve_token(client, db):
    _crear_admin(db)
    r = client.post(URL, json={"correo": CORREO, "password": CLAVE})

    assert r.status_code == 200
    datos = r.json()
    assert datos["token_type"] == "bearer"
    assert datos["usuario"]["roles"] == ["admin"]
    assert "hash_contrasena" not in datos["usuario"]

    payload = verificar_token(datos["access_token"])
    assert payload is not None
    assert payload["sub"] == "1"


def test_login_guarda_solo_el_hash_del_token(client, db):
    _crear_admin(db)
    token = _token(client)

    sesion = db.query(SesionToken).filter_by(usuario_id=1).one()
    assert sesion.token_hash == hash_token(token)
    assert sesion.token_hash != token
    assert sesion.revocado_en is None


def test_login_contrasena_incorrecta_401(client, db):
    _crear_admin(db)
    r = client.post(URL, json={"correo": CORREO, "password": "otra-clave"})
    assert r.status_code == 401


def test_login_correo_inexistente_401(client, db):
    _crear_admin(db)
    r = client.post(URL, json={"correo": "nadie@demo.udv.edu.gt", "password": CLAVE})
    assert r.status_code == 401


def test_login_usuario_inactivo_401(client, db):
    _crear_admin(db, activo=False)
    r = client.post(URL, json={"correo": CORREO, "password": CLAVE})
    assert r.status_code == 401


def test_login_sin_password_422(client, db):
    r = client.post(URL, json={"correo": CORREO})
    assert r.status_code == 422


def test_token_alterado_no_es_valido(client, db):
    _crear_admin(db)
    assert verificar_token(_token(client) + "x") is None


# ---------- /me ----------

def test_me_con_token_devuelve_usuario_roles_y_permisos(client, db):
    _crear_admin(db)
    r = client.get(URL_ME, headers=_bearer(_token(client)))

    assert r.status_code == 200
    datos = r.json()
    assert datos["correo"] == CORREO
    assert datos["roles"] == ["admin"]
    assert datos["permisos"] == ["users.read"]
    assert "hash_contrasena" not in datos


def test_me_sin_token_401(client, db):
    r = client.get(URL_ME)
    assert r.status_code == 401


def test_me_con_token_falso_401(client, db):
    _crear_admin(db)
    r = client.get(URL_ME, headers=_bearer("esto.no.es-un-token"))
    assert r.status_code == 401


# ---------- LOGOUT ----------

def test_logout_cierra_la_sesion(client, db):
    _crear_admin(db)
    token = _token(client)

    r = client.post(URL_LOGOUT, headers=_bearer(token))
    assert r.status_code == 200

    # La sesión quedó marcada como cerrada en la base.
    db.expire_all()
    sesion = db.query(SesionToken).filter_by(token_hash=hash_token(token)).one()
    assert sesion.revocado_en is not None


def test_despues_del_logout_el_token_ya_no_sirve(client, db):
    _crear_admin(db)
    token = _token(client)
    client.post(URL_LOGOUT, headers=_bearer(token))

    assert client.get(URL_ME, headers=_bearer(token)).status_code == 401
    assert client.post(URL_LOGOUT, headers=_bearer(token)).status_code == 401


def test_logout_sin_token_401(client, db):
    r = client.post(URL_LOGOUT)
    assert r.status_code == 401


# ---------- AUDITORÍA (G2-36) ----------

def _acciones(db):
    db.expire_all()
    return [fila.accion for fila in db.query(Auditoria).order_by(Auditoria.id).all()]


def test_login_correcto_queda_en_auditoria(client, db):
    _crear_admin(db)
    _token(client)

    fila = db.query(Auditoria).filter_by(accion="LOGIN_OK").one()
    assert fila.actor_id == 1
    assert fila.tabla == "usuario"


def test_login_fallido_queda_en_auditoria(client, db):
    _crear_admin(db)
    client.post(URL, json={"correo": CORREO, "password": "otra-clave"})
    client.post(URL, json={"correo": "nadie@demo.udv.edu.gt", "password": "otra-clave"})

    assert _acciones(db) == ["LOGIN_FALLIDO", "LOGIN_FALLIDO"]


def test_logout_queda_en_auditoria(client, db):
    _crear_admin(db)
    client.post(URL_LOGOUT, headers=_bearer(_token(client)))

    assert _acciones(db) == ["LOGIN_OK", "LOGOUT"]


# ---------- LARGO DE LA CONTRASEÑA Y CAMPOS VACIOS (G2-04) ----------

def test_password_corta_422(client, db):
    _crear_admin(db)
    r = client.post(URL, json={"correo": CORREO, "password": "a" * (config.CONTRASENA_MIN - 1)})
    assert r.status_code == 422


def test_password_larga_422(client, db):
    _crear_admin(db)
    r = client.post(URL, json={"correo": CORREO, "password": "a" * (config.CONTRASENA_MAX + 1)})
    assert r.status_code == 422


def test_correo_vacio_422(client, db):
    r = client.post(URL, json={"correo": "", "password": CLAVE})
    assert r.status_code == 422


# ---------- BLOQUEO POR INTENTOS FALLIDOS (G2-34) ----------

def _usuario(db):
    db.expire_all()
    return db.get(Usuario, 1)


def test_bloqueo_despues_de_los_intentos_permitidos(client, db):
    _crear_admin(db)
    mala = {"correo": CORREO, "password": "otra-clave"}

    # los primeros intentos dan 401
    for _ in range(config.LOGIN_MAX_INTENTOS - 1):
        assert client.post(URL, json=mala).status_code == 401

    # el ultimo intento bloquea la cuenta para esta direccion
    assert client.post(URL, json=mala).status_code == 429
    # el bloqueo es de la direccion que fallo: la cuenta no queda marcada para todos
    assert _usuario(db).bloqueado_hasta is None

    # bloqueada: ni con la contraseña correcta entra desde aqui
    r = client.post(URL, json={"correo": CORREO, "password": CLAVE})
    assert r.status_code == 429
    assert "15 minutos" in r.text


def _fallos_y_bloqueos(db):
    db.expire_all()
    acciones = [a for (a,) in db.query(Auditoria.accion).order_by(Auditoria.id).all()]
    return acciones.count("LOGIN_FALLIDO"), acciones.count("LOGIN_BLOQUEADO")


def test_insistir_durante_el_bloqueo_no_lo_alarga(client, db):
    _crear_admin(db)
    mala = {"correo": CORREO, "password": "otra-clave"}
    for _ in range(config.LOGIN_MAX_INTENTOS):
        client.post(URL, json=mala)
    for _ in range(3):
        assert client.post(URL, json=mala).status_code == 429
    # los intentos hechos durante el bloqueo se anotan aparte y no cuentan como fallos nuevos
    assert _fallos_y_bloqueos(db) == (config.LOGIN_MAX_INTENTOS, 3)


def test_el_bloqueo_vence_solo(client, db):
    _crear_admin(db)
    mala = {"correo": CORREO, "password": "otra-clave"}
    for _ in range(config.LOGIN_MAX_INTENTOS):
        client.post(URL, json=mala)
    assert client.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 429
    # pasan los minutos del bloqueo
    hace_rato = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=config.LOGIN_BLOQUEO_MINUTOS + 1)
    db.query(Auditoria).update({"creado_en": hace_rato})
    db.commit()
    assert client.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 200


def test_fallar_la_clave_de_otro_no_lo_deja_fuera(db):
    """Quien falla se bloquea a si mismo: el dueño de la cuenta entra desde su propia direccion."""
    from fastapi.testclient import TestClient
    from g2_api.main import app
    _crear_admin(db)
    mala = {"correo": CORREO, "password": "otra-clave"}
    atacante = TestClient(app, client=("198.51.100.20", 50000))
    dueno = TestClient(app, client=("198.51.100.21", 50000))
    for _ in range(config.LOGIN_MAX_INTENTOS):
        atacante.post(URL, json=mala)
    assert atacante.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 429
    assert dueno.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 200
    # y el ingreso del dueño no le quita el bloqueo al otro
    assert atacante.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 429


def test_bloqueo_vencido_deja_entrar(client, db):
    _crear_admin(db)
    usuario = _usuario(db)
    usuario.bloqueado_hasta = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
    db.commit()

    r = client.post(URL, json={"correo": CORREO, "password": CLAVE})
    assert r.status_code == 200
    assert _usuario(db).bloqueado_hasta is None


def test_login_correcto_reinicia_el_contador(client, db):
    _crear_admin(db)
    mala = {"correo": CORREO, "password": "otra-clave"}
    for _ in range(config.LOGIN_MAX_INTENTOS - 1):
        assert client.post(URL, json=mala).status_code == 401

    assert client.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 200
    # tras entrar bien la cuenta empieza de cero: caben otra vez los mismos fallos sin bloquear
    for _ in range(config.LOGIN_MAX_INTENTOS - 1):
        assert client.post(URL, json=mala).status_code == 401
    assert client.post(URL, json={"correo": CORREO, "password": CLAVE}).status_code == 200
