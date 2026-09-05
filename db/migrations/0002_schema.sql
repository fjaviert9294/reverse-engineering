-- Migración 0002 — Esquema del modelo de datos (Task 3.1).
--
-- Define las tablas del modelo entidad-relación del documento de diseño
-- (sección "Data Models"): USUARIO, PREFERENCIA, ANALYSIS_JOB, ANALYSIS_RESULT,
-- FUNCTIONAL_SUMMARY, KEY_COMPONENT, ARCHITECTURE_INFERENCE, VULNERABILITY,
-- OUTDATED_DEPENDENCY y API_ENDPOINT.
--
-- INVARIANTE CENTRAL (Requisito 2.2): NINGUNA columna almacena contenido del
-- código fuente del repositorio. El esquema solo guarda resultados de análisis
-- y metadatos operativos (jobs, usuarios, preferencias). La única referencia al
-- origen del código es `ANALYSIS_JOB.source_url` (URL de un repositorio de
-- GitHub público), que es un metadato de origen y NO código fuente
-- (Requisitos 1.2, 15.1).
--
-- Requiere la extensión `pgcrypto` (habilitada en 0001_init.sql) para gen_random_uuid().

-- ---------------------------------------------------------------------------
-- USUARIO — persona autenticada del sistema (Requisitos 13.x)
-- ---------------------------------------------------------------------------
CREATE TABLE usuario (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    username        text        NOT NULL UNIQUE,
    password_hash   text        NOT NULL,
    failed_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until    timestamptz
);

