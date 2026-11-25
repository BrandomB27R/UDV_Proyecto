-- migracion_1.2.6.sql | Workflow docente UDV | escrita por el PM (20-nov-2026)
-- Se aplica sobre una base 1.2.5 que ya existe, sin perder datos:
--   mysql -u root db_udv < migracion_1.2.6.sql
-- Una base nueva no lo necesita: 01_schema.sql y 02_seed.sql ya traen el cambio.
-- No hay tablas ni columnas nuevas. Se puede correr mas de una vez.
--
-- Pedido del ingeniero: en el paso final, coordinacion no solo cierra una entrega aprobada;
-- tambien puede regresarla a revision si encontro algo que el revisor y el docente omitieron.
-- El revisor decide entonces con lo que ya existe: aprobar de nuevo o devolver al docente.
--   1. Accion nueva `reopen`: approved -> under_review, solo coordinacion, en todos los workflows.
--   2. trg_tt_valida exige una observacion en esa transicion (422), igual que en una devolucion.
--   3. Evento nuevo `assignment.reopened`, que crea trg_tt_evento, para avisar al revisor y al docente.
USE db_udv;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Cada CHECK se quita y se vuelve a poner en una sola sentencia: o cambia entero o no cambia.
ALTER TABLE workflow_detalle DROP CHECK ck_wd_accion, ADD CONSTRAINT ck_wd_accion
  CHECK (accion IN ('publish', 'start', 'submit', 'review', 'return', 'resubmit', 'approve', 'close', 'cancel', 'reopen'));

ALTER TABLE evento DROP CHECK ck_evento_nombre, ADD CONSTRAINT ck_evento_nombre
  CHECK (nombre IN ('task.published', 'assignment.due_soon', 'assignment.submitted',
                    'assignment.returned', 'assignment.approved', 'program.authorized', 'task.cancelled',
                    'assignment.reopened'));

INSERT INTO workflow_detalle (workflow_id, estado_origen, estado_destino, accion)
SELECT w.id, 'approved', 'under_review', 'reopen'
  FROM workflow w
 WHERE NOT EXISTS (SELECT 1 FROM workflow_detalle wd
                    WHERE wd.workflow_id = w.id AND wd.estado_origen = 'approved'
                      AND wd.estado_destino = 'under_review');

INSERT IGNORE INTO workflow_detalle_rol (workflow_detalle_id, rol_id)
SELECT wd.id, r.id
  FROM workflow_detalle wd JOIN rol r ON r.codigo = 'coordinator'
 WHERE wd.accion = 'reopen';

DROP TRIGGER IF EXISTS trg_tt_valida;
DROP TRIGGER IF EXISTS trg_tt_evento;

DELIMITER $$

CREATE TRIGGER trg_tt_valida BEFORE INSERT ON tarea_transicion FOR EACH ROW
BEGIN
  DECLARE v_estado_actual VARCHAR(20);
  DECLARE v_workflow_tarea INT;
  DECLARE v_ok INT DEFAULT 0;

  SELECT td.estado_codigo, t.workflow_id INTO v_estado_actual, v_workflow_tarea
  FROM tarea_destinatario td JOIN tarea t ON t.id = td.tarea_id
  WHERE td.id = NEW.tarea_destinatario_id;

  IF NEW.estado_anterior IS NULL THEN

    IF EXISTS (SELECT 1 FROM tarea_transicion WHERE tarea_destinatario_id = NEW.tarea_destinatario_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: la asignacion ya tiene transicion inicial (409)';
    END IF;
  ELSEIF NOT (NEW.estado_anterior <=> v_estado_actual) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: estado_anterior no coincide con el estado actual de la asignacion (409)';
  END IF;

  SELECT COUNT(*) INTO v_ok FROM workflow_detalle wd
  WHERE wd.id = NEW.workflow_detalle_id
    AND wd.workflow_id = v_workflow_tarea
    AND wd.estado_origen <=> NEW.estado_anterior
    AND wd.estado_destino = NEW.estado_nuevo;
  IF v_ok = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: transicion no permitida por el workflow de la tarea (409)';
  END IF;

  SET NEW.secuencia = (SELECT COUNT(*) + 1 FROM tarea_transicion WHERE tarea_destinatario_id = NEW.tarea_destinatario_id);

  IF NEW.estado_nuevo = 'returned' AND (NEW.comentario IS NULL OR TRIM(NEW.comentario) = '') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: una devolucion exige una observacion (422)';
  END IF;

  IF NEW.estado_anterior = 'approved' AND NEW.estado_nuevo = 'under_review'
     AND (NEW.comentario IS NULL OR TRIM(NEW.comentario) = '') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: regresar a revision exige una observacion (422)';
  END IF;
END$$

CREATE TRIGGER trg_tt_evento AFTER INSERT ON tarea_transicion FOR EACH ROW
BEGIN
  DECLARE v_nombre VARCHAR(40) DEFAULT NULL;
  SET v_nombre = CASE
                   WHEN NEW.estado_nuevo = 'submitted' THEN 'assignment.submitted'
                   WHEN NEW.estado_nuevo = 'returned'  THEN 'assignment.returned'
                   WHEN NEW.estado_nuevo = 'approved'  THEN 'assignment.approved'
                   WHEN NEW.estado_nuevo = 'under_review' AND NEW.estado_anterior = 'approved' THEN 'assignment.reopened'
                 END;
  IF v_nombre IS NOT NULL THEN
    INSERT INTO evento (nombre, clave_unica, tarea_id, tarea_destinatario_id, actor_id, payload)
    SELECT v_nombre, CONCAT(v_nombre, ':', NEW.tarea_destinatario_id, ':', NEW.secuencia),
           td.tarea_id, td.id, NEW.actor_id,
           JSON_OBJECT('usuario_id', td.usuario_id, 'estado_anterior', NEW.estado_anterior,
                       'estado_nuevo', NEW.estado_nuevo, 'comentario', NEW.comentario)
    FROM tarea_destinatario td WHERE td.id = NEW.tarea_destinatario_id;
  END IF;
END$$

DELIMITER ;

INSERT IGNORE INTO schema_migracion (version, descripcion) VALUES
('1.2.6', 'Coordinacion puede regresar a revision una entrega aprobada (reopen) con observacion');
