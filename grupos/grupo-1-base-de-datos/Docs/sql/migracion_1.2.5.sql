-- migracion_1.2.5.sql | Workflow docente UDV | escrita por el PM (18-nov-2026)
-- Se aplica sobre una base 1.2.4 que ya existe, sin perder datos:
--   mysql -u root db_udv < migracion_1.2.5.sql
-- Una base nueva no lo necesita: 01_schema.sql ya trae el cambio.
-- Agrega UNA columna a programa_version y vuelve a crear un trigger. Se puede correr mas de una vez.
--
-- Revision de seguridad del 18 de noviembre, hallazgo 10. En un programa de curso, "este curso
-- no tiene prerrequisitos" se guardaba en el navegador del docente y no en la base: en otra
-- computadora, o para quien revisa, la seccion aparecia incompleta. Ahora se guarda en
-- programa_version.sin_prerrequisitos (0 = no declarado, 1 = el curso no tiene prerrequisitos).
-- El trigger trg_pv_inmutable la cuenta como contenido: en una version autorizada no cambia.
USE db_udv;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.columns
                WHERE table_schema = 'db_udv' AND table_name = 'programa_version'
                  AND column_name = 'sin_prerrequisitos');
SET @sql := IF(@falta,
  'ALTER TABLE programa_version ADD COLUMN sin_prerrequisitos TINYINT(1) NOT NULL DEFAULT 0 AFTER horas_clase_semanal',
  'DO 0');
PREPARE paso FROM @sql;
EXECUTE paso;
DEALLOCATE PREPARE paso;

DROP TRIGGER IF EXISTS trg_pv_inmutable;

DELIMITER $$

CREATE TRIGGER trg_pv_inmutable BEFORE UPDATE ON programa_version FOR EACH ROW
BEGIN
  DECLARE v_total DECIMAL(7,2);
  DECLARE v_mismo_contenido TINYINT(1);

  SET v_mismo_contenido = (NEW.programa_curso_id = OLD.programa_curso_id
              AND NEW.nombre = OLD.nombre
              AND NEW.periodo_id = OLD.periodo_id
              AND NEW.numero_version = OLD.numero_version
              AND NEW.descripcion <=> OLD.descripcion
              AND NEW.resumen_cambios <=> OLD.resumen_cambios
              AND NEW.unidad_academica_id <=> OLD.unidad_academica_id
              AND NEW.programa_academico <=> OLD.programa_academico
              AND NEW.departamento <=> OLD.departamento
              AND NEW.nivel <=> OLD.nivel
              AND NEW.area_id <=> OLD.area_id
              AND NEW.pensum <=> OLD.pensum
              AND NEW.sin_prerrequisitos <=> OLD.sin_prerrequisitos
              AND NEW.horas_clase_semanal <=> OLD.horas_clase_semanal
              AND NEW.docente_responsable_id <=> OLD.docente_responsable_id
              AND NEW.revisor_id <=> OLD.revisor_id
              AND NEW.observaciones_autorizacion <=> OLD.observaciones_autorizacion
              AND NEW.autorizado_por <=> OLD.autorizado_por
              AND NEW.autorizado_en <=> OLD.autorizado_en);

  IF OLD.estado_codigo = 'superseded' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Version reemplazada: es historica y no se modifica (409)';
  END IF;

  IF NEW.estado_codigo <> OLD.estado_codigo
     AND NOT EXISTS (SELECT 1 FROM flujo_programa
                     WHERE estado_origen = OLD.estado_codigo AND estado_destino = NEW.estado_codigo) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: cambio de estado del programa no permitido por flujo_programa (409)';
  END IF;

  IF OLD.estado_codigo = 'authorized' THEN
    IF NOT v_mismo_contenido
       OR NOT (

            (NEW.estado_codigo = 'superseded'
             AND NEW.pdf_archivo_id <=> OLD.pdf_archivo_id AND NEW.pdf_hash <=> OLD.pdf_hash)

         OR (NEW.estado_codigo = 'authorized' AND OLD.pdf_hash IS NULL)
          ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Version autorizada: no se modifica, cree una nueva version (409)';
    END IF;
  END IF;

  IF NEW.estado_codigo = 'submitted' AND OLD.estado_codigo <> 'submitted' THEN
    SELECT IFNULL(SUM(ponderacion), 0) INTO v_total
    FROM programa_evaluacion WHERE programa_version_id = NEW.id;
    IF v_total <> 100 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: las evaluaciones deben sumar 100 para enviar el programa (422)';
    END IF;
  END IF;

  IF NEW.estado_codigo = 'authorized' AND OLD.estado_codigo <> 'authorized'
     AND (NEW.autorizado_por IS NULL OR NEW.autorizado_en IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: autorizar requiere autorizado_por y autorizado_en';
  END IF;
END$$

DELIMITER ;

INSERT IGNORE INTO schema_migracion (version, descripcion) VALUES
('1.2.5', 'programa_version.sin_prerrequisitos: el curso declara que no tiene prerrequisitos');
