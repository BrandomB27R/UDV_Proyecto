"""Punto de entrada de la aplicación (mantenido por el PM, README §4).

Hace importables los paquetes de cada grupo (g1_bd, g2_api, ...) y monta sus
routers en una sola app FastAPI. Un router que todavía no existe en la rama se
omite y aparece en /health, para que el deploy no se caiga mientras los
grupos integran su trabajo.

Convención para los grupos: cada router declara su ruta completa con el
prefijo /api/v1 (por ejemplo APIRouter(prefix="/api/v1/auth")).

Correr local:  uvicorn main:app --reload
"""
import importlib
import logging
import os
import sys
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

RAIZ = Path(__file__).resolve().parent
log = logging.getLogger("udv")

# Las carpetas de grupo llevan guiones y no se importan directo:
# se agregan al path para poder hacer `from g2_api import ...`.
for carpeta in sorted((RAIZ / "grupos").glob("grupo-*")):
    if carpeta.is_dir() and str(carpeta) not in sys.path:
        sys.path.insert(0, str(carpeta))

# Routers registrados. Para sumar uno: agregar ("paquete.modulo", "variable").
# Cada grupo se descomenta cuando su PR entra a main (nombres reales de sus paquetes).
ROUTERS = [
    ("g2_api.routers.auth", "router"),
    ("g2_api.routers.auth", "me_router"),   # GET /api/v1/me
    ("g2_api.routers.users", "router"),
    ("g2_api.routers.roles", "router"),
    ("g2_api.routers.files", "router"),     # G2: archivos (G2-21 corregido en PR #20)
    ("workflow.api", "router"),             # G3
    ("g4_inbox.routes", "router"),          # G4 (PR del 9-nov)
    ("g5_programas.router", "router"),      # G5 (PR del 6-nov)
    ("g6_admin.api", "router"),             # G6
]

# Fuera de desarrollo la aplicación no cuenta nada de sí misma sin sesión: ni la
# documentación de la API, ni la versión de la base, ni qué módulos tiene montados.
# API_DOCS_PUBLICA=1 vuelve a publicar la documentación si alguna vez hace falta.
ES_DESARROLLO = os.getenv("APP_ENV", "desarrollo") == "desarrollo"
DOCS_PUBLICAS = ES_DESARROLLO or os.getenv("API_DOCS_PUBLICA", "") == "1"

app = FastAPI(
    title="UDV · Workflow docente",
    version="0.1.0",
    docs_url="/api/v1/docs" if DOCS_PUBLICAS else None,
    openapi_url="/api/v1/openapi.json" if DOCS_PUBLICAS else None,
    redoc_url=None,
)

# Cabeceras de seguridad en todas las respuestas.
_CSP_VINCI = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
              "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
              "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
_CSP_API = "default-src 'none'; frame-ancestors 'none'"
_CSP_MINIMA = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
_PANTALLAS_DE_GRUPO = tuple(f"/app/g{n}" for n in range(2, 7))


def _csp_para(ruta: str) -> str:
    """Política de contenido según qué se sirve.

    Vinci y los estilos: solo recursos propios, sin scripts en línea. La API:
    nada (devuelve JSON y archivos). Las pantallas de cada grupo y Swagger usan
    scripts en línea, así que reciben solo la parte que no los rompe.
    """
    if ruta.startswith(_PANTALLAS_DE_GRUPO) or ruta.startswith("/api/v1/docs"):
        return _CSP_MINIMA
    if ruta.startswith("/api/") or ruta.startswith("/health"):
        return _CSP_API
    return _CSP_VINCI


@app.middleware("http")
async def cabeceras_de_seguridad(request, call_next):
    respuesta = await call_next(request)
    c = respuesta.headers
    c.setdefault("X-Content-Type-Options", "nosniff")
    c.setdefault("X-Frame-Options", "DENY")
    c.setdefault("Referrer-Policy", "same-origin")
    c.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    c.setdefault("Content-Security-Policy", _csp_para(request.url.path))
    if request.headers.get("x-forwarded-proto", request.url.scheme) == "https":
        c.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return respuesta

# Formato de error común: servicio compartido del G2 (CONTRATO_COMUN §1).
try:
    from g2_api.middleware.error_handler import register_error_handlers
    register_error_handlers(app)
except ImportError as exc:
    log.warning("Manejador de errores del G2 no disponible: %s", exc)

montados, pendientes = [], {}
for modulo, nombre in ROUTERS:
    try:
        app.include_router(getattr(importlib.import_module(modulo), nombre))
        montados.append(f"{modulo}:{nombre}")
    except Exception as exc:  # el grupo aún no integró ese módulo a esta rama
        pendientes[f"{modulo}:{nombre}"] = f"{type(exc).__name__}: {exc}"
        log.warning("Router omitido %s:%s -> %s", modulo, nombre, exc)

