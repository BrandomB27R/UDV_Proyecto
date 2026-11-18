-- migracion_1.2.3.sql | Workflow docente UDV | escrita por el PM (17-nov-2026)
-- Se aplica sobre una base 1.2.2 que ya existe, sin perder datos:
--   mysql -u root db_udv < migracion_1.2.3.sql
-- Una base nueva no lo necesita: 01_schema.sql ya trae el cambio.
-- No hay tablas ni columnas nuevas: cambia un trigger. Se puede correr mas de una vez.
--
-- Antes: una fila de `entrega` no se podia modificar nunca. Como la fila se crea al
-- adjuntar el primer archivo del intento, el texto quedaba fijo desde ese momento y el
-- docente ya no podia corregirlo antes de entregar.
-- Ahora: mientras el intento no se haya enviado (no hay una transicion 'submitted' posterior
-- a su creacion) se pueden cambiar `contenido_texto` y `programa_version_id`. Un intento ya
-- enviado sigue sin poder modificarse, y nada de lo que identifica al intento cambia.
USE db_udv;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

DROP TRIGGER IF EXISTS trg_entrega_no_update;

DELIMITER $$

CREATE TRIGGER trg_entrega_no_update BEFORE UPDATE ON entrega FOR EACH ROW
BEGIN
-- Un intento ya enviado no se modifica nunca. Mientras el docente lo prepara (aun no hay
-- una transicion 'submitted' posterior a su creacion) solo pueden cambiar el texto y la
-- version de programa; lo demas identifica al intento y queda fijo. (1.2.3)
IF EXISTS (SELECT 1 FROM tarea_transicion tt
            WHERE tt.tarea_destinatario_id = OLD.tarea_destinatario_id
              AND tt.estado_nuevo = 'submitted' AND tt.creado_en >= OLD.entregado_en)
   OR NOT (NEW.id <=> OLD.id AND NEW.tarea_destinatario_id <=> OLD.tarea_destinatario_id
           AND NEW.numero_intento <=> OLD.numero_intento AND NEW.entregado_por <=> OLD.entregado_por
           AND NEW.entregado_en <=> OLD.entregado_en) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Una entrega no se modifica. Registre un nuevo intento.';
END IF;
END$$

DELIMITER ;

INSERT IGNORE INTO schema_migracion (version, descripcion) VALUES
('1.2.3', 'El texto de una entrega se puede corregir mientras el intento no se haya enviado');
