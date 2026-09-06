/**
 * Punto de entrada de la capa de persistencia de Repo-Analyzer.
 *
 * Reexporta la abstracción de cliente de base de datos, los errores de
 * persistencia y los repositorios, para que el resto de capas los consuman sin
 * acoplarse a las rutas internas.
 */
export type { PgClient, Queryable, QueryResult, QueryRow } from './db.js';
export { PersistenceError, ResultNotFoundError } from './errors.js';
export {
  SqlAnalysisResultRepository,
  type AnalysisResultRepository,
} from './analysisResultRepository.js';
export {
  SqlJobRepository,
  JobValidationError,
  assertValidProgress,
  assertValidStage,
  assertValidStatus,
  type JobRepository,
} from './job-repository.js';
export {
  SqlPreferenceRepository,
  type PreferenceRepository,
} from './preference-repository.js';
export {
  InMemoryJobRepository,
  InMemoryAnalysisResultRepository,
  InMemoryPreferenceRepository,
} from './in-memory-repositories.js';
export { PgClientAdapter, type PgClientAdapterOptions } from './pg-client.js';
