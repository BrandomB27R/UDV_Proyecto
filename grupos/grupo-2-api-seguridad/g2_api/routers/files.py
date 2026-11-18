import uuid # <----- Nombre interno aleatorio del archivo
from fastapi import APIRouter, File, UploadFile, HTTPException, Depends
import puremagic # <----- Dependencia Para verificar el tipo de archivo
from g2_api.middleware.auth_middleware import obtener_usuario_actual, requerir_permiso
from g2_api.models import Usuario
from pathlib import Path
from fastapi.responses import FileResponse
import hashlib

from sqlalchemy import text
from sqlalchemy.orm import Session

from g2_api import config
from g2_api.database import get_db
from g2_api.models import Archivo

# Crear un router para manejar las rutas relacionadas con archivos
router = APIRouter(
    prefix="/api/v1/files",
    tags=["Files"]
)


MAX_SIZE = 5 * 1024 * 1024  # 5 MB

# Definir los tipos de archivos permitidos y sus extensiones correspondientes
MIMETYPES_PERMITIDOS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png"
}

# Definir la ruta para verificar el archivo subido
@router.post("")
async def verificar_archivo(file: UploadFile = File(...),
    usuario_actual: Usuario = Depends(requerir_permiso("files.upload")),
    db: Session = Depends(get_db)
):
    # lee por bloques de 1 MB y corta apenas pasa el limite, sin cargar archivos enormes
    partes = []
    leidos = 0
    while True:
        bloque = await file.read(1024 * 1024)
        if not bloque:
            break
        leidos += len(bloque)
        if leidos > MAX_SIZE:
            raise HTTPException(
                status_code=400,
                detail="El archivo supera el límite de 5 MB"
            )
        partes.append(bloque)
    contenido = b"".join(partes)

    # un archivo vacio no es valido
    if not contenido:
        raise HTTPException(status_code=422, detail="El archivo está vacío.")
    # leer los primeros 2048 bytes del archivo para determinar su tipo real
    try:
        tipo_real = puremagic.from_string(contenido[:2048], mime=True)
    except (puremagic.PureError, ValueError):
        # si el archivo esta corrupto o no se puede determinar su tipo, se lanza una excepción HTTP
        raise HTTPException(
            status_code=400,
            detail="No se pudo leer el tipo de archivo. Solo se aceptan PDF, JPG o PNG sin dañar."
        )

    # Verificar si el tipo de archivo real está en la lista de tipos permitidos
    if tipo_real not in MIMETYPES_PERMITIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Formato no permitido ({tipo_real}). Solo se aceptan PDF, JPG o PNG."
        )

    # Generar un identificador único para el archivo y un nombre interno basado en el tipo de archivo
    file_id = str(uuid.uuid4())

    # Guardar el archivo f
    nombre_interno = (
        file_id +
        MIMETYPES_PERMITIDOS[tipo_real]
    )
    # la carpeta sale del .env (UPLOAD_DIR) para usar el volumen de Railway
    UPLOAD_DIR = Path(config.UPLOAD_DIR)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    ruta_archivo = UPLOAD_DIR / nombre_interno

    with open(ruta_archivo, "wb") as archivo:
        archivo.write(contenido)
        
    hash_sha256 = hashlib.sha256(contenido).hexdigest()

    nuevo_archivo = Archivo(
        nombre_original=file.filename,
        nombre_interno=nombre_interno,
        tipo_mime=tipo_real,
        tamano_bytes=len(contenido),
        hash_sha256=hash_sha256,
        ubicacion=str(ruta_archivo),
        autor_id=usuario_actual.id
    )

    try:
        db.add(nuevo_archivo)
        db.commit()
    except Exception:
        # si la base rechaza el registro, se borra el archivo para no dejarlo huerfano
        db.rollback()
        ruta_archivo.unlink(missing_ok=True)
        raise
    db.refresh(nuevo_archivo)
    
    # devolver el identificador único y el nombre interno del archivo
    return {
        "file_id": nuevo_archivo.id,
        "nombre_interno": nombre_interno
    }
    



# Tarea a la que pertenece un archivo: archivo -> entrega -> tarea_destinatario -> tarea (tablas del G1).
# Devuelve quien creo la tarea y el revisor designado (el del destinatario o, si no tiene, el de la tarea).
# Va con parametros (:entrega_id), nunca con texto armado a mano. Una tarea eliminada no da acceso.
_SQL_TAREA_DE_LA_ENTREGA = text(
    "SELECT t.creado_por, COALESCE(td.revisor_id, t.revisor_id) "
    "FROM entrega e "
    "JOIN tarea_destinatario td ON td.id = e.tarea_destinatario_id "
    "JOIN tarea t ON t.id = td.tarea_id "
    "WHERE e.id = :entrega_id AND t.eliminado_en IS NULL"
)


# Regla de descarga que decidio el PM (17-nov):
#  - dueño del archivo y admin: pueden siempre.
#  - auditoria: cualquier archivo ya vinculado a una entrega, un comentario o una version de programa.
#  - revisor: solo si el archivo es de una entrega de una tarea donde es el revisor designado
#    (si la tarea no tiene revisor designado, la revisa la coordinacion que la creo o un admin).
#  - coordinacion: solo si el archivo es de una entrega de una tarea que el creo.
#  - un archivo todavia suelto (sin vincular) solo lo descargan su dueño y el admin.
#  - docente ajeno, autoridad y cualquiera sin el permiso files.download: 403.
def _puede_descargar(db: Session, usuario: Usuario, registro: Archivo) -> bool:
    if registro.autor_id == usuario.id:
        return True
    roles = {rol.codigo for rol in usuario.roles}
    if "admin" in roles:
        return True
    # fuera del dueño y el admin, hace falta el permiso files.download (matriz del Grupo 1)
    if not any(p.codigo == "files.download" for rol in usuario.roles for p in rol.permisos):
        return False
    if "auditor" in roles:
        return any(v is not None for v in (registro.entrega_id, registro.comentario_id, registro.programa_version_id))
    # revisor y coordinacion: se valida la tarea de la entrega; sin entrega vinculada no hay acceso
    if registro.entrega_id is None or not roles & {"reviewer", "coordinator"}:
        return False
    fila = db.execute(_SQL_TAREA_DE_LA_ENTREGA, {"entrega_id": registro.entrega_id}).first()
    if fila is None:
        return False
    creador_id, revisor_id = fila
    if "coordinator" in roles and creador_id == usuario.id:
        return True
    # revisor designado (sea revisor o coordinacion). Sin revisor designado no descarga cualquier revisor:
    # esa tarea la revisa la coordinacion que la creo o un admin (decision B, revisada el 16-nov).
    return revisor_id == usuario.id


@router.get("/{id}")
async def descargar_archivo(
    id: int,
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
    db: Session = Depends(get_db)
):

    # un archivo eliminado se trata como si no existiera
    registro = db.query(Archivo).filter(
        Archivo.id == id,
        Archivo.eliminado_en.is_(None)
    ).first()

    if registro is None:
        raise HTTPException(
            status_code=404,
            detail="Archivo no encontrado"
        )

    # la autorizacion se decide en el servidor segun la tarea de la entrega (ver _puede_descargar)
    if not _puede_descargar(db, usuario_actual, registro):
        raise HTTPException(
        status_code=403,
        detail="No tienes permiso para acceder a este archivo"
    )

    ruta = Path(registro.ubicacion)

    if not ruta.exists():
        raise HTTPException(
            status_code=404,
            detail="Archivo no encontrado en almacenamiento"
        )

    return FileResponse(
        path=str(ruta),
        filename=registro.nombre_original
    )

