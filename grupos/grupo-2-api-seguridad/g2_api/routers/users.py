
from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from g2_api.database import get_db
from typing import Optional
import bcrypt
from g2_api.middleware.auth_middleware import requerir_permiso, requerir_rol
from g2_api.models import Auditoria, Rol, SesionToken, Usuario, UsuarioRol
from g2_api.routers.auth import obtener_usuario_actual
from g2_api.database import fijar_actor
from g2_api.utils.paginacion import params_paginacion, Paginacion, paginar
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1/users", tags=["Users"])

# largos iguales a la tabla usuario del Grupo 1: si se pasan da 422, no 500
class UsuarioCreate(BaseModel):
    nombres: str = Field(min_length=1, max_length=100)
    apellidos: str = Field(min_length=1, max_length=100)
    correo: EmailStr = Field(max_length=254)
    password: str = Field(min_length=8, max_length=64)
    # Un usuario puede tener varios roles (coordinación que además revisa y autoriza).
    # `roles` es la lista completa; `rol` se conserva para quien envía uno solo.
    rol: Optional[str] = Field(default=None, min_length=1, max_length=30)
    roles: Optional[list[str]] = Field(default=None, min_length=1, max_length=10)
    activo:bool = True

    @model_validator(mode="after")
    def _con_algun_rol(self):
        if not self.rol and not self.roles:
            raise ValueError("Indica al menos un rol en rol o en roles")
        return self

class UsuarioUpdate(BaseModel):
    nombres: Optional[str] = Field(default=None, min_length=1, max_length=100)
    apellidos: Optional[str] = Field(default=None, min_length=1, max_length=100)
    correo: Optional[EmailStr] = Field(default=None, max_length=254)
    password: Optional[str] = Field(default=None, min_length=8, max_length=64)
    rol: Optional[str] = Field(default=None, min_length=1, max_length=30)
    roles: Optional[list[str]] = Field(default=None, min_length=1, max_length=10)
    activo: Optional[bool] = None

def _fecha(f):
    if f is None:
        return None
    return f.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")

def _ip(request: Request):
    return request.client.host if request.client else None

def diccionario(u: Usuario) -> dict:
    return {
        "id": u.id,
        "correo": u.correo,
        "nombres": u.nombres,
        "apellidos": u.apellidos,
        "activo": u.activo,
        "roles": [i.codigo for i in u.roles],
        "creado_en": _fecha(u.creado_en),
        "actualizado_en": _fecha(u.actualizado_en)
    }


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode("utf-8")

def _buscar_usuario(db: Session, usuario_id: int) -> Usuario:
    u = db.get(Usuario, usuario_id)
    if u is None or u.eliminado_en is not None:
        raise HTTPException(
            status_code = status.HTTP_404_NOT_FOUND,
            detail="El usuario no se encontró o no existe"
        )
    return u
    
    
def _buscar_rol(db: Session, codigo: str) -> Rol:
    rol = db.query(Rol).filter(Rol.codigo == codigo, Rol.activo.is_(True)).first()
    if rol is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El rol indicado no existe"
        )
    return rol


def _roles_pedidos(db: Session, rol: Optional[str], roles: Optional[list[str]]) -> list[Rol]:
    """Los roles que se piden, sin repetir y en el orden dado. `roles` manda sobre `rol`."""
    codigos = list(dict.fromkeys(roles if roles else [rol]))
    return [_buscar_rol(db, c) for c in codigos]


def _auditar_roles(db: Session, usuario_id: int, actor_id: int, ip, antes: list[str], despues: list[str]):
    """Los triggers del G1 auditan la tabla usuario, no usuario_rol: el cambio de roles se anota aquí."""
    db.add(Auditoria(tabla="usuario", registro_id=str(usuario_id), accion="update", actor_id=actor_id,
                     ip_origen=ip, detalle={"antes": {"roles": antes}, "despues": {"roles": despues}}))


def _correo_repetido():
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="El correo ya está registrado"
    )
    

@router.get("", dependencies=[Depends(requerir_permiso("users.read"))]) # lectura: admin o quien tenga users.read (coordinacion) 
def listar_usuarios(paginacion: Paginacion =Depends(params_paginacion), db: Session = Depends(get_db)):
    
    consultas = (
        db.query(Usuario)
        .options(selectinload(Usuario.roles))
        .filter(Usuario.eliminado_en.is_(None))
        .order_by(Usuario.id)
    )
    
    return paginar(consultas, paginacion.page, paginacion.per_page, diccionario)


