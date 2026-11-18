"""
g4_inbox.database — Conexión real a MySQL (reemplaza datos_ejemplo.py / DETALLE_EXTRA)

Lee de las vistas que ya publicó G1: v_inbox, v_panel_tarea, v_historial_tarea,
más las tablas base (tarea, tarea_destinatario, entrega_borrador, comentario,
archivo, entrega) para el detalle completo.

VERSIÓN 2 — ajustada al aviso del PM del 14 de octubre:
- Usa SQLAlchemy con DATABASE_URL (.env), igual que g2_api/database.py —
  no una conexión manual con pymysql como en la primera versión.
- SET @actor_id se ejecuta en cada conexión que haga escrituras, para que
  los triggers de auditoría de G1 registren quién hizo cada cambio (la
  lectura no lo necesita, pero queda listo para cuando las transiciones
  empiecen a escribir en la base real).

VERSIÓN 3 — hallazgos de QA del 12 y 13 de noviembre:
- Comentarios y borrador se guardan en la base (comentario, entrega_borrador),
  ya no en memoria.
- Vincular un archivo valida que exista en archivo (sin eliminar), busca o
  crea la fila de entrega del intento actual y le pone archivo.entrega_id.
- @actor_id se limpia al devolver cada conexión al pool, como en G2.
- La entrega que crea G4 lleva el texto del borrador, como la que crea G3.

VERSIÓN 4 — pendientes técnicos aprobados por el PM (17-nov):
- Ya no abre su propio grupo de conexiones: usa la sesión compartida de G2
  (CONTRATO_COMUN §1). Railway permite 10 conexiones por usuario y antes G4
  ocupaba las suyas además de las de G2. La conexión de G2 ya trabaja en UTC
  y limpia @actor_id al devolverse; el actor se fija con fijar_actor de G2.
- El detalle dice cómo se entrega según el tipo de tarea (modalidad,
  extensiones y tamaño de tipo_tarea, limitados a lo que acepta G2) y, en
  las tareas de programa, la versión del programa de esa asignación. El
  borrador guarda esa versión para que G3 la copie a la entrega.
"""

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError

# Conexión compartida de G2: un solo grupo de conexiones para toda la app.
from g2_api.database import SessionLocal, engine, fijar_actor  # noqa: F401
# Lo que acepta hoy POST /api/v1/files de G2 (tipo y tamaño).
from g2_api.routers.files import MAX_SIZE as _G2_MAX_BYTES, MIMETYPES_PERMITIDOS as _G2_TIPOS

from .inbox import Asignacion

# Estados en los que el docente todavía puede cambiar su entrega. Es el mismo
# criterio del trigger trg_entrega_borrador_bi de G1.
ESTADOS_PENDIENTES = ("assigned", "in_progress", "returned")


class ErrorConflicto(Exception):
    """La base rechazó el cambio por el estado de la asignación (se responde 409)."""


class ArchivoNoEncontrado(Exception):
    """El archivo no existe, está eliminado o no es del usuario (se responde 404)."""


_ACCION_POR_TRANSICION = {
    ("assigned", "in_progress"): "start",
    ("in_progress", "submitted"): "submit",
    ("returned", "submitted"): "resubmit",
    ("submitted", "under_review"): "review",
    ("under_review", "returned"): "return",
    ("under_review", "approved"): "approve",
    ("approved", "closed"): "close",
    (None, "assigned"): "publish",
}


def _sesion(actor_id: Optional[int] = None):
    sesion = SessionLocal()
    if actor_id is not None:
        fijar_actor(sesion, actor_id)   # @actor_id para la auditoría de G1
    return sesion


