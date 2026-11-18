# CONTRATO_COMUN.md — Reglas de integración para los 6 grupos

> **Nivel 2 de la jerarquía de fuentes de verdad** (ver README §0). Solo lo
> modifica el PM, con fecha y motivo en el historial. Este texto reemplaza a la
> tabla "Contrato común de integración" que aparece repetida en los seis .docx;
> si alguna copia del .docx difiere, gana este archivo.

Cualquier cambio a estas reglas se discute con el PM, se registra aquí y se
comunica a todos los grupos **antes** de modificar código.

## 1. Convenciones de la API

| Elemento | Convención |
|---|---|
| Base API | `/api/v1`. **Todas** las rutas de los CONTRATO.md llevan este prefijo aunque la tabla no lo repita: `/me` significa `/api/v1/me`. |
| Formato | JSON UTF-8; `multipart/form-data` solamente para archivos. |
| Autenticación | Token del G2 en la cabecera `Authorization: Bearer <token>`. `POST /api/v1/auth/login` lo entrega y `POST /api/v1/auth/logout` lo revoca. `GET /api/v1/me` retorna usuario, roles y permisos. |
| Roles | Códigos del catálogo `rol` del G1: `admin`, `coordinator`, `teacher`, `reviewer`, `authority`, `auditor`. Los permisos de cada rol son los de la matriz `rol_permiso` del G1. |
| Identificadores | **Enteros** autoincrementales, un solo tipo para todo el sistema (README §5). El mismo recurso conserva el mismo identificador en todos los módulos. |
| Fechas | ISO 8601 en **UTC con sufijo `Z`** (`2026-11-17T03:07:21Z`). La base guarda UTC y cada módulo ejecuta `SET time_zone = '+00:00'` al abrir la conexión. La pantalla convierte a hora de Guatemala (§1b). |
| Errores | `{"error": {"code": "VALIDATION_ERROR", "message": "...", "details": {}}}` — en 422, `details` trae el detalle **por campo**. |
| Códigos HTTP | 200, 201 y 204 éxito · 400 solicitud mal formada · 401 no autenticado · 403 sin permiso · 404 inexistente · 409 conflicto de estado · 422 validación. |
| Paginación | Respuesta con `page`, `per_page`, `total`, `data`. El máximo de `per_page` es 100 (variable `PER_PAGE_MAX`). |
| Auditoría | Toda transición registra actor, fecha, estado anterior, estado nuevo y comentario. |
| OpenAPI | Se deriva de los CONTRATO.md y debe coincidir con lo que la API responde. No es una fuente de verdad propia: si difiere del contrato, el OpenAPI está mal. |
| Base de datos | MySQL 8, base `db_udv`, esquema del G1 (README §5). Conexión por `DATABASE_URL`. Ningún módulo crea ni altera tablas. Los errores de regla de la base llegan como `SQLSTATE 45000` con el código HTTP en el mensaje (409 o 422) y se traducen al formato de error común. |
| Actor de auditoría | Después de autenticar, la conexión ejecuta `SET @actor_id = <id del usuario>` para que los triggers del G1 registren quién hizo el cambio. Lo implementa el G2 como servicio compartido. |
| Integración | Cada módulo expone `APIRouter` con su ruta completa (`/api/v1/...`) y lo monta el `main.py` de la raíz. Ningún módulo levanta su propia app, servidor o puerto. |

El formato de error, la paginación y el middleware los implementa el **G2**
como servicio compartido. Los demás grupos los importan; no los reimplementan.

## 1b. Interfaz

Reglas que cumple toda pantalla, sea del grupo que sea:

| Elemento | Convención |
|---|---|
| Entrada | Vinci (`/app/`, carpeta `portal/`) es la entrada y la aplicación completa; las pantallas de los grupos siguen en su ruta como evidencia y enlazan de vuelta a él. Una pantalla que ofrezca su propio login usa `POST /api/v1/auth/login` y guarda el token con la misma clave, para que la sesión sirva en todos los módulos. |
| Sesión | El token se guarda en `sessionStorage` con la clave `udv_token` y viaja en `Authorization: Bearer`. Cerrar sesión llama a `POST /api/v1/auth/logout`. |
| Rol | Sale de `GET /api/v1/me` (`roles`). La pantalla no deja elegir ni cambiar el rol. |
| Rutas | Relativas al mismo origen (`/api/v1/...`), nunca un host o puerto escrito en el código. |
| Estilos | `/udv-styles/udv.css`. Los estilos propios de una pantalla van en la carpeta de su grupo. |
| Datos | La pantalla muestra lo que responde la API; no trae valores de relleno ni identificadores inventados. |
| Botones | Las acciones que se ofrecen salen de `viewer_actions` (regla G de §2c); la pantalla no decide permisos por su cuenta. |
| Fechas | Se convierten al mostrarlas: `new Date(valor).toLocaleString("es-GT", { timeZone: "America/Guatemala" })`. |

