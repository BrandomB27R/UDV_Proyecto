# Notas para el backend (desde la interfaz Vinci)

Lo que la interfaz de `portal/` todavía necesita de la API y resuelve con rodeos.
Ninguno de estos cambios va en `pm/ui-unificada`: esta rama solo toca `portal/` y
`grupos/udv-styles/`.

## Ya resuelto con la API nueva (PR #47, #49, #52, #53, #55, #56, #60 y #62)

Se quitaron los rodeos que dependían de esto:

- Detalle (`GET /assignments/{id}`): `viewer_actions` pinta los botones (sin lógica
  propia de permisos); `assignee_name`, `reviewer_name`, `created_by_name` y `task_id`
  reemplazan las consultas a `/users` y al historial; `attempts` muestra el texto de
  cada intento; `delivery` decide qué pide la entrega y qué archivos acepta;
  `course_*` y `period_*` se muestran en la cabecera.
- Comentarios con `author_name` y `created_at`.
- Cola de revisión con `mine` y `reviewer_name`: ya no se pide el detalle por fila.
- Avisos con `assignment_id` (y `program_version_id`): cada uno enlaza a su tarea.
- Tareas con `course_id` y `period_id`; docentes sugeridos con
  `GET /tasks/eligible-teachers`.
- El texto de la entrega se corrige hasta entregar: el G3 copia el borrador
  vigente al hacer `submit`/`resubmit` (se quitó el bloqueo del campo).
- `/inbox` y `/review-queue` traen el curso: se muestra en Mis tareas y Por revisar.
- `GET /tasks` y `/tasks/{id}` traen `created_by_name` y `reviewer_name`: el
  seguimiento y la lista de Tareas ya no consultan `/users`.
- Programa de curso: `POST /program-versions/for-assignment/{id}` ("Completar el
  programa" desde la tarea), `viewer_actions` en la versión (los botones salen solo
  de ahí) y `GET /graduate-profiles` (selector de Perfil de egreso). `/changes`
  compara la primera versión de un período con la versión de la que se copió.
- "Quitar" en cada archivo del intento abierto: `DELETE /assignments/{id}/files/{file_id}`
  (PR #56). La lista se repinta con `files` de la respuesta, sin perder el mensaje;
  tras entregar ya no aparece.
- Panel y Tareas sin una llamada por tarea (PR #60): "Por docente" sale de
  `GET /dashboard/teachers` (cuadra con las tarjetas y ya lo ven administración y
  auditoría) y el avance de cada tarea de `GET /tasks?include=progress`.
- Buscar por docente en Tareas (PR #62): `progress.assignee_names` trae a todos los
  destinatarios, así que la búsqueda encuentra también las tareas de varios docentes.

## Pendiente

### 1. Descripción del archivo (`name` al vincular, G4 y G1)

`POST /assignments/{id}/files` recibe `{file_id, name}`, pero `name` no se guarda: el
nombre que devuelve el detalle es `archivo.nombre_original`, que fija `POST /files`
con el nombre del archivo subido.

Rodeo actual (requisito 13): la pantalla sube el archivo con la descripción como
nombre (`"Rúbrica de la unidad 2.pdf"`, conservando la extensión original) y además
la manda en `name`. Al descargar, el archivo se guarda con ese nombre.

Lo correcto: columna `archivo.descripcion` (migración del G1) y devolverla en
`files[].description` junto a `name`.

### 2. Editar la descripción de un archivo ya subido (G4 y G1)

"Quitar" ya funciona (ver arriba). Lo que sigue pendiente es editar en línea la
descripción de un archivo, como en el mockup `vinci-entrega`: la descripción solo
existe como nombre del archivo subido (§1). Hoy la pantalla la pide antes de elegir
el archivo (opcional; si no se escribe, se usa el nombre del archivo) y, para
cambiarla, el docente quita el archivo y lo vuelve a subir. Se resuelve junto con §1.

### 3. `delivery` según lo que acepta `POST /files` (G4 y G2)

`delivery.extensions` ya viene recortado a lo que acepta el G2 (PDF, JPG, PNG) y
`not_accepted` dice el resto; la pantalla lo muestra así. Si el G2 amplía los tipos
(por ejemplo DOCX o XLSX para "Cargar evidencia"), basta con que `delivery` lo refleje.

## Programas de curso (etapa 2)

### 4. Contenidos por unidad y módulo (G5)

El `PUT` de la sección `contenidos` guarda unidades planas con sus temas e ignora
`unidad_padre_id`. La pantalla edita unidades (título y horas) con temas,
reordenables. Para tener módulos dentro de la unidad, el G5 debe leer y guardar
`unidad_padre_id`.

### 5. "Sin prerrequisitos" no se guarda (G5)

La sección se da por completa con al menos un curso o con la casilla "Sin
prerrequisitos". La API no tiene dónde guardar esa casilla: hoy queda en el
navegador de quien la marca. Pedido: un campo `sin_prerrequisitos` en la versión.

### 6. `/changes` devuelve identificadores internos (G5)

Cada `programa_unidad_id` (y otros `*_id` y `orden`) sale como cambio aunque el
contenido sea el mismo. La pantalla los filtra y muestra etiquetas legibles; lo
correcto es que `/changes` compare solo el contenido.

### 7. Versión enlazada a la tarea y lectura del docente (G4 y G5)

Si la tarea tiene `programa_version_id` (la de la semilla), el detalle de cada
asignación trae esa misma versión aunque el docente no sea su responsable; ese
docente recibe 404 al leerla y no ve su avance. Con `for-assignment` cada docente
tendrá la suya: conviene que `program_version` del detalle priorice la versión
creada desde la asignación y no devuelva una que quien mira no puede leer.

## Inicio (rediseño del 18-nov)

### 8. `/inbox` sin revisor, fecha de entrega ni observación (G4) — resuelto (PR #69, vinci-11)

Cada fila de `GET /inbox` trae ahora `reviewer_name`, `submitted_at` y
`last_return_comment` (este, solo mientras la asignación está devuelta). El inicio
del docente ya no hace ninguna consulta por fila: «Qué sigue» de las devueltas
muestra `last_return_comment`, y «En espera de revisión» dice quién la tiene
(«Espera a que <revisor> la tome» / «La revisa <revisor>») y cuándo se entregó.

## Auditoría e inicio de dirección (19-nov)

### 9. Auditoría (G6) — resuelto en parte (PR #72, vinci-14)

Resuelto:
- `entity_label` en cada registro: «Sobre qué» lo usa antes que `changes`; si viene
  null, queda «n.º <entity_id>».
- `name` de cada usuario en `/audit/filters`: el filtro «Usuario» muestra el nombre
  (con el correo) y los campos como «Revisor» se muestran con el nombre.

Pendiente:
- **`from` y `to` por día UTC.** La pantalla filtra por días de Guatemala (UTC−6) y,
  para cubrirlos enteros, pide `from` = desde y `to` = hasta + 1. Así pueden entrar
  registros de hasta 6 h antes (la noche anterior) y de las primeras 18 h del día
  siguiente. Propuesta: aceptar fecha y hora con zona (`from=2026-11-17T06:00:00Z`) o
  un parámetro `tz=America/Guatemala`.

### 10. Programas por autorizar (G5) — resuelto (PR #72, vinci-14)

Cada fila de `/course-programs` trae `docente_responsable`, `aprobado_por` y
`aprobado_en`. «Te toca autorizar» ya no pide el detalle de cada versión: «Elaboró»
sale de `docente_responsable` y la columna «Aprobó» muestra quién y hace cuánto.