def fetch_asignaciones_inbox(usuario_id: Optional[int] = None) -> List[Asignacion]:
    sql = """
        SELECT v.asignacion_id, v.usuario_id, v.tarea_id, v.titulo, v.tipo_codigo,
               v.estado_codigo, v.prioridad, v.fecha_limite,
               cu.codigo AS curso_codigo, cu.nombre AS curso_nombre, pe.codigo AS periodo_codigo
        FROM v_inbox v
        JOIN tarea t ON t.id = v.tarea_id
        LEFT JOIN curso cu ON cu.id = t.curso_id
        LEFT JOIN periodo pe ON pe.id = t.periodo_id
    """
    parametros = {}
    if usuario_id is not None:
        sql += " WHERE v.usuario_id = :usuario_id"
        parametros["usuario_id"] = usuario_id

    sesion = _sesion()
    try:
        filas = sesion.execute(text(sql), parametros).mappings().all()
    finally:
        sesion.close()

    resultado = []
    for fila in filas:
        fecha = fila["fecha_limite"]
        due_at = fecha.date() if isinstance(fecha, (date, datetime)) else None
        resultado.append(Asignacion(
            id=fila["asignacion_id"],
            assignee_id=fila["usuario_id"],
            title=fila["titulo"],
            task_type=fila["tipo_codigo"],
            status=fila["estado_codigo"],
            priority=fila["prioridad"],
            due_at=due_at,
            task_id=fila["tarea_id"],
            course_code=fila["curso_codigo"],
            course_name=fila["curso_nombre"],
            period_code=fila["periodo_codigo"],
        ))
    return resultado


