from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from fastapi import Request
from sqlalchemy import func, text
from sqlalchemy.orm import Session

logger = logging.getLogger("g2_api.auditoria")


# --- Acciones reconocidas ---------------------------------------------------

LOGIN_OK        = "LOGIN_OK"
LOGIN_FALLIDO   = "LOGIN_FALLIDO"
LOGIN_BLOQUEADO = "LOGIN_BLOQUEADO"   # intento hecho mientras la dirección está bloqueada para esa cuenta
LOGOUT          = "LOGOUT"
ACCESS_DENIED   = "ACCESS_DENIED"
USER_CREATED    = "USER_CREATED"
USER_UPDATED    = "USER_UPDATED"
USER_DELETED    = "USER_DELETED"
ROLE_CREATED    = "ROLE_CREATED"
ROLE_UPDATED    = "ROLE_UPDATED"
FILE_UPLOADED   = "FILE_UPLOADED"
FILE_DOWNLOADED = "FILE_DOWNLOADED"


# --- Helpers ----------------------------------------------------------------

def _modelo_auditoria():
    """Si `models` aún no está, degradamos sin romper."""
    from g2_api.models import Auditoria  # type: ignore

    return Auditoria


def _modelo_intento():
    """Tabla `intento_login` """
    from g2_api.models import IntentoLogin  # type: ignore

    return IntentoLogin


