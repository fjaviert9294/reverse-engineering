/**
 * `JobRepository` — persistencia de jobs de análisis (Task 3.3).
 *
 * Responsabilidad: crear jobs, actualizar su progreso/etapa, fijar su estado
 * (con el módulo afectado ante error) y recuperarlos por identificador. Opera
 * exclusivamente sobre la tabla `analysis_job`, que solo guarda metadatos
 * operativos y de origen; NUNCA código fuente (Requisitos 2.2, 15.1).
 *
 * Requisitos cubiertos:
 * - 12.1: el progreso se representa como porcentaje en [0, 100] o la etapa
 *   actual; esta capa garantiza el invariante de rango y de etapa válida antes
 *   de escribir.
 * - 12.5: un análisis fallido conserva el estado previo de los datos; `setStatus`
 *   solo modifica estado/módulo del propio job, sin tocar otros datos.
 * - 14.6: ante fallo de un módulo, se registra el módulo afectado (`error_module`)
 *   para identificarlo.
 */

import type {
  AnalysisJob,
  AnalysisStage,
  JobStatus,
  ModuleError,
} from '../domain/index.js';
import type { Queryable } from './db.js';

/**
 * Contrato de persistencia de jobs (sección "Capa de Persistencia" del diseño).
 */
export interface JobRepository {
  create(job: AnalysisJob): Promise<void>;
  updateProgress(id: string, progress: number, stage: AnalysisStage): Promise<void>; // 12.1
  setStatus(id: string, status: JobStatus, error?: ModuleError): Promise<void>; // 12.5, 14.6
  findById(id: string): Promise<AnalysisJob | null>;
}

/** Error de validación de dominio previo a la escritura en persistencia. */
export class JobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobValidationError';
  }
}

/** Estados de job válidos (deben coincidir con el CHECK del esquema SQL). */
const VALID_STATUSES: readonly JobStatus[] = [
  'EN_COLA',
  'EN_PROGRESO',
  'COMPLETADO',
  'FALLIDO',
];

/** Etapas de análisis válidas (deben coincidir con el CHECK del esquema SQL). */
const VALID_STAGES: readonly AnalysisStage[] = [
  'INGESTA',
  'ANALISIS_ESTATICO',
  'INFERENCIA_IA',
  'PERSISTENCIA',
  'FINALIZADO',
];

/** Métodos de entrada admitidos (Requisitos 1.2, 15.1). */
const VALID_INPUT_SOURCES = ['ZIP', 'GITHUB_URL'] as const;

/**
 * Valida que `progress` sea un entero en [0, 100] (Requisito 12.1). Lanza
 * `JobValidationError` en otro caso.
 */
export function assertValidProgress(progress: number): void {
  if (
    typeof progress !== 'number' ||
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 100
  ) {
    throw new JobValidationError(
      `progress debe ser un entero en el rango [0, 100]; recibido: ${String(progress)}`,
    );
  }
}

/**
 * Valida que `stage` sea una de las etapas definidas. Lanza `JobValidationError`
 * en otro caso.
 */
export function assertValidStage(stage: AnalysisStage): void {
  if (!VALID_STAGES.includes(stage)) {
    throw new JobValidationError(
      `stage inválida: ${String(stage)}; permitidas: ${VALID_STAGES.join(', ')}`,
    );
  }
}

/** Valida que `status` sea uno de los estados definidos. */
export function assertValidStatus(status: JobStatus): void {
  if (!VALID_STATUSES.includes(status)) {
    throw new JobValidationError(
      `status inválido: ${String(status)}; permitidos: ${VALID_STATUSES.join(', ')}`,
    );
  }
}

/** Forma de fila devuelta por la consulta a `analysis_job`. */
interface JobRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  status: JobStatus;
  progress: number | string;
  stage: AnalysisStage;
  use_ai_requested: boolean;
  input_source: AnalysisJob['inputSource'];
  source_url: string | null;
  error_module: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Normaliza un timestamp de PostgreSQL a cadena ISO-8601. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Mapea una fila de `analysis_job` al tipo de dominio `AnalysisJob`. */
function rowToJob(row: JobRow): AnalysisJob {
  const job: AnalysisJob = {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    progress: typeof row.progress === 'string' ? Number.parseInt(row.progress, 10) : row.progress,
    stage: row.stage,
    useAIRequested: row.use_ai_requested,
    inputSource: row.input_source,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  if (row.source_url != null) {
    job.sourceUrl = row.source_url;
  }
  if (row.error_module != null) {
    job.errorModule = row.error_module;
  }
  return job;
}

/**
 * Implementación de `JobRepository` respaldada por PostgreSQL a través de un
 * `Queryable` parametrizado. Todas las consultas usan parámetros posicionales
 * (`$1`, `$2`, ...) para evitar inyección de SQL.
 */
export class SqlJobRepository implements JobRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Inserta un nuevo job. Valida invariantes de dominio (estado, progreso,
   * etapa, método de entrada) antes de escribir para no depender solo de los
   * CHECK del esquema.
   */
  async create(job: AnalysisJob): Promise<void> {
    assertValidStatus(job.status);
    assertValidProgress(job.progress);
    assertValidStage(job.stage);
    if (!VALID_INPUT_SOURCES.includes(job.inputSource)) {
      throw new JobValidationError(
        `inputSource inválido: ${String(job.inputSource)}; permitidos: ${VALID_INPUT_SOURCES.join(', ')}`,
      );
    }

    await this.db.query(
      `INSERT INTO analysis_job
         (id, user_id, status, progress, stage, use_ai_requested,
          input_source, source_url, error_module, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        job.id,
        job.userId,
        job.status,
        job.progress,
        job.stage,
        job.useAIRequested,
        job.inputSource,
        job.sourceUrl ?? null,
        job.errorModule ?? null,
        job.createdAt,
        job.updatedAt,
      ],
    );
  }

  /**
   * Actualiza progreso y etapa del job, garantizando el invariante de rango
   * [0, 100] y etapa válida antes de escribir (Requisito 12.1). Refresca
   * `updated_at`.
   */
  async updateProgress(id: string, progress: number, stage: AnalysisStage): Promise<void> {
    assertValidProgress(progress);
    assertValidStage(stage);

    await this.db.query(
      `UPDATE analysis_job
          SET progress = $2,
              stage = $3,
              updated_at = now()
        WHERE id = $1`,
      [id, progress, stage],
    );
  }

  /**
   * Fija el estado del job y, opcionalmente, el módulo afectado ante error
   * (Requisitos 12.5, 14.6). Solo modifica estado/módulo/`updated_at` del propio
   * job; no altera ningún otro dato, preservando el estado previo del resto
   * (Requisito 12.5).
   */
  async setStatus(id: string, status: JobStatus, error?: ModuleError): Promise<void> {
    assertValidStatus(status);

    await this.db.query(
      `UPDATE analysis_job
          SET status = $2,
              error_module = $3,
              updated_at = now()
        WHERE id = $1`,
      [id, status, error?.module ?? null],
    );
  }

  /** Recupera un job por id, o `null` si no existe. */
  async findById(id: string): Promise<AnalysisJob | null> {
    const result = await this.db.query<JobRow>(
      `SELECT id, user_id, status, progress, stage, use_ai_requested,
              input_source, source_url, error_module, created_at, updated_at
         FROM analysis_job
        WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : null;
  }
}