def fetch_detalle_asignacion(assignment_id: int) -> Optional[dict]:
    sesion = _sesion()
    try:
        # tarea no se une directo con tipo_tarea — pasa por workflow:
        # tarea.workflow_id -> workflow.tipo_tarea_id -> tipo_tarea.id
        cabecera = sesion.execute(text("""
            SELECT td.id AS asignacion_id, td.usuario_id, td.estado_codigo,
                   t.id AS tarea_id, t.titulo, t.descripcion, t.prioridad,
                   t.programa_version_id, tt.codigo AS tipo_codigo,
                   tt.requiere_archivo, tt.modalidad_entrega, tt.extensiones, tt.tamano_max_mb,
                   COALESCE(td.fecha_limite, t.fecha_limite) AS fecha_limite,
                   -- Revisor designado como lo lee G3: el de la asignación y, si no tiene, el de la tarea.
                   COALESCE(td.revisor_id, t.revisor_id) AS revisor_id,
                   CONCAT(rv.nombres, ' ', rv.apellidos) AS revisor_nombre,
                   CONCAT(doc.nombres, ' ', doc.apellidos) AS docente_nombre,
                   t.creado_por, CONCAT(cr.nombres, ' ', cr.apellidos) AS creador_nombre,
                   t.curso_id, cu.codigo AS curso_codigo, cu.nombre AS curso_nombre,
                   t.periodo_id, pe.codigo AS periodo_codigo
            FROM tarea_destinatario td
            JOIN tarea t ON t.id = td.tarea_id
            JOIN workflow w ON w.id = t.workflow_id
            JOIN tipo_tarea tt ON tt.id = w.tipo_tarea_id
            JOIN usuario doc ON doc.id = td.usuario_id
            JOIN usuario cr ON cr.id = t.creado_por
            LEFT JOIN usuario rv ON rv.id = COALESCE(td.revisor_id, t.revisor_id)
            LEFT JOIN curso cu ON cu.id = t.curso_id
            LEFT JOIN periodo pe ON pe.id = t.periodo_id
            WHERE td.id = :id
        """), {"id": assignment_id}).mappings().first()
        if cabecera is None:
            return None

        borrador = sesion.execute(text("""
            SELECT contenido_texto, programa_version_id FROM entrega_borrador
            WHERE tarea_destinatario_id = :id
        """), {"id": assignment_id}).mappings().first()

        version = None
        if cabecera["modalidad_entrega"] == "programa":
            version = _version_de_programa(sesion, assignment_id)

        # Un intento por fila de `entrega`: el texto que quedó en cada uno.
        intentos = sesion.execute(text("""
            SELECT numero_intento, contenido_texto, entregado_en
            FROM entrega WHERE tarea_destinatario_id = :id
            ORDER BY numero_intento
        """), {"id": assignment_id}).mappings().all()

        comentarios = sesion.execute(text(_SQL_COMENTARIOS + """
            WHERE c.tarea_destinatario_id = :id AND c.eliminado_en IS NULL
            ORDER BY c.id
        """), {"id": assignment_id}).mappings().all()

        archivos = sesion.execute(text("""
            SELECT a.id AS file_id, a.nombre_original AS name, a.tipo_mime AS mime,
                   a.tamano_bytes AS size, a.creado_en AS uploaded_at,
                   e.numero_intento AS attempt
            FROM archivo a
            JOIN entrega e ON e.id = a.entrega_id
            WHERE e.tarea_destinatario_id = :id AND a.eliminado_en IS NULL
            ORDER BY e.numero_intento, a.id
        """), {"id": assignment_id}).mappings().all()

        # Se ordena por id y no por fecha: la semilla de G1 y G3 no guardan
        # las fechas en la misma zona horaria, y por fecha el orden sale mal.
        historial = sesion.execute(text("""
            SELECT estado_anterior, estado_nuevo, actor, comentario, creado_en
            FROM v_historial_tarea
            WHERE asignacion_id = :id
            ORDER BY transicion_id
        """), {"id": assignment_id}).mappings().all()
    finally:
        sesion.close()

    fecha = cabecera["fecha_limite"]
    due_at = fecha.isoformat() if isinstance(fecha, (date, datetime)) else None

    def _iso(valor):
        # La conexión está en UTC: se marca con "Z" para que la pantalla
        # sepa convertirla a hora de Guatemala (regla del PM, 16-nov).
        return valor.isoformat(timespec="minutes") + "Z" if isinstance(valor, datetime) else None

    # El comentario de la última devolución o aprobación. G3 lo guarda en el
    # historial de transiciones (tarea_transicion.comentario), no en la tabla
    # comentario.
    def _ultima(estado):
        filas = [h for h in historial if h["estado_nuevo"] == estado]
        if not filas:
            return None
        h = filas[-1]
        return {"comment": h["comentario"], "at": _iso(h["creado_en"]), "actor": h["actor"]}

    ultima_devolucion = _ultima("returned")
    ultima_aprobacion = _ultima("approved")

    return {
        "id": cabecera["asignacion_id"],
        "task_id": cabecera["tarea_id"],
        "assignee_id": cabecera["usuario_id"],
        "assignee_name": cabecera["docente_nombre"],
        "reviewer_id": cabecera["revisor_id"],
        "reviewer_name": cabecera["revisor_nombre"],
        "created_by": cabecera["creado_por"],
        "created_by_name": cabecera["creador_nombre"],
        "course_id": cabecera["curso_id"],
        "course_code": cabecera["curso_codigo"],
        "course_name": cabecera["curso_nombre"],
        "period_id": cabecera["periodo_id"],
        "period_code": cabecera["periodo_codigo"],
        "title": cabecera["titulo"],
        "task_type": cabecera["tipo_codigo"],
        "requiere_archivo": bool(cabecera["requiere_archivo"]),
        "status": cabecera["estado_codigo"],
        "priority": cabecera["prioridad"],
        "due_at": due_at,
        "instructions": cabecera["descripcion"] or "",
        "program_version_id": cabecera["programa_version_id"],
        "delivery": _forma_de_entrega(cabecera),
        "program_version": version,
        "draft_comment": borrador["contenido_texto"] if borrador else None,
        "comments": [_comentario(c) for c in comentarios],
        "attempts": [{"number": i["numero_intento"], "text": i["contenido_texto"],
                      "created_at": _iso(i["entregado_en"])} for i in intentos],
        # Con sus datos, para que el revisor vea qué se entregó en cada intento.
        "files": [{"file_id": str(f["file_id"]), "name": f["name"], "mime": f["mime"],
                   "size": f["size"], "uploaded_at": _iso(f["uploaded_at"]),
                   "attempt": f["attempt"]} for f in archivos],
        "history": [
            {
                "action": _ACCION_POR_TRANSICION.get((h["estado_anterior"], h["estado_nuevo"])),
                "new_status": h["estado_nuevo"],
                "actor": h["actor"],
                "comment": h["comentario"],
                "at": _iso(h["creado_en"]),
            }
            for h in historial
        ],
        "last_return": ultima_devolucion,
        "last_approval": ultima_aprobacion,
    }