## 2. Estados

**Tarea / asignación:** `draft`, `assigned`, `in_progress`, `submitted`,
`under_review`, `returned`, `approved`, `closed`, `cancelled`.
Las transiciones válidas son las de `grupos/grupo-3-workflow-tareas/CONTRATO.md`.

**Programa de curso (versión):** `draft`, `submitted`, `under_review`,
`returned`, `approved`, `authorized`, `superseded`.
Las transiciones válidas son las de `grupos/grupo-5-programas-pdf/CONTRATO.md`.

Los nombres de estado son exactamente estos, en inglés y en minúsculas, en la
base, en la API y en el código.

**Prioridad de tarea:** `low`, `medium`, `high`, `urgent`. Son las filas del
catálogo `prioridad_tarea` del G1; se valida contra la tabla, no contra una
lista fija en el código.

## 2b. Dueño de cada ruta

Cada ruta tiene un solo grupo dueño. Si dos grupos la necesitan, uno la
implementa y el otro la consume.

| Ruta | Dueño |
|---|---|
| `/auth/*`, `/me`, `/users`, `/roles`, `/files` | G2 |
| `/task-types`, `/tasks/*`, `/workflow`, `/events` | G3 |
| Acciones de asignación: `/assignments/{id}/start`, `submit`, `resubmit`, `review`, `return`, `approve`, `close`, y además `actions` e `history` | G3 |
| `/inbox`, `/review-queue`, `/assignments/{id}` (detalle, `submission-draft`, `comments`, `files`) | G4 |
| `/course-programs/*`, `/program-versions/*` (incluye `for-assignment/{id}`), `/graduate-profiles` | G5 |
| Catálogos (`/campuses`, `/faculties`, `/academic-units`, `/courses`, `/periods`, `/modalities`, `/areas`), `/notifications`, `/dashboard`, `/audit`, `/api/v1/health` | G6 |

## 2c. Reglas compartidas entre módulos

**A. Tabla `entrega` (G3 y G4).** Un archivo no se puede vincular sin una
fila de `entrega` (`archivo.entrega_id`). G3 crea esa fila al hacer `submit` o
`resubmit`, con el texto de `entrega_borrador`, y responde 422 si el tipo de
tarea tiene `requiere_archivo` y el intento no trae ninguno. G4 solo la crea
al vincular el primer archivo, si todavía no existe. El intento actual es la
última fila de `entrega` sin una transición `submitted` posterior. Mientras el
intento no se haya enviado, su texto se puede corregir: al hacer `submit` o
`resubmit`, G3 pone en la entrega el texto vigente del borrador (esquema 1.2.3).
Un intento ya enviado no se modifica.

**B. Quién revisa (G3 y G4).** El revisor designado de una asignación es
`COALESCE(tarea_destinatario.revisor_id, tarea.revisor_id)`. Si existe, solo
ese usuario la revisa y la ve en su bandeja de revisión. Si no existe, la
revisa la coordinación dueña de la tarea o un administrador. Coordinación y
administración ven la bandeja completa.

**D. Descarga de archivos (G2).** Descargan siempre el dueño del archivo y un
administrador. Auditoría descarga cualquier archivo ya vinculado a una
entrega, un comentario o una versión de programa. Revisor y coordinación solo
descargan archivos de entregas de tareas donde son el revisor designado o
quien creó la tarea. Un archivo todavía sin vincular solo lo descargan su
dueño y un administrador.

**E. Perfil de coordinación.** Coordinación, revisión y autoridad los ejerce
la misma persona: su usuario tiene los roles `coordinator`, `reviewer` y
`authority` (migración 1.2.2). Los seis roles del catálogo se conservan y
cada módulo decide por la unión de los roles del usuario, nunca por el
primero.

**G. Acciones de quien mira (G4 y G5).** El detalle de una asignación
(`GET /assignments/{id}`) y el de una versión de programa
(`GET /program-versions/{id}`) traen `viewer_actions`: de las acciones que el
estado permite, las que puede ejecutar el usuario que consulta, ya cruzadas
con sus roles, con el revisor designado o el creador de la tarea y con la
regla de que quien elaboró o envió un programa no lo aprueba. La interfaz
pinta solo esos botones.