-- ---------------------------------------------------------------------------
-- PREFERENCIA — preferencia de uso de IA por usuario (1:1 con USUARIO)
-- (Requisito 3.3)
-- ---------------------------------------------------------------------------
CREATE TABLE preferencia (
    user_id uuid    PRIMARY KEY REFERENCES usuario (id) ON DELETE CASCADE,
    use_ai  boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- ANALYSIS_JOB — job de análisis: estado, progreso y metadatos de origen.
-- Nunca contiene código fuente (Requisitos 1.2, 2.2, 12.x, 14.6, 15.1).
-- ---------------------------------------------------------------------------
CREATE TABLE analysis_job (
    id                 uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid       NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
    status             text       NOT NULL
                                  CHECK (status IN ('EN_COLA', 'EN_PROGRESO', 'COMPLETADO', 'FALLIDO')),
    progress           integer    NOT NULL DEFAULT 0
                                  CHECK (progress BETWEEN 0 AND 100),
    stage              text       NOT NULL
                                  CHECK (stage IN ('INGESTA', 'ANALISIS_ESTATICO', 'INFERENCIA_IA', 'PERSISTENCIA', 'FINALIZADO')),
    use_ai_requested   boolean    NOT NULL DEFAULT false,
    -- Método de entrada admitido: ZIP subido o URL de GitHub (Requisitos 1.2, 15.1).
    input_source       text       NOT NULL
                                  CHECK (input_source IN ('ZIP', 'GITHUB_URL')),
    -- Metadato de origen; solo para GITHUB_URL. NO es código fuente (Requisito 15.1).
    source_url         text,
    -- Módulo afectado ante fallo, para aislamiento de errores (Requisito 14.6).
    error_module       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_analysis_job_user_id ON analysis_job (user_id);

-- ---------------------------------------------------------------------------
-- ANALYSIS_RESULT — resultado del análisis. Única entidad de resultados,
-- 0..1 por job. No contiene código fuente (Requisito 2.2).
-- ---------------------------------------------------------------------------
CREATE TABLE analysis_result (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Un resultado por job como máximo (relación ||--o| del diagrama).
    job_id              uuid        NOT NULL UNIQUE REFERENCES analysis_job (id) ON DELETE CASCADE,
    -- Lenguaje principal según prioridad, o NULL si no hay soportados (Requisito 5.2).
    primary_language    text        CHECK (primary_language IN ('JAVA', 'TYPESCRIPT', 'JAVASCRIPT', 'PYTHON')),
    -- Lenguajes secundarios en orden de prioridad (Requisito 5.2).
    secondary_languages jsonb       NOT NULL DEFAULT '[]'::jsonb,
    analysis_mode       text        NOT NULL
                                    CHECK (analysis_mode IN ('SOLO_ESTATICO', 'ESTATICO_MAS_IA')),
    -- Indicaciones sobre configuración no disponible/no procesable (Requisitos 5.6, 5.7).
    config_read_notes   jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_analysis_result_job_id ON analysis_result (job_id);

-- ---------------------------------------------------------------------------
-- FUNCTIONAL_SUMMARY — explicación funcional (1:1 con ANALYSIS_RESULT)
-- (Requisitos 6.1–6.3)
-- ---------------------------------------------------------------------------
CREATE TABLE functional_summary (
    result_id      uuid    PRIMARY KEY REFERENCES analysis_result (id) ON DELETE CASCADE,
    summary        text    NOT NULL,
    confidence_pct integer NOT NULL
                           CHECK (confidence_pct BETWEEN 0 AND 100)
);

-- ---------------------------------------------------------------------------
-- KEY_COMPONENT — componentes clave (0..N por resultado). Solo ruta/ubicación
-- y categoría; nunca contenido del código (Requisitos 7.1–7.4).
-- ---------------------------------------------------------------------------
CREATE TABLE key_component (
    id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id  uuid    NOT NULL REFERENCES analysis_result (id) ON DELETE CASCADE,
    path       text    NOT NULL,
    category   text    NOT NULL
                       CHECK (category IN ('modulo', 'servicio', 'controlador', 'modelo', 'punto_de_entrada', 'configuracion')),
    -- Nivel de confianza en [0.00, 1.00] cuando la categoría es inferida (Requisito 7.2).
    confidence numeric(3, 2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX idx_key_component_result_id ON key_component (result_id);

-- ---------------------------------------------------------------------------
-- ARCHITECTURE_INFERENCE — arquitectura inferida (1:1 con ANALYSIS_RESULT)
-- (Requisitos 8.1–8.5)
-- ---------------------------------------------------------------------------
CREATE TABLE architecture_inference (
    result_id      uuid    PRIMARY KEY REFERENCES analysis_result (id) ON DELETE CASCADE,
    -- NULL cuando la arquitectura no se determina (Requisito 8.5).
    type           text    CHECK (type IN ('monolito', 'microservicios', 'mvc', 'hexagonal', 'por_capas', 'otro')),
    confidence_pct integer NOT NULL
                           CHECK (confidence_pct BETWEEN 0 AND 100),
    evidence       text    NOT NULL DEFAULT '',
    determined     boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- VULNERABILITY — vulnerabilidades detectadas (0..N por resultado)
-- (Requisito 9.1)
-- ---------------------------------------------------------------------------
CREATE TABLE vulnerability (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id  uuid NOT NULL REFERENCES analysis_result (id) ON DELETE CASCADE,
    location   text NOT NULL,
    severity   text NOT NULL
);

CREATE INDEX idx_vulnerability_result_id ON vulnerability (result_id);

-- ---------------------------------------------------------------------------
-- OUTDATED_DEPENDENCY — dependencias desactualizadas (0..N por resultado)
-- (Requisito 9.2)
-- ---------------------------------------------------------------------------
CREATE TABLE outdated_dependency (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id        uuid NOT NULL REFERENCES analysis_result (id) ON DELETE CASCADE,
    name             text NOT NULL,
    detected_version text NOT NULL,
    latest_version   text NOT NULL
);

CREATE INDEX idx_outdated_dependency_result_id ON outdated_dependency (result_id);

-- ---------------------------------------------------------------------------
-- API_ENDPOINT — endpoints de API detectados (0..N por resultado)
-- (Requisito 9.3)
-- ---------------------------------------------------------------------------
CREATE TABLE api_endpoint (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id  uuid NOT NULL REFERENCES analysis_result (id) ON DELETE CASCADE,
    path       text NOT NULL,
    method     text NOT NULL
);

CREATE INDEX idx_api_endpoint_result_id ON api_endpoint (result_id);