def probar_conexion() -> bool:
    try:
        sesion = _sesion()
        sesion.execute(text("SELECT 1"))
        sesion.close()
        return True
    except Exception:
        return False


def fetch_orden_prioridades() -> dict:
    """{codigo: orden} del catálogo prioridad_tarea de G1 (low=1 ... urgent=4).

    La prioridad solo desempata el orden del inbox, así que si el catálogo
    no se puede leer (por ejemplo una base de la versión anterior) devolvemos
    {} y listar_inbox usa su copia por defecto, en vez de tumbar el inbox."""
    sesion = _sesion()
    try:
        filas = sesion.execute(
            text("SELECT codigo, orden FROM prioridad_tarea WHERE activo = 1")
        ).mappings().all()
    except SQLAlchemyError:
        return {}
    finally:
        sesion.close()
    return {fila["codigo"]: int(fila["orden"]) for fila in filas}


# ============================================================================
# ESCRITURAS (hallazgos #3 y #4 de QA)
# Cada una abre su sesión con @actor_id para que la auditoría de G1 sepa quién
# hizo el cambio, y hace commit o rollback completo: nunca queda a medias.
# ============================================================================
def _es_signal_de_g1(error: DBAPIError) -> bool:
    """True si el error viene de un SIGNAL SQLSTATE '45000' de un trigger de G1."""
    codigo = getattr(error.orig, "args", [None])[0]
    return codigo == 1644


def guardar_borrador(assignment_id: int, texto: Optional[str], actor_id: int) -> None:
    """Crea o reemplaza el borrador (hay uno solo por asignación: uq_entrega_borrador_td)."""
    sesion = _sesion(actor_id)
    try:
        # En las tareas de programa el borrador lleva la versión del programa:
        # G3 la copia a la entrega al hacer submit (CONTRATO_COMUN §2c A).
        modalidad = sesion.execute(text("""
            SELECT tt.modalidad_entrega FROM tarea_destinatario td
            JOIN tarea t ON t.id = td.tarea_id JOIN workflow w ON w.id = t.workflow_id
            JOIN tipo_tarea tt ON tt.id = w.tipo_tarea_id WHERE td.id = :id
        """), {"id": assignment_id}).scalar()
        version = _version_de_programa(sesion, assignment_id) if modalidad == "programa" else None
        sesion.execute(text("""
            INSERT INTO entrega_borrador (tarea_destinatario_id, contenido_texto,
                                          programa_version_id, guardado_por)
            VALUES (:id, :texto, :pv, :actor)
            ON DUPLICATE KEY UPDATE contenido_texto = VALUES(contenido_texto),
                                    programa_version_id = VALUES(programa_version_id),
                                    guardado_por = VALUES(guardado_por)
        """), {"id": assignment_id, "texto": texto, "actor": actor_id,
               "pv": version["id"] if version else None})
        sesion.commit()
    except DBAPIError as e:
        sesion.rollback()
        if _es_signal_de_g1(e):
            # trg_entrega_borrador_bi/bu: la asignación ya no está pendiente
            raise ErrorConflicto("Solo se guarda borrador de una asignación pendiente") from e
        raise
    finally:
        sesion.close()