**H. El programa nace de la tarea (G3, G4 y G5).** Una tarea de tipo
«Actualizar programa» guarda `course_id` y `period_id` (G3). El docente de la
asignación llama a `POST /program-versions/for-assignment/{assignment_id}`
(G5): si ya hay una versión ligada a esa asignación la devuelve; si no, abre un
borrador con el período de la tarea y él como responsable, copiando la última
versión autorizada del curso o, si el curso aún no tiene programa, en blanco.
Responde 422 si la tarea no indica curso y período. El detalle de la
asignación (G4) expone esa versión en `program_version`, y la tarea se puede
entregar cuando el programa está completo.

**I. Tipos de tarea (G3).** `POST /task-types` `{name, delivery, description}`
crea un tipo con el flujo estándar; lo usan coordinación, autoridad o
administración. `delivery` es `texto` (sin archivos), `ambos` (texto y archivo
opcional) o `archivo` (exige al menos un archivo). El revisor de una tarea
(`reviewer_id`) debe tener el rol `reviewer`.

**J. Quitar un archivo (G4).** `DELETE /assignments/{id}/files/{file_id}`
quita un archivo del intento que todavía no se envió; lo hace su autor, con la
asignación pendiente. Un intento enviado no se modifica (409).

La decisión C (quién elabora y aprueba un programa de curso) es solo del G5 y
está en su CONTRATO.md.

## 3. Eventos

Nombres oficiales de los eventos que alimentan las notificaciones: los define
la tabla de `grupos/grupo-6-administracion/CONTRATO.md` §3. El emisor de cada
evento es el módulo dueño de la acción. El transporte es la tabla `evento` del
G1: los triggers de la base dejan una fila por cada acción y el G6 la convierte
en notificaciones. Ningún módulo llama a otro para avisar.

## 4. Repositorio

Ramas, PR y carpetas según el README §4 y §6. El .docx dice "ramas por
funcionalidad": eso se permite solo como sub-rama dentro del grupo
(`grupo-3/publicacion`) que se integra a `grupo-3`, nunca directo a `main`.
Las migraciones de base de datos se versionan (G1).

## 5. Definición de terminado (aplica a todos)

El trabajo está terminado cuando funciona desde la interfaz hasta la base de
datos, respeta este contrato común, valida permisos y errores, **tiene
pruebas**, **aparece en OpenAPI** cuando corresponde, puede instalarse
siguiendo el README y **funciona con `docker compose up` contra MySQL**. No se considera terminado un endpoint aislado, una
pantalla con datos fijos o una tabla sin integración.

Cada CONTRATO.md traduce esta definición a su checklist de PR.

---

## Historial de cambios

| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-09-28 | Versión inicial, extraída del "Contrato común" de los .docx | La regla estaba solo dentro de binarios y no en ningún .md |
| 2026-10-13 | §1: identificadores enteros (ya decidido en README §5), base de datos MySQL, actor de auditoría e integración por `APIRouter`; §2: prioridad pendiente; nuevo §2b de dueños de ruta; §5: el trabajo debe correr con `docker compose up` | Se adoptó MySQL; G3 define `/me` (de G2) y `/assignments/inbox` (de G4); G3 y G4 implementan las mismas transiciones; G3 y G4 usan prioridades distintas |
| 2026-11-17 | §1: autenticación por `Bearer`, códigos de rol, fechas en UTC con `Z`, máximo de `per_page`; nuevo §1b con las reglas de las pantallas; §2: prioridad con `urgent`; §2b: las acciones de asignación son del G3 y `/review-queue` del G4; nuevo §2c con las reglas A, B y D; §3: los eventos viajan por la tabla `evento` | Decisiones tomadas entre el 11 y el 16 de noviembre que solo estaban en el chat y en los CONTRATO.md de grupo |
| 2026-11-17 (noche) | §2c: regla D como quedó implementada; nueva regla E (perfil de coordinación) | Cierre de entregas; decisión del PM |
| 2026-11-17 (noche, 2) | §2c A: el texto del intento abierto se actualiza al entregar; un intento enviado sigue inmutable | Decisión del PM; migración 1.2.3 |
| 2026-11-18 | §1b: Vinci es la entrada y la aplicación; los botones salen de `viewer_actions`. §2b: `for-assignment` y `/graduate-profiles` son del G5. §2c: reglas G (acciones de quien mira), H (el programa nace de la tarea), I (tipos de tarea) y J (quitar un archivo) | Interfaz unificada y los cambios de backend que la acompañan, hechos por el PM tras el cierre de entregas (PR #49 a #57) |
