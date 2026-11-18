# Notas para el backend (desde la interfaz Vinci)

Lo que la interfaz de `portal/` todavía necesita de la API y resuelve con rodeos.
Ninguno de estos cambios va en `pm/ui-unificada`: esta rama solo toca `portal/` y
`grupos/udv-styles/`.

## Ya resuelto con la API nueva (PR #47, #49, #52 y #53)

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

### 2. Quitar un archivo del intento y editar su descripción (G4 y G2)

El diseño compacto del detalle (mockup `vinci-entrega`) pone "Quitar" junto a cada
archivo del intento en preparación y deja editar su descripción en línea. La API no
tiene cómo: no hay `DELETE /assignments/{id}/files/{file_id}` (ni `DELETE /files/{id}`),
y la descripción solo existe como nombre del archivo subido (§1). Hoy la pantalla
pide la descripción antes de elegir el archivo (opcional; si no se escribe, se usa el
nombre del archivo) y no ofrece "Quitar". Pedido: desvincular un archivo del intento
que todavía no se envió, y guardar la descripción aparte para poder editarla.

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