def crear_comentario(assignment_id: int, autor_id: int, texto: str) -> dict:
    """Guarda el comentario y lo devuelve como lo muestra el detalle."""
    sesion = _sesion(autor_id)
    try:
        nuevo_id = sesion.execute(text("""
            INSERT INTO comentario (autor_id, tarea_destinatario_id, contenido)
            VALUES (:autor, :id, :texto)
        """), {"autor": autor_id, "id": assignment_id, "texto": texto}).lastrowid
        sesion.commit()
        fila = sesion.execute(text(_SQL_COMENTARIOS + " WHERE c.id = :c"),
                              {"c": nuevo_id}).mappings().first()
    except DBAPIError:
        sesion.rollback()
        raise
    finally:
        sesion.close()
    return _comentario(fila)


def _envios(sesion, assignment_id: int) -> int:
    """Cuántas veces se envió la asignación (submit y resubmit terminan en 'submitted')."""
    return sesion.execute(text("""
        SELECT COUNT(*) FROM tarea_transicion
        WHERE tarea_destinatario_id = :id AND estado_nuevo = 'submitted'
    """), {"id": assignment_id}).scalar()


# Comentarios con el nombre del autor y la fecha (UTC con "Z").
_SQL_COMENTARIOS = """
    SELECT c.id, c.autor_id, c.contenido, c.creado_en,
           CONCAT(u.nombres, ' ', u.apellidos) AS autor_nombre
    FROM comentario c
    JOIN usuario u ON u.id = c.autor_id
"""


def _comentario(fila) -> dict:
    creado = fila["creado_en"]
    return {
        "id": fila["id"],
        "author": str(fila["autor_id"]),
        "author_id": fila["autor_id"],
        "author_name": fila["autor_nombre"],
        "text": fila["contenido"],
        "at": creado.isoformat(timespec="minutes") + "Z" if isinstance(creado, datetime) else None,
        "created_at": creado.isoformat(timespec="minutes") + "Z" if isinstance(creado, datetime) else None,
    }


# ---------------------------------------------------------------- tipo de tarea
_EXT_DE_G2 = {ext.lstrip(".") for ext in _G2_TIPOS.values()} | (
    {"jpeg"} if ".jpg" in _G2_TIPOS.values() else set())


def _forma_de_entrega(cabecera) -> dict:
    """Cómo se entrega este tipo de tarea, según tipo_tarea de G1.

    Las extensiones y el tamaño son los del tipo, pero nunca más de lo que
    acepta G2 al subir: si no, el docente elegiría un archivo que G2 rechaza.
    """
    del_tipo = {e.strip().lower() for e in (cabecera["extensiones"] or "").split(",") if e.strip()}
    if "jpg" in del_tipo:
        del_tipo.add("jpeg")
    permitidas = sorted((del_tipo & _EXT_DE_G2) if del_tipo else _EXT_DE_G2)
    maximo_g2 = _G2_MAX_BYTES // (1024 * 1024)
    return {
        "mode": cabecera["modalidad_entrega"],
        "extensions": permitidas,
        "max_mb": min(cabecera["tamano_max_mb"] or maximo_g2, maximo_g2),
        # Lo que pide el tipo y G2 no acepta: se muestra para que nadie se sorprenda.
        "not_accepted": sorted(del_tipo - _EXT_DE_G2 - {"jpeg"}),
    }


def _version_de_programa(sesion, assignment_id: int) -> Optional[dict]:
    """La versión del programa que trabaja esta asignación.

    Primero la más reciente creada desde esta asignación en G5
    (programa_version.tarea_destinatario_origen_id); si no hay, la que la
    coordinación enlazó a la tarea (tarea.programa_version_id).
    """
    fila = sesion.execute(text("""
        SELECT pv.id, pv.numero_version, pv.estado_codigo, pv.nombre, pv.programa_curso_id
        FROM programa_version pv
        WHERE pv.id = COALESCE(
            (SELECT x.id FROM programa_version x
              WHERE x.tarea_destinatario_origen_id = :id
              ORDER BY x.numero_version DESC LIMIT 1),
            (SELECT t.programa_version_id FROM tarea_destinatario td
               JOIN tarea t ON t.id = td.tarea_id WHERE td.id = :id))
    """), {"id": assignment_id}).mappings().first()
    if fila is None:
        return None
    return {"id": fila["id"], "number": fila["numero_version"], "status": fila["estado_codigo"],
            "name": fila["nombre"], "program_id": fila["programa_curso_id"]}


