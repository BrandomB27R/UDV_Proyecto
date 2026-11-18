-- migracion_1.2.2.sql | Workflow docente UDV | escrita por el PM al cierre de entregas (17-nov-2026)
-- Se aplica sobre una base 1.2.1 que ya existe, sin perder datos:
--   mysql -u root db_udv < migracion_1.2.2.sql
-- Una base nueva no lo necesita: 01_schema.sql y 02_seed.sql ya traen el cambio.
-- Solo datos, sin cambios de esquema. Es idempotente: se puede correr mas de una vez.
--
-- 1. Decision C (13-nov): el docente elabora y envia su programa de curso; coordinacion lo revisa y aprueba.
--      teacher     -> programs.manage  (rol 3, permiso 14)
--      coordinator -> programs.review  (rol 2, permiso 18)
-- 2. Perfil de coordinacion (17-nov): coordinacion, revision y autoridad los ejerce la misma persona.
--    El usuario de coordinacion de la semilla (id 2) recibe ademas los roles reviewer (4) y authority (5).
--    Los seis roles siguen existiendo; las cuentas revisor@ y direccion@ no cambian.

USE db_udv;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT IGNORE INTO rol_permiso (rol_id, permiso_id) VALUES (3, 14), (2, 18);

INSERT IGNORE INTO usuario_rol (usuario_id, rol_id, asignado_por)
SELECT u.id, r.id, 1
FROM usuario u
JOIN rol r ON r.codigo IN ('reviewer', 'authority')
WHERE u.correo = 'coordinacion@demo.udv.edu.gt';

INSERT IGNORE INTO schema_migracion (version, descripcion) VALUES
('1.2.2', 'Permisos de programas para docente y coordinacion (decision C); el usuario de coordinacion ejerce tambien revision y autoridad');
