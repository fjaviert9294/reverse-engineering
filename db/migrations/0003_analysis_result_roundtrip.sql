-- Migración 0003 — Columnas para el round-trip fiel de AnalysisResult (Task 3.2).
--
-- El esquema 0002 modela el resultado del análisis, pero el contrato de tipos
-- del dominio (backend/src/domain/types.ts) incluye campos que la capa de
-- persistencia (`AnalysisResultRepository`) debe guardar y reconstruir sin
-- pérdida para satisfacer la recuperación fiel del `Resultado_Analisis`
-- (Requisitos 2.1, 2.3). Esta migración añade esas columnas/estados.
--
-- INVARIANTE CENTRAL (Requisito 2.2): ninguna de estas columnas almacena
-- contenido del código fuente; solo resultados de análisis y metadatos.

-- ---------------------------------------------------------------------------
-- ANALYSIS_RESULT.notices — avisos de degradación al usuario
-- (Requisitos 3.6, 4.6, 9.5). Reconstruye `AnalysisResult.notices`.
-- ---------------------------------------------------------------------------
ALTER TABLE analysis_result
    ADD COLUMN notices jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- FUNCTIONAL_SUMMARY.determined — si el propósito se determinó (Requisitos 6.1, 6.3).
-- Reconstruye `FunctionalSummary.determined`.
-- ---------------------------------------------------------------------------
ALTER TABLE functional_summary
    ADD COLUMN determined boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- KEY_COMPONENT.inferred — si la categoría se determinó por inferencia
-- (Requisito 7.2). Reconstruye `KeyComponent.inferred`.
-- ---------------------------------------------------------------------------
ALTER TABLE key_component
    ADD COLUMN inferred boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Estado por categoría de hallazgos adicionales. Distingue explícitamente
-- CON_HALLAZGOS, SIN_HALLAZGOS y NO_ANALIZABLE (Requisitos 9.4, 9.5).
-- Se guardan en ANALYSIS_RESULT porque son metadatos de la categoría, no del
-- ítem individual; así una categoría sin ítems puede ser SIN_HALLAZGOS o
-- NO_ANALIZABLE de forma inequívoca. Reconstruye `AdditionalFindings.*.status`.
-- ---------------------------------------------------------------------------
ALTER TABLE analysis_result
    ADD COLUMN vulnerabilities_status text NOT NULL DEFAULT 'SIN_HALLAZGOS'
        CHECK (vulnerabilities_status IN ('CON_HALLAZGOS', 'SIN_HALLAZGOS', 'NO_ANALIZABLE')),
    ADD COLUMN outdated_dependencies_status text NOT NULL DEFAULT 'SIN_HALLAZGOS'
        CHECK (outdated_dependencies_status IN ('CON_HALLAZGOS', 'SIN_HALLAZGOS', 'NO_ANALIZABLE')),
    ADD COLUMN api_endpoints_status text NOT NULL DEFAULT 'SIN_HALLAZGOS'
        CHECK (api_endpoints_status IN ('CON_HALLAZGOS', 'SIN_HALLAZGOS', 'NO_ANALIZABLE'));