def _ahora() -> datetime:
    """UTC naive (compatible con DATETIME de MySQL y con SQLite)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ip_del_request(request: Request | None) -> str | None:
    if request is None:
        return None
    cliente = getattr(request, "client", None)
    return getattr(cliente, "host", None) if cliente else None


def fijar_actor(db: Session, actor_id: int | None, ip: str | None = None) -> None:
    """CONTRATO_COMUN """
    try:
        dialecto = ""
        bind = getattr(db, "bind", None)
        if bind is not None and getattr(bind, "dialect", None) is not None:
            dialecto = bind.dialect.name
        if dialecto == "mysql":
            valor = int(actor_id) if actor_id is not None and actor_id > 0 else None
            db.execute(text("SET @actor_id = :id"), {"id": valor})
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo fijar @actor_id para triggers del G1")


set_actor_id = fijar_actor



def registrar_accion(
    db: Session,
    accion: str,
    *,
    tabla: str | None = None,
    registro_id: int | None = None,
    actor_id: int | None = None,
    detalle: Mapping[str, Any] | None = None,
    ip_origen: str | None = None,
) -> bool:
    """Inserta una fila en `auditoria`. True si se guardó, False si falló.
    """
    try:
        reg_id = int(registro_id) if registro_id is not None else 0
        act_id = actor_id if (actor_id is not None and actor_id > 0) else None

        Auditoria = _modelo_auditoria()
        fila = Auditoria(
            accion      = str(accion).upper(),
            actor_id    = act_id,
            tabla       = tabla or "",
            registro_id = reg_id,
            detalle     = dict(detalle) if detalle else None,
            ip_origen   = ip_origen,
            creado_en   = _ahora(),
        )
        db.add(fila)
        db.commit()
        return True
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("No se pudo registrar la acción %s", accion)
        return False


def registrar_login_ok(db: Session, actor_id: int, *, ip_origen: str | None = None) -> bool:
    return registrar_accion(db, LOGIN_OK, actor_id=actor_id, tabla="auth",
                            registro_id=actor_id, ip_origen=ip_origen)


def registrar_logout(db: Session, actor_id: int, *, ip_origen: str | None = None) -> bool:
    return registrar_accion(db, LOGOUT, actor_id=actor_id, tabla="auth",
                            registro_id=actor_id, ip_origen=ip_origen)


def registrar_login_fallido(
    db: Session, correo: str, *, ip_origen: str | None = None
) -> bool:
    """Registra un intento fallido en `auditoria` (histórico). Guarda IP."""
    correo_norm = (correo or "").strip().lower()
    actor_id: int | None = None
    try:
        if correo_norm:
            from g2_api.models import Usuario  # type: ignore

            u = db.query(Usuario).filter(Usuario.correo == correo_norm).first()
            if u is not None:
                actor_id = getattr(u, "id", None)
    except Exception:  # noqa: BLE001
        actor_id = None

    registro_id = actor_id if actor_id is not None else 0
    return registrar_accion(
        db, LOGIN_FALLIDO,
        actor_id    = actor_id,
        tabla       = "auth",
        registro_id = registro_id,
        detalle     = {"correo": correo_norm, "ip": ip_origen},
        ip_origen   = ip_origen,
    )



def registrar_intento_login(
    db: Session,
    correo: str,
    ip_origen: str | None,
    *,
    exito: bool = False,
) -> None:
    """Inserta una fila en `intento_login`.
    """
    try:
        Intento = _modelo_intento()
        db.add(Intento(
            correo     = (correo or "").strip().lower(),
            ip_origen  = ip_origen,
            exito      = bool(exito),
            creado_en  = _ahora(),
        ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("No se pudo registrar intento_login")




def _desde(minutos: int) -> datetime:
    return _ahora() - timedelta(minutes=int(minutos))


def contar_intentos_fallidos_par(
    db: Session, correo: str, ip_origen: str | None, minutos: int
) -> int:
    """Fallos del par (correo, IP) en la ventana. Si `ip_origen` es None, por correo."""
    try:
        Intento = _modelo_intento()
        q = db.query(Intento).filter(
            Intento.correo == (correo or "").strip().lower(),
            Intento.exito.is_(False),
            Intento.creado_en >= _desde(minutos),
        )
        if ip_origen is not None:
            q = q.filter(Intento.ip_origen == ip_origen)
        return int(q.count())
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo contar intentos por par")
        return 0


def contar_intentos_fallidos_por_ip(
    db: Session, ip_origen: str | None, minutos: int
) -> int:
    """Fallos desde una IP (cualquier correo) en la ventana."""
    if not ip_origen:
        return 0
    try:
        Intento = _modelo_intento()
        return int(
            db.query(Intento).filter(
                Intento.ip_origen == ip_origen,
                Intento.exito.is_(False),
                Intento.creado_en >= _desde(minutos),
            ).count()
        )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo contar intentos por IP")
        return 0


def esta_bloqueado_par(
    db: Session, correo: str, ip_origen: str | None,
    *, max_intentos: int, minutos: int,
) -> bool:
    return contar_intentos_fallidos_par(db, correo, ip_origen, minutos) >= int(max_intentos)


def esta_bloqueado_por_ip(
    db: Session, ip_origen: str | None,
    *, max_intentos_ip: int, minutos: int,
) -> bool:
    return contar_intentos_fallidos_por_ip(db, ip_origen, minutos) >= int(max_intentos_ip)



def contar_intentos_fallidos(
    db: Session, correo: str, minutos: int, *, ip_origen: str | None = None
) -> int:
    """Compatibilidad
    """
    try:
        from g2_api.models import IntentoLogin  # type: ignore  # noqa: F401
        return contar_intentos_fallidos_par(db, correo, ip_origen, minutos)
    except Exception:  # noqa: BLE001
        
        try:
            Auditoria = _modelo_auditoria()
            correo_norm = (correo or "").strip().lower()
            correo_en_detalle = func.json_extract(Auditoria.detalle, "$.correo")
            filtros = [
                Auditoria.accion == LOGIN_FALLIDO,
                correo_en_detalle == correo_norm,
                Auditoria.creado_en >= _desde(minutos),
            ]
            if ip_origen is not None:
                filtros.append(Auditoria.ip_origen == ip_origen)
            return int(db.query(Auditoria).filter(*filtros).count())
        except Exception:  # noqa: BLE001
            logger.exception("No se pudo contar intentos fallidos")
            return 0


def esta_bloqueado(
    db: Session, correo: str, *, max_intentos: int, minutos: int,
    ip_origen: str | None = None,
) -> bool:
    return contar_intentos_fallidos(db, correo, minutos, ip_origen=ip_origen) >= int(max_intentos)


def limpiar_intentos(db: Session, correo: str) -> None:
    """Borra intentos fallidos del correo en la tabla nueva y en auditoría."""
    correo_norm = (correo or "").strip().lower()
    try:
        Intento = _modelo_intento()
        db.query(Intento).filter(
            Intento.correo == correo_norm, Intento.exito.is_(False)
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    try:
        Auditoria = _modelo_auditoria()
        correo_en_detalle = func.json_extract(Auditoria.detalle, "$.correo")
        db.query(Auditoria).filter(
            Auditoria.accion == LOGIN_FALLIDO,
            correo_en_detalle == correo_norm,
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("No se pudieron limpiar los intentos fallidos")