def _intento_actual(sesion, assignment_id: int) -> Optional[dict]:
    """La última entrega de la asignación, si todavía no se envió.

    Regla común del PM (13-nov): el intento actual es la última fila de entrega
    que no tenga una transición 'submitted' posterior en tarea_transicion.

    No se comparan fechas: G3 guarda creado_en en la zona horaria del servidor
    y G2/G4 en UTC, y con el docker-compose (TZ America/Guatemala) la
    diferencia es de 6 horas. En su lugar se cuentan los envíos: cada envío
    cierra un intento, así que el intento N sigue abierto mientras haya menos
    de N envíos.
    """
    ultima = sesion.execute(text("""
        SELECT id, numero_intento FROM entrega
        WHERE tarea_destinatario_id = :id
        ORDER BY numero_intento DESC LIMIT 1
    """), {"id": assignment_id}).mappings().first()
    if ultima is None or _envios(sesion, assignment_id) >= ultima["numero_intento"]:
        return None
    return dict(ultima)


def vincular_archivo(assignment_id: int, file_id: str, actor_id: int) -> dict:
    """Vincula un archivo ya subido por G2 al intento actual de la asignación.

    1. El archivo debe existir, no estar eliminado y ser del usuario (si no, 404).
    2. Usa la entrega del intento actual o crea una con numero_intento = MAX + 1.
    3. UPDATE archivo SET entrega_id (G1 no deja modificar entrega, sí archivo).
    Devuelve {"entrega_id", "numero_intento"}.
    """
    try:
        archivo_id = int(file_id)
    except (TypeError, ValueError):
        raise ArchivoNoEncontrado("Archivo no encontrado")

    sesion = _sesion(actor_id)
    try:
        # Bloquea la asignación hasta el commit: dos vinculaciones al mismo
        # tiempo no pueden crear dos intentos para el mismo envío.
        asignacion = sesion.execute(text("""
            SELECT estado_codigo FROM tarea_destinatario WHERE id = :id FOR UPDATE
        """), {"id": assignment_id}).mappings().first()
        if asignacion is None:
            raise ArchivoNoEncontrado("Asignación no encontrada")
        if asignacion["estado_codigo"] not in ESTADOS_PENDIENTES:
            raise ErrorConflicto("Solo se adjuntan archivos a una asignación pendiente")

        archivo = sesion.execute(text("""
            SELECT id, autor_id, entrega_id, comentario_id, programa_version_id
            FROM archivo WHERE id = :f AND eliminado_en IS NULL
        """), {"f": archivo_id}).mappings().first()
        # Un archivo de otro usuario se trata igual que uno que no existe,
        # para no confirmar que ese id existe.
        if archivo is None or archivo["autor_id"] != actor_id:
            raise ArchivoNoEncontrado("Archivo no encontrado")

        intento = _intento_actual(sesion, assignment_id)
        if archivo["comentario_id"] or archivo["programa_version_id"] or (
                archivo["entrega_id"] and (intento is None or archivo["entrega_id"] != intento["id"])):
            raise ErrorConflicto("El archivo ya está vinculado a otro registro")

        if intento is None:
            # MAX + 1, como acordó el PM. Si alguna vez se envió sin crear fila
            # de entrega (G3 todavía no la crea en el submit), se numera por
            # envíos para que el número siga siendo "el envío que viene".
            maximo = sesion.execute(text("""
                SELECT COALESCE(MAX(numero_intento), 0) FROM entrega
                WHERE tarea_destinatario_id = :id
            """), {"id": assignment_id}).scalar()
            numero = max(maximo, _envios(sesion, assignment_id)) + 1
            # Lleva el texto del borrador, igual que cuando la crea G3: G1 no
            # deja modificar una entrega, así que el texto tiene que ir desde
            # el principio. La pantalla guarda el borrador antes de subir.
            nuevo_id = sesion.execute(text("""
                INSERT INTO entrega (tarea_destinatario_id, numero_intento, entregado_por,
                                     contenido_texto, programa_version_id)
                SELECT :id, :n, :actor,
                       (SELECT contenido_texto FROM entrega_borrador WHERE tarea_destinatario_id = :id),
                       (SELECT programa_version_id FROM entrega_borrador WHERE tarea_destinatario_id = :id)
            """), {"id": assignment_id, "n": numero, "actor": actor_id}).lastrowid
            intento = {"id": nuevo_id, "numero_intento": numero}

        sesion.execute(text("UPDATE archivo SET entrega_id = :e WHERE id = :f"),
                       {"e": intento["id"], "f": archivo_id})
        sesion.commit()
    except Exception:
        sesion.rollback()
        raise
    finally:
        sesion.close()
    return {"entrega_id": intento["id"], "numero_intento": intento["numero_intento"]}


