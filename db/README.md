# Base de datos (PostgreSQL)

Esta carpeta contiene el esquema y las migraciones de PostgreSQL.

## Estructura

- `migrations/` — scripts SQL de migración, aplicados en orden lexicográfico.

## Migraciones

- `0001_init.sql` (Task 1 — andamiaje): habilita la extensión `pgcrypto` para la
  generación de UUID (`gen_random_uuid()`).
- `0002_schema.sql` (Task 3.1 — esquema del modelo de datos): crea las tablas del
  modelo entidad-relación del diseño: `usuario`, `preferencia`, `analysis_job`,
  `analysis_result`, `functional_summary`, `key_component`,
  `architecture_inference`, `vulnerability`, `outdated_dependency` y
  `api_endpoint`.
- `0003_analysis_result_roundtrip.sql` (Task 3.2 — persistencia): añade columnas
  para reconstruir sin pérdida el `AnalysisResult` desde `AnalysisResultRepository`
  (`analysis_result.notices`, `functional_summary.determined`,
  `key_component.inferred` y el estado por categoría de hallazgos adicionales).
  Ninguna almacena código fuente (Requisito 2.2).

Las migraciones se aplican en orden lexicográfico. En despliegue local, se montan
en `docker-entrypoint-initdb.d` (ver `docker-compose.yml`), de modo que Postgres
las ejecuta en orden (`0001` y luego `0002`) al inicializar la base de datos.
