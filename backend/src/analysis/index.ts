/**
 * Punto de entrada del Módulo de Análisis Estático de Repo-Analyzer.
 *
 * Reexporta los tipos del análisis estático y la detección de lenguajes y
 * prioridad (Task 8.1) para que el resto de capas (orquestador, ensamblado del
 * resultado) los consuman sin acoplarse a las rutas internas.
 */
export type {
  LanguageProfile,
  ConfigFileKind,
  ParsedConfigFile,
  ConfigReadResult,
} from './types.js';
export {
  detectLanguages,
  detectLanguagesFromPaths,
  NO_SUPPORTED_LANGUAGES_NOTICE,
} from './language-detection.js';
export { readConfigFiles, type ConfigContentReader } from './config-reader.js';
export {
  generateFunctionalSummary,
  FUNCTIONAL_SUMMARY_MIN_LENGTH,
  FUNCTIONAL_SUMMARY_MAX_LENGTH,
  FUNCTIONAL_SUMMARY_UNDETERMINED_NOTICE,
} from './functional-summary.js';
export {
  identifyComponents,
  identifyComponentsFromPaths,
  NO_KEY_COMPONENTS_NOTICE,
  type ComponentIdentificationResult,
} from './component-identification.js';
export {
  inferArchitecture,
  ARCHITECTURE_UNDETERMINED_NOTICE,
  ARCHITECTURE_UNCERTAIN_THRESHOLD,
} from './architecture-inference.js';
export {
  findAdditional,
  DEFAULT_DETECTORS,
  defaultVulnerabilityDetector,
  defaultOutdatedDependencyDetector,
  defaultApiEndpointDetector,
  type FindingsContext,
  type FindingsDetectors,
  type VulnerabilityDetector,
  type OutdatedDependencyDetector,
  type ApiEndpointDetector,
} from './additional-findings.js';
export {
  assembleStaticAnalysisResult,
  runStaticAnalysis,
  type StaticAnalysisParts,
  type AnalysisResultIdentity,
} from './static-analysis-result.js';