def desvincular_archivo(assignment_id: int, file_id: str, actor_id: int) -> None:
    """Quita un archivo del intento que todavía no se envió.

    Solo su autor, solo mientras la asignación está pendiente y solo si el
    archivo pertenece al intento abierto: lo ya enviado no se toca. El archivo
    queda con eliminación lógica (G1 no permite borrar filas de archivo).
    """
    try:
        archivo_id = int(file_id)
    except (TypeError, ValueError):
        raise ArchivoNoEncontrado("Archivo no encontrado")
    sesion = _sesion(actor_id)
    try:
        asignacion = sesion.execute(text("""
            SELECT estado_codigo FROM tarea_destinatario WHERE id = :id FOR UPDATE
        """), {"id": assignment_id}).mappings().first()
        if asignacion is None:
            raise ArchivoNoEncontrado("Asignación no encontrada")
        archivo = sesion.execute(text("""
            SELECT id, autor_id, entrega_id FROM archivo
            WHERE id = :f AND eliminado_en IS NULL
        """), {"f": archivo_id}).mappings().first()
        if archivo is None or archivo["autor_id"] != actor_id:
            raise ArchivoNoEncontrado("Archivo no encontrado")
        intento = _intento_actual(sesion, assignment_id)
        if (asignacion["estado_codigo"] not in ESTADOS_PENDIENTES or intento is None
                or archivo["entrega_id"] != intento["id"]):
            raise ErrorConflicto("Solo se quita un archivo de una entrega que todavía no se envió")
        sesion.execute(text("""
            UPDATE archivo SET entrega_id = NULL, eliminado_en = UTC_TIMESTAMP(3), eliminado_por = :actor
            WHERE id = :f
        """), {"actor": actor_id, "f": archivo_id})
        sesion.commit()
    except Exception:
        sesion.rollback()
        raise
    finally:
        sesion.close()


