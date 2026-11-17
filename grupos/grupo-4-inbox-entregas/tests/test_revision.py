"""Bandeja de revisión (GET /api/v1/review-queue), con los datos de ejemplo en memoria.

Regla oficial del PM (la de G3): coordinación y admin ven todas; un revisor
ve solo las tareas donde es el revisor designado. En los datos de
ejemplo el revisor designado de todas las asignaciones es el usuario 5.
Las pruebas contra MySQL están en test_mysql_escritura.py.
"""
import pytest

from g4_inbox.revision import listar_cola
from test_main import autenticar_como, cliente

URL = "/api/v1/review-queue"


def test_un_docente_sin_rol_de_revisor_recibe_403():
    autenticar_como(1)
    r = cliente.get(URL)
    assert r.status_code == 403
    assert set(r.json()) == {"error"}   # formato de error común de G2


def test_el_revisor_ve_por_defecto_solo_las_pendientes():
    autenticar_como(5, roles=("teacher", "reviewer"))
    r = cliente.get(URL).json()
    assert [a["status"] for a in r["data"]] == ["submitted"]
    assert r["summary"] == {"submitted": 1, "under_review": 0}
    assert set(r) == {"page", "per_page", "total", "data", "summary"}


def test_con_todas_ve_tambien_las_ya_revisadas():
    autenticar_como(5, roles=("teacher", "reviewer"))
    estados = {a["status"] for a in cliente.get(URL, params={"status": "all"}).json()["data"]}
    assert estados == {"submitted", "returned", "approved"}


def test_un_revisor_que_no_es_el_designado_no_ve_nada():
    autenticar_como(6, roles=("teacher", "reviewer"))
    r = cliente.get(URL, params={"status": "all"}).json()
    assert r["total"] == 0 and r["summary"] == {"submitted": 0, "under_review": 0}


def test_coordinacion_y_admin_ven_todas():
    for usuario, roles in ((2, ("coordinator",)), (1, ("admin",))):
        autenticar_como(usuario, roles=roles)
        r = cliente.get(URL, params={"status": "all"}).json()
        assert r["total"] == 4, usuario   # 4, 3, 7 y 10: todas las entregadas o revisadas


def test_filtro_desconocido_da_422():
    autenticar_como(5, roles=("teacher", "reviewer"))
    assert cliente.get(URL, params={"status": "assigned"}).status_code == 422
    assert cliente.get(URL, params={"per_page": 0}).status_code == 422


def _fila(id_, estado, ultima, titulo="Tarea", docente="Ana Pérez"):
    return {"id": id_, "status": estado, "last_transition_id": ultima, "title": titulo, "teacher": docente}


def test_orden_primero_las_tomadas_luego_la_que_mas_espera():
    filas = [
        _fila(1, "submitted", 30),
        _fila(2, "submitted", 10),        # lleva más tiempo esperando
        _fila(3, "under_review", 50),     # ya tomada: va primero
        _fila(4, "approved", 99),
    ]
    r = listar_cola(filas, status="all")
    assert [a["id"] for a in r["data"]] == [3, 2, 1, 4]
    assert "last_transition_id" not in r["data"][0]


def test_busca_por_titulo_o_por_docente_sin_acentos():
    filas = [_fila(1, "submitted", 1, "Actualizar programa", "Daniel López"),
             _fila(2, "submitted", 2, "Subir CV", "Ana Pérez")]
    assert [a["id"] for a in listar_cola(filas, q="lopez")["data"]] == [1]
    assert [a["id"] for a in listar_cola(filas, q="cv")["data"]] == [2]


def test_los_contadores_no_cambian_al_filtrar():
    filas = [_fila(1, "submitted", 1), _fila(2, "under_review", 2), _fila(3, "approved", 3)]
    r = listar_cola(filas, q="no existe")
    assert r["total"] == 0 and r["summary"] == {"submitted": 1, "under_review": 1}


@pytest.mark.parametrize("pagina,esperado", [(1, [2, 1]), (2, [3])])
def test_paginacion(pagina, esperado):
    filas = [_fila(1, "submitted", 20), _fila(2, "under_review", 5), _fila(3, "submitted", 30)]
    r = listar_cola(filas, page=pagina, per_page=2)
    assert [a["id"] for a in r["data"]] == esperado and r["total"] == 3
