-- migracion_1.2.4.sql | Workflow docente UDV | escrita por el PM (18-nov-2026)
-- Se aplica sobre una base 1.2.3 que ya existe, sin perder datos:
--   mysql -u root db_udv < migracion_1.2.4.sql
-- Una base nueva no lo necesita: 02_seed.sql ya trae el cambio.
-- No hay tablas ni columnas nuevas: quita dos filas de rol_permiso. Se puede correr mas de una vez.
--
-- Revision de seguridad del 18 de noviembre, hallazgo 8. El permiso `users.read` deja leer la
-- lista completa de usuarios con sus correos. Lo tenian administracion, coordinacion, revision
-- y auditoria. Revision y auditoria no lo usan en ninguna pantalla: los nombres que necesitan
-- ya vienen en cada entrega, en cada programa y en los filtros de la auditoria. Se les quita.
-- Administracion (gestiona las cuentas) y coordinacion (elige destinatarios y revisor) lo conservan.
USE db_udv;
SET NAMES utf8mb4;

DELETE rp FROM rol_permiso rp
  JOIN rol r     ON r.id = rp.rol_id
  JOIN permiso p ON p.id = rp.permiso_id
 WHERE p.codigo = 'users.read' AND r.codigo IN ('reviewer', 'auditor');

INSERT IGNORE INTO schema_migracion (version, descripcion) VALUES
('1.2.4', 'users.read solo para administracion y coordinacion');