@router.get("/{usuario_id}", dependencies=[Depends(requerir_permiso("users.read"))])
def obtiene_usuario(usuario_id: int, db: Session = Depends(get_db)):
    return diccionario(_buscar_usuario(db, usuario_id))


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(requerir_rol(["admin"]))]) #Crea usuarios 
def crear_usuario(datos: UsuarioCreate, request: Request, db: Session = Depends(get_db), actual: Usuario = Depends(obtener_usuario_actual)): #recibe parámetro tipo class
    if db.query(Usuario).filter(Usuario.correo == datos.correo).first():
        raise _correo_repetido()
    
    
    roles = _roles_pedidos(db, datos.rol, datos.roles)
    
    nuevo = Usuario(
        correo=datos.correo,
        nombres=datos.nombres,
        apellidos=datos.apellidos,
        hash_contrasena=_hash(datos.password),
        activo=datos.activo
    )
    
    fijar_actor(db, actual.id, _ip(request))
    
    try:
        db.add(nuevo)
        db.flush()
        for rol in roles:
            db.add(UsuarioRol(usuario_id=nuevo.id, rol_id=rol.id, asignado_por=actual.id))
        _auditar_roles(db, nuevo.id, actual.id, _ip(request), [], [r.codigo for r in roles])
        db.commit()
    except IntegrityError as e:
        db.rollback()
        if "correo" in str(e.orig).lower():
            raise _correo_repetido()
        raise   
    
    db.refresh(nuevo)
    return diccionario(nuevo)
        

@router.patch("/{usuario_id}", dependencies=[Depends(requerir_rol(["admin"]))]) 
def actualizar_o_desactivar_usuario(usuario_id: int, datos: UsuarioUpdate, request: Request, db: Session = Depends(get_db), 
                                    actual: Usuario = Depends(obtener_usuario_actual)):
    
    fijar_actor(db, actual.id, _ip(request))
    u = _buscar_usuario(db, usuario_id)
    
    cambios = datos.model_dump(exclude_unset=True, exclude_none=True)
    
    if "correo" in cambios and cambios["correo"] != u.correo:
        if db.query(Usuario).filter(Usuario.correo == cambios["correo"]).first():
            raise _correo_repetido()
    
    # un admin no se desactiva, y nadie se quita a si mismo el rol de admin
    es_admin = any(r.codigo == "admin" for r in u.roles)
    if es_admin and cambios.get("activo") is False:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No se puede desactivar a un administrador.")
    nuevos_roles = None
    if "roles" in cambios or "rol" in cambios:
        nuevos_roles = _roles_pedidos(db, cambios.pop("rol", None), cambios.pop("roles", None))
    if es_admin and u.id == actual.id and nuevos_roles is not None and all(r.codigo != "admin" for r in nuevos_roles):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No puedes quitarte el rol de administrador.")
    if u.id == actual.id and cambios.get("activo") is False:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No puedes desactivar tu propia cuenta.")

    if "password" in cambios:
        u.hash_contrasena = _hash(cambios.pop("password"))
        # al cambiar la contraseña se cierran todas sus sesiones abiertas
        db.query(SesionToken).filter(
            SesionToken.usuario_id == u.id, SesionToken.revocado_en.is_(None)
        ).update({SesionToken.revocado_en: datetime.now(timezone.utc).replace(tzinfo=None)}, synchronize_session=False)
        
    if nuevos_roles is not None:
        antes = sorted(r.codigo for r in u.roles)
        despues = sorted(r.codigo for r in nuevos_roles)
        if antes != despues:
            db.query(UsuarioRol).filter(UsuarioRol.usuario_id == u.id).delete()
            for rol in nuevos_roles:
                db.add(UsuarioRol(usuario_id=u.id, rol_id=rol.id, asignado_por=actual.id))
            _auditar_roles(db, u.id, actual.id, _ip(request), antes, despues)

    if cambios.get("activo") is False:
        # al desactivar una cuenta se cierran sus sesiones abiertas
        db.query(SesionToken).filter(
            SesionToken.usuario_id == u.id, SesionToken.revocado_en.is_(None)
        ).update({SesionToken.revocado_en: datetime.now(timezone.utc).replace(tzinfo=None)}, synchronize_session=False)
        
    for campo, valor in cambios.items():
        setattr(u, campo, valor)
        
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _correo_repetido()
    
    db.refresh(u)
    return diccionario(u)
        
        