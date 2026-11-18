# Notas para el backend (desde la interfaz Vinci)

Lo que la interfaz de `portal/` todavía necesita de la API y resuelve con rodeos.
Ninguno de estos cambios va en `pm/ui-unificada`: esta rama solo toca `portal/` y
`grupos/udv-styles/`.

## Ya resuelto con la API nueva (PR #47 y #49)

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

### 2. El texto de la entrega se fija al adjuntar el primer archivo (G1 y G3)

La fila de `entrega` se crea con el texto del borrador al vincular el primer archivo
del intento, y el G1 no deja modificarla (trigger). Si el docente cambia el texto
después de adjuntar, el cambio no llega a la entrega. La pantalla bloquea el texto en
cuanto hay un archivo en el intento y lo explica. Lo correcto es que `submit` /
`resubmit` copien el borrador vigente a la entrega; es una decisión aparte porque
toca la regla de inmutabilidad del G1.

### 3. Curso en las listas del docente y del revisor (G4)

`GET /inbox` y `GET /review-queue` no traen `course_code` ni `period_code`. Por eso
el curso se ve en el detalle, en Tareas y en el seguimiento, pero no en "Mis tareas"
ni en "Por revisar". Pedido: `course_code`, `course_name` y `period_code` en cada fila.

### 4. `delivery` según lo que acepta `POST /files` (G4 y G2)

`delivery.extensions` ya viene recortado a lo que acepta el G2 (PDF, JPG, PNG) y
`not_accepted` dice el resto; la pantalla lo muestra así. Si el G2 amplía los tipos
(por ejemplo DOCX o XLSX para "Cargar evidencia"), basta con que `delivery` lo refleje.

### 5. Nombres en el seguimiento de una tarea (G3)

`GET /tasks/{id}` y `GET /tasks` traen `reviewer_id` y `created_by` sin nombre. El
seguimiento y la lista de Tareas los resuelven con `GET /users` (coordinación tiene
`users.read`). Pedido: `reviewer_name` y `created_by_name`, como en el detalle de la
asignación.
