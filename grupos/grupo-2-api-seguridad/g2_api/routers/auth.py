# Autenticacion del Grupo 2 (Persona 1: Daniel)
# login: entra y recibe un token
# logout: cierra la sesion
# me: muestra quien soy, mis roles y permisos
# bloqueo: despues de 5 intentos fallidos la cuenta se bloquea 15 minutos

import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from g2_api import config
from g2_api.database import fijar_actor, get_db
from g2_api.models import Auditoria, SesionToken, Usuario
from g2_api.seguridad import crear_token, hash_token, hashear_contrasena, verificar_contrasena, verificar_token
from g2_api.utils.registro import LOGIN_FALLIDO, LOGIN_OK, LOGOUT, registrar_accion, registrar_login_fallido

router = APIRouter(prefix="/api/v1/auth", tags=["Autenticacion"])
me_router = APIRouter(prefix="/api/v1", tags=["Autenticacion"])

# hora actual en UTC
def _ahora_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)

# ---------- LOGIN ----------

# datos que recibe el login (vacios o fuera de largo dan 422)
class LoginRequest(BaseModel):
    correo: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=config.CONTRASENA_MIN, max_length=config.CONTRASENA_MAX)

# mismo mensaje para correo o contraseña mal
CREDENCIALES_INVALIDAS = "Correo o contraseña incorrectos"

# hash falso para la verificacion de relleno: se calcula una sola vez al cargar el modulo.
# Con el costo por defecto de bcrypt (el mismo de hashear_contrasena), tarda lo mismo que un hash real.
_HASH_FALSO = hashear_contrasena("contrasena-falsa-solo-para-igualar-tiempos")

# respuesta 401 que se muestra en /docs
RESPUESTA_401 = {401: {"description": "Token faltante, invalido, vencido o sesion cerrada"}}

# True si esta IP ya acumulo demasiados login fallidos en la ventana de bloqueo.
# Cuenta en auditoria (accion LOGIN_FALLIDO), porque el G1 no tiene tabla de intentos de login.
def _ip_bloqueada(db: Session, ip: str | None, ahora: datetime) -> bool:
    if not ip or config.LOGIN_MAX_INTENTOS_IP <= 0:
        return False
    desde = ahora - timedelta(minutes=config.LOGIN_BLOQUEO_MINUTOS)
    fallos = (
        db.query(func.count(Auditoria.id))
        .filter(Auditoria.accion == LOGIN_FALLIDO, Auditoria.ip_origen == ip, Auditoria.creado_en >= desde)
        .scalar()
    )
    return fallos >= config.LOGIN_MAX_INTENTOS_IP

# arma el error 429 con los minutos que faltan
def _cuenta_bloqueada(bloqueado_hasta: datetime, ahora: datetime):
    minutos = max(1, math.ceil((bloqueado_hasta - ahora).total_seconds() / 60))
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Cuenta bloqueada por intentos fallidos. Intenta de nuevo en {minutos} minutos.",
    )

@router.post(
    "/login",
    responses={
        401: {"description": "Correo o contraseña incorrectos"},
        422: {"description": "Correo vacio o contraseña fuera del largo permitido"},
        429: {"description": "Cuenta bloqueada por intentos fallidos o demasiados fallos desde la misma IP"},
    },
)
def login(datos: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else None
    ahora = _ahora_utc()

    # limite por IP: si esta IP ya fallo demasiado, se corta antes de mirar el correo (no revela si existe)
    if _ip_bloqueada(db, ip, ahora):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos fallidos desde esta dirección. Intenta de nuevo más tarde.",
        )

    # busca el usuario por correo
    usuario = (
        db.query(Usuario)
        .filter(Usuario.correo == datos.correo, Usuario.eliminado_en.is_(None))
        .first()
    )

    # si no existe o esta inactivo: guarda el intento y da 401
    if usuario is None or not usuario.activo:
        # verificacion falsa: gasta el mismo tiempo de bcrypt que un correo real y no se distingue por la demora
        verificar_contrasena(datos.password, _HASH_FALSO)
        registrar_login_fallido(db, datos.correo, ip_origen=ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=CREDENCIALES_INVALIDAS)

    # si esta bloqueado: da 429 aunque la contraseña este bien
    if usuario.bloqueado_hasta and usuario.bloqueado_hasta > ahora:
        registrar_login_fallido(db, datos.correo, ip_origen=ip)
        raise _cuenta_bloqueada(usuario.bloqueado_hasta, ahora)

    # si la contraseña esta mal: suma un intento y, al llegar al limite, bloquea
    if not verificar_contrasena(datos.password, usuario.hash_contrasena):
        fijar_actor(db, usuario.id, ip)
        # la base suma el intento en una sola sentencia: con peticiones al mismo tiempo no se pierde ninguno
        db.execute(
            update(Usuario)
            .where(Usuario.id == usuario.id)
            .values(intentos_fallidos=Usuario.intentos_fallidos + 1)
        )
        # y bloquea solo si ya llego al limite (la condicion va en la misma sentencia)
        db.execute(
            update(Usuario)
            .where(Usuario.id == usuario.id, Usuario.intentos_fallidos >= config.LOGIN_MAX_INTENTOS)
            .values(
                bloqueado_hasta=ahora + timedelta(minutes=config.LOGIN_BLOQUEO_MINUTOS),
                intentos_fallidos=0,
            )
        )
        db.commit()
        db.refresh(usuario)
        bloquear = usuario.bloqueado_hasta is not None and usuario.bloqueado_hasta > ahora
        registrar_login_fallido(db, datos.correo, ip_origen=ip)
        if bloquear:
            raise _cuenta_bloqueada(usuario.bloqueado_hasta, ahora)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=CREDENCIALES_INVALIDAS)

    # crea el token
    token, expira = crear_token(usuario.id)

    # guarda la sesion (solo la huella del token)
    db.add(
        SesionToken(
            usuario_id=usuario.id,
            token_hash=hash_token(token),
            tipo="access",
            expira_en=expira.replace(tzinfo=None),
            ip_origen=ip,
            user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        )
    )
    # login correcto: reinicia el contador y quita el bloqueo
    fijar_actor(db, usuario.id, ip)
    usuario.intentos_fallidos = 0
    usuario.bloqueado_hasta = None
    usuario.ultimo_acceso_en = ahora
    db.commit()

    # guarda el login en auditoria
    registrar_accion(db, LOGIN_OK, tabla="usuario", registro_id=usuario.id, actor_id=usuario.id, ip_origen=ip)

    # responde con el token y los datos del usuario
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": config.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "usuario": {
            "id": usuario.id,
            "correo": usuario.correo,
            "nombres": usuario.nombres,
            "apellidos": usuario.apellidos,
            "roles": [rol.codigo for rol in usuario.roles],
        },
    }

