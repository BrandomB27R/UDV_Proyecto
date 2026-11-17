"""Lógica de la bandeja de revisión (GET /review-queue).

Python puro, igual que inbox.py: recibe las filas ya filtradas por revisor
(las arma database.fetch_cola_revision o los datos de ejemplo) y aplica
búsqueda, filtro de estado, orden y paginación.

Quién ve qué tarea lo decide la consulta (regla oficial del PM, la de G3):
coordinación y administración ven todas; un revisor ve solo las tareas donde
es el revisor designado.
"""
from .inbox import PER_PAGE_MAXIMO, PER_PAGE_POR_DEFECTO, ErrorValidacion, normalizar

# Lo que tiene que atender el revisor: primero lo que ya tomó, luego lo que espera.
ESTADOS_PENDIENTES = ("under_review", "submitted")
# Lo que ya pasó por sus manos, para consultarlo.
ESTADOS_REVISADOS = ("returned", "approved", "closed")
ESTADOS_COLA = ESTADOS_PENDIENTES + ESTADOS_REVISADOS

# Valores de ?status=. Sin status = "pending".
FILTROS = {
    "pending": ESTADOS_PENDIENTES,
    "all": ESTADOS_COLA,
    **{estado: (estado,) for estado in ESTADOS_COLA},
}

ROLES_QUE_REVISAN = {"reviewer", "coordinator", "admin"}


def puede_usar_la_bandeja(roles) -> bool:
    return bool(set(roles) & ROLES_QUE_REVISAN)


def _validar(status, page, per_page):
    errores = {}
    if status not in FILTROS:
        errores["status"] = f"Filtro desconocido: {status!r}. Use uno de: {', '.join(FILTROS)}"
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        errores["page"] = "Debe ser un entero mayor o igual a 1"
    if (not isinstance(per_page, int) or isinstance(per_page, bool)
            or not 1 <= per_page <= PER_PAGE_MAXIMO):
        errores["per_page"] = f"Debe ser un entero entre 1 y {PER_PAGE_MAXIMO}"
    if errores:
        raise ErrorValidacion(errores)


def _clave_orden(fila):
    """Pendientes primero (las ya tomadas antes que las que esperan), y dentro
    de cada grupo la que lleva más tiempo esperando primero. Las revisadas al
    final, la más reciente primero. Se ordena por el id de la transición y no
    por fecha, porque G1 y G3 no guardan las fechas en la misma zona horaria."""
    estado = fila["status"]
    ultimo = fila.get("last_transition_id") or 0
    if estado in ESTADOS_PENDIENTES:
        return (ESTADOS_PENDIENTES.index(estado), ultimo, fila["id"])
    return (len(ESTADOS_PENDIENTES), -ultimo, fila["id"])


def listar_cola(filas, *, q="", status=None, page=1, per_page=PER_PAGE_POR_DEFECTO):
    """Respuesta paginada {page, per_page, total, data, summary}.

    `summary` cuenta todas las filas del revisor, sin aplicar búsqueda ni
    filtro, para que los contadores no cambien al filtrar."""
    status = status or "pending"
    _validar(status, page, per_page)
    estados = FILTROS[status]
    texto = normalizar(q)
    filtradas = [
        f for f in filas
        if f["status"] in estados
        and (texto in normalizar(f["title"]) or texto in normalizar(f.get("teacher")))
    ]
    filtradas.sort(key=_clave_orden)
    inicio = (page - 1) * per_page
    data = [{k: v for k, v in f.items() if k != "last_transition_id"}
            for f in filtradas[inicio:inicio + per_page]]
    return {
        "page": page, "per_page": per_page, "total": len(filtradas), "data": data,
        "summary": {
            "submitted": sum(1 for f in filas if f["status"] == "submitted"),
            "under_review": sum(1 for f in filas if f["status"] == "under_review"),
        },
    }