# ============================================================================
# BANDEJA DE REVISIÓN
# ============================================================================
def fetch_cola_revision(usuario_id: int, roles) -> List[dict]:
    """Asignaciones entregadas o ya revisadas que le tocan a este usuario.

    Regla oficial del PM (16-nov, la de G3):
    - coordinación y administración ven todas;
    - un revisor ve solo las tareas donde es el revisor designado. Una tarea
      sin revisor la revisa la coordinación que la creó o admin.
    El revisor designado se lee como en G3: el de la asignación y, si no
    tiene, el de la tarea.
    """
    roles = set(roles)
    sesion = _sesion()
    try:
        filas = sesion.execute(text("""
            SELECT td.id, td.usuario_id, td.estado_codigo, t.titulo, tt.codigo AS tipo,
                   t.prioridad, COALESCE(td.fecha_limite, t.fecha_limite) AS fecha_limite,
                   CONCAT(u.nombres, ' ', u.apellidos) AS docente,
                   t.id AS tarea_id, t.creado_por,
                   COALESCE(td.revisor_id, t.revisor_id) AS revisor_id,
                   CONCAT(rv.nombres, ' ', rv.apellidos) AS revisor_nombre,
                   cu.codigo AS curso_codigo, cu.nombre AS curso_nombre, pe.codigo AS periodo_codigo,
                   ult.id AS ultima_transicion_id, env.creado_en AS enviado_en,
                   (SELECT COUNT(*) FROM tarea_transicion x
                     WHERE x.tarea_destinatario_id = td.id AND x.estado_nuevo = 'submitted') AS envios,
                   (SELECT COUNT(*) FROM archivo a JOIN entrega e ON e.id = a.entrega_id
                     WHERE e.tarea_destinatario_id = td.id AND a.eliminado_en IS NULL) AS archivos
            FROM tarea_destinatario td
            JOIN tarea t       ON t.id = td.tarea_id
            JOIN workflow w    ON w.id = t.workflow_id
            JOIN tipo_tarea tt ON tt.id = w.tipo_tarea_id
            JOIN usuario u     ON u.id = td.usuario_id
            LEFT JOIN usuario rv ON rv.id = COALESCE(td.revisor_id, t.revisor_id)
            LEFT JOIN curso cu ON cu.id = t.curso_id
            LEFT JOIN periodo pe ON pe.id = t.periodo_id
            LEFT JOIN tarea_transicion ult ON ult.id = (
                SELECT MAX(x.id) FROM tarea_transicion x WHERE x.tarea_destinatario_id = td.id)
            LEFT JOIN tarea_transicion env ON env.id = (
                SELECT MAX(x.id) FROM tarea_transicion x
                 WHERE x.tarea_destinatario_id = td.id AND x.estado_nuevo = 'submitted')
            WHERE t.eliminado_en IS NULL
              AND td.estado_codigo IN ('submitted', 'under_review', 'returned', 'approved', 'closed')
              AND (:ve_todas = 1 OR COALESCE(td.revisor_id, t.revisor_id) = :yo)
        """), {"yo": usuario_id,
               "ve_todas": int(bool(roles & {"coordinator", "admin"}))}).mappings().all()
    finally:
        sesion.close()

    def _iso(valor):
        # La conexión está en UTC: se marca con "Z" para que la pantalla
        # sepa convertirla a hora de Guatemala (regla del PM, 16-nov).
        return valor.isoformat(timespec="minutes") + "Z" if isinstance(valor, datetime) else None

    resultado = []
    for f in filas:
        fecha = f["fecha_limite"]
        resultado.append({
            "id": f["id"],
            "task_id": f["tarea_id"],
            "assignee_id": f["usuario_id"],
            "teacher": f["docente"],
            "reviewer_id": f["revisor_id"],
            "reviewer_name": f["revisor_nombre"],
            "created_by": f["creado_por"],
            "course_code": f["curso_codigo"],
            "course_name": f["curso_nombre"],
            "period_code": f["periodo_codigo"],
            # Le toca a quien mira: es el revisor designado o, si la tarea no tiene, quien la creó.
            "mine": (f["revisor_id"] == usuario_id) if f["revisor_id"] is not None
                    else (f["creado_por"] == usuario_id),
            "title": f["titulo"],
            "task_type": f["tipo"],
            "status": f["estado_codigo"],
            "priority": f["prioridad"],
            "due_at": fecha.date().isoformat() if isinstance(fecha, datetime) else (
                fecha.isoformat() if isinstance(fecha, date) else None),
            "submitted_at": _iso(f["enviado_en"]),
            "attempt": f["envios"],
            "files": f["archivos"],
            "last_transition_id": f["ultima_transicion_id"],
        })
    return resultado

