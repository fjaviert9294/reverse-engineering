-- Migración inicial (Task 1 — andamiaje).
-- Habilita la generación de UUID usada por el modelo de datos del diseño.
-- Las tablas del esquema (USUARIO, ANALYSIS_JOB, ANALYSIS_RESULT, ...) se crean
-- en la Task 3. Aquí no se define ninguna tabla y, en particular, ninguna
-- columna que almacene contenido del código fuente (Requisito 2.2).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
