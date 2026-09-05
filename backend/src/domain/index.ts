/**
 * Punto de entrada del módulo de dominio de Repo-Analyzer.
 *
 * Reexporta los tipos e interfaces del dominio para su consumo por el resto de
 * capas (persistencia, módulos de dominio, API/Auth) sin acoplarlas a la ruta
 * interna del archivo de tipos.
 */
export type {
  JobStatus,
  AnalysisStage,
  InputSource,
  SupportedLanguage,
  ComponentCategory,
  ArchitectureType,
  AnalysisMode,
  FindingCategoryStatus,
  ModuleError,
  AnalysisJob,
  AnalysisResult,
  FunctionalSummary,
  KeyComponent,
  ArchitectureInference,
  AdditionalFindings,
  FindingCategory,
  Vulnerability,
  OutdatedDep,
  ApiEndpoint,
  Session,
  StoredUser,
  AuthError,
} from './types.js';