# Ganchos opcionales de cada grupo sobre la app (solo tocan sus propias rutas).
for modulo, nombre in [
    ("g2_api.openapi_docs", "completar_openapi"),   # G2-33: codigos y ejemplos en Swagger
    ("g5_programas.errors", "registrar_errores"),   # G5: ApiError -> JSON del contrato
]:
    try:
        getattr(importlib.import_module(modulo), nombre)(app)
    except Exception as exc:  # noqa: BLE001
        log.warning("Gancho omitido %s:%s -> %s", modulo, nombre, exc)


# Interfaz (README §4: los estáticos y estilos compartidos los sirve main.py).
# Cada pantalla vive en la carpeta de su grupo; aquí solo se publica.
# El login es el de G2; el token se guarda en la pestaña como "udv_token".
PANTALLAS = [
    ("/udv-styles", "grupos/udv-styles"),                               # estilos compartidos (PM)
    ("/app/g2",     "grupos/grupo-2-api-seguridad/frontend-login"),     # G2: pantalla de login
    ("/app/g3",     "grupos/grupo-3-workflow-tareas/frontend"),         # G3: tareas
    ("/app/g4",     "grupos/grupo-4-inbox-entregas/g4_inbox/static"),   # G4: bandeja y entregas
    ("/app/g5",     "grupos/grupo-5-programas-pdf/frontend"),           # G5: programas y PDF
    ("/app/g6",     "grupos/grupo-6-administracion/g6_admin/pantallas"),# G6: panel, catálogos, auditoría
    ("/app",        "portal"),                                          # inicio y login (PM)
]


class PantallasSinCacheVieja(StaticFiles):
    """Sirve las pantallas pidiendo al navegador que revalide cada archivo.

    Sin esta cabecera el navegador decide por su cuenta cuánto guardar cada
    archivo, y tras un despliegue puede mezclar un módulo nuevo con uno viejo
    (pantalla en blanco: "does not provide an export named ..."). Con
    ``no-cache`` sigue guardando, pero antes de usar la copia pregunta si
    cambió (ETag); si no cambió, la respuesta es un 304 sin contenido.
    """

    async def get_response(self, path, scope):
        respuesta = await super().get_response(path, scope)
        respuesta.headers["Cache-Control"] = "no-cache"
        return respuesta


pantallas_montadas = []
for ruta, carpeta in PANTALLAS:
    directorio = RAIZ / carpeta
    if directorio.is_dir():
        app.mount(ruta, PantallasSinCacheVieja(directory=str(directorio), html=True), name=ruta.strip("/").replace("/", "-"))
        pantallas_montadas.append(ruta)
    else:
        log.warning("Pantalla omitida %s -> no existe %s", ruta, carpeta)


@app.get("/", include_in_schema=False)
def inicio():
    return RedirectResponse("/app/")


if not DOCS_PUBLICAS:
    # El esquema sigue disponible para quien tiene sesión (herramientas y pruebas).
    try:
        from g2_api.routers.auth import obtener_usuario_actual

        @app.get("/api/v1/openapi.json", include_in_schema=False)
        def esquema_con_sesion(_usuario=Depends(obtener_usuario_actual)):
            return JSONResponse(app.openapi())
    except ImportError as exc:
        log.warning("Esquema con sesión no disponible: %s", exc)


@app.get("/health", tags=["Sistema"])
def health():
    """Estado de la app. No requiere base de datos.

    Es la ruta que consulta Railway para saber si el servicio vive. Fuera de
    desarrollo responde solo el estado: la lista de módulos no es pública.
    """
    if not ES_DESARROLLO:
        return {"status": "ok" if not pendientes else "degradado"}
    return {"status": "ok", "routers": montados, "pendientes": pendientes, "pantallas": pantallas_montadas}


@app.get("/health/db", tags=["Sistema"])
def health_db():
    """Comprueba la conexión a MySQL usando DATABASE_URL."""
    url = os.getenv("DATABASE_URL")
    if not url:
        return {"status": "sin_configurar", "detalle": "Falta DATABASE_URL"}
    try:
        from sqlalchemy import create_engine, text
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            version = conn.execute(text("SELECT VERSION()")).scalar()
            tablas = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
            )).scalar()
        engine.dispose()
        if not ES_DESARROLLO:
            return {"status": "ok"}
        return {"status": "ok", "version": version, "tablas": tablas}
    except Exception as exc:
        log.warning("health/db falló: %s", exc)
        if not ES_DESARROLLO:
            return {"status": "error"}
        return {"status": "error", "detalle": f"{type(exc).__name__}: {exc}"}