# ---------- REVISAR LA SESION ----------

# lee el header Authorization: Bearer <token>
_bearer = HTTPBearer(auto_error=False)

# arma el error 401
def _no_autenticado(mensaje: str):
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=mensaje,
        headers={"WWW-Authenticate": "Bearer"},
    )

# revisa que la sesion siga activa
def obtener_sesion_actual(
    credenciales: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> SesionToken:
    # trae token?
    if credenciales is None:
        raise _no_autenticado("Falta el token de autenticación")
    token = credenciales.credentials

    # el token es valido y no vencio
    payload = verificar_token(token)
    if payload is None:
        raise _no_autenticado("Token inválido o vencido")

    # la sesion existe y no se cerro
    sesion = (
        db.query(SesionToken)
        .filter(SesionToken.token_hash == hash_token(token), SesionToken.revocado_en.is_(None))
        .first()
    )
    if sesion is None:
        raise _no_autenticado("La sesión no existe o ya fue cerrada")

    # el usuario sigue activo?
    usuario = db.get(Usuario, sesion.usuario_id)
    if usuario is None or not usuario.activo or usuario.eliminado_en is not None:
        raise _no_autenticado("El usuario no está activo")

    return sesion

# devuelve el usuario de la sesion (para las rutas protegidas)
def obtener_usuario_actual(
    request: Request,
    sesion: SesionToken = Depends(obtener_sesion_actual),
    db: Session = Depends(get_db),
) -> Usuario:
    usuario = db.get(Usuario, sesion.usuario_id)

    # le dice a MySQL quien hace el cambio (funcion de Robert en database.py)
    fijar_actor(db, usuario.id, request.client.host if request.client else None)

    return usuario

# ---------- LOGOUT ----------

@router.post("/logout", responses=RESPUESTA_401)
def logout(
    request: Request,
    sesion: SesionToken = Depends(obtener_sesion_actual),
    db: Session = Depends(get_db),
):
    # cierra la sesion guardando la hora
    sesion.revocado_en = _ahora_utc()
    db.commit()

    # guarda el logout en auditoria
    registrar_accion(
        db,
        LOGOUT,
        tabla="sesion_token",
        registro_id=sesion.id,
        actor_id=sesion.usuario_id,
        ip_origen=request.client.host if request.client else None,
    )
    return {"mensaje": "Sesión cerrada"}

# ---------- ME ----------

@me_router.get("/me", responses=RESPUESTA_401)
def me(usuario: Usuario = Depends(obtener_usuario_actual)):
    # junta los permisos de todos sus roles sin repetir
    permisos = sorted({p.codigo for rol in usuario.roles for p in rol.permisos})

    # devuelve sus datos, nunca la contraseña
    return {
        "id": usuario.id,
        "correo": usuario.correo,
        "nombres": usuario.nombres,
        "apellidos": usuario.apellidos,
        "activo": usuario.activo,
        "roles": [rol.codigo for rol in usuario.roles],
        "permisos": permisos,
    }

