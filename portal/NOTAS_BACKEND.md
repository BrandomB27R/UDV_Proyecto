# Notas para el backend (desde la interfaz Vinci)

Lo que la interfaz de `portal/` necesita de la API y hoy resuelve con rodeos.
Ninguno de estos cambios va en `pm/ui-unificada`: esta rama solo toca `portal/` y
`grupos/udv-styles/`. Cuando la API los traiga, se quitan los rodeos indicados.

## 1. `GET /assignments/{id}` (G4): nombres y tarea de origen

Agregar al detalle:

| Campo | Tipo | Para qué |
|---|---|---|
| `reviewer_name` | texto o `null` | "Revisa: …" y "En espera de revisión por …" |
| `task_id` | entero | enlazar de la asignación al seguimiento de la tarea |
| `created_by` | entero | saber si quien mira puede cerrar (el G3 exige ser quien creó la tarea o su responsable) |
| `created_by_name` | texto | "Asignada por …" sin depender del historial |

Hoy la pantalla resuelve el nombre del revisor en este orden: `GET /users/{id}` si
quien mira tiene `users.read`; si no, el actor de una transición `review` o `return`
del historial (solo las hace el revisor designado); si no, muestra
"En espera de revisión por la coordinación". No se inventan nombres. Para un
docente, el nombre del revisor no se conoce hasta que el revisor actúa.

"Asignada por" sale del actor de la transición de publicación del historial.

El botón "Cerrar la tarea" se muestra a cualquier `coordinator` cuando la
asignación está `approved`; si no es quien la creó, el G3 responde 403 y se
muestra su mensaje. Con `created_by` el botón solo aparecería a quien corresponde.

## 2. `allowed_actions` no incluye `close` (G4)

La tabla de transiciones del G4 (`g4_inbox/acciones.py`) no tiene
`approved → close`, así que una asignación aprobada llega con
`allowed_actions: []`. La interfaz decide "Cerrar" por estado y rol. Conviene que
el G4 lea las acciones de `GET /workflow/matrix` (o de `workflow.matrix`) en vez
de mantener su propia copia.

## 3. Descripción del archivo (`name` al vincular, G4)

`POST /assignments/{id}/files` recibe `{file_id, name}`, pero con MySQL **no guarda
`name`**: solo hace `UPDATE archivo SET entrega_id`. El nombre que devuelve el
detalle es `archivo.nombre_original`, que fija `POST /files` con el nombre del
archivo subido.

Rodeo actual (requisito 13): la pantalla sube el PDF con la descripción como
nombre de archivo (`"Rúbrica de la unidad 2.pdf"`) y además la manda en `name`.
Al descargar, el archivo se guarda con ese nombre.

Lo correcto: guardar `name` como descripción (columna nueva o
`archivo.descripcion`, migración del G1) y devolverla en `files[].description`
junto a `name`.

## 4. Texto de cada intento (G4 y G3)

- El detalle solo trae `draft_comment` (el borrador vigente). No hay forma de ver
  el texto que se envió en cada intento (`entrega.contenido_texto`). Pedido:
  `attempts: [{number, text, submitted_at, files: [...]}]` en el detalle.
- La fila de `entrega` se crea con el texto del borrador **al vincular el primer
  archivo** del intento, y el G1 no deja modificarla. Si el docente cambia el texto
  después de adjuntar, el cambio no llega a la entrega. La pantalla bloquea el
  texto en cuanto hay un archivo en el intento y lo explica. Lo correcto: que el
  `submit`/`resubmit` del G3 copie el borrador vigente a la entrega del intento.

## 5. Comentarios sin fecha ni nombre (G4)

`comments` llega como `{author: "5", text}`. Pedido: `author_id` (entero),
`author_name` y `created_at`. Hoy la pantalla resuelve el nombre con
`assignee_id`/`reviewer_id` del detalle y, para coordinación, con `GET /users/{id}`;
si no puede, muestra "Coordinación". Los comentarios no muestran fecha.

## 6. Notificaciones sin enlace

`GET /notifications` no trae a qué asignación o tarea se refiere el aviso
(`assignment_id`, `task_id`). Con eso, cada aviso de la campana llevaría a su
detalle.

## 7. `GET /review-queue` sin revisor designado (G4)

Coordinación y administración ven la cola completa, incluidas las entregas que
tienen otro revisor designado y que no pueden revisar. Las filas no traen
`reviewer_id` ni `task_id`. Rodeo actual: "Por revisar" pide
`GET /assignments/{id}` de cada fila para leer `viewer.is_reviewer` y separa
"Te tocan a ti" de "Las revisa otra persona" (una llamada por fila). Pedido:
`reviewer_id`, `reviewer_name`, `task_id` y un booleano `is_mine` en cada fila.
