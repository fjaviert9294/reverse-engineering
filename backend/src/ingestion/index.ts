/**
 * Punto de entrada del Módulo de Ingesta de Repo-Analyzer.
 *
 * Reexporta el contrato del módulo, sus tipos y errores, y la implementación
 * respaldada por el almacenamiento transitorio, para que el resto de capas
 * (orquestador, API) los consuman sin acoplarse a las rutas internas.
 */
export type {
  UploadedZip,
  ExtractedFile,
  ExtractedRepo,
  IngestionModule,
  IngestionErrorCode,
} from './types.js';
export { IngestionError } from './types.js';
export { TransientIngestionModule } from './ingestion-module.js';
export {
  detectAnalyzableLanguages,
  hasAnalyzableCode,
  languageForPath,
} from './analyzable-code.js';
export { readZipEntries, ZipParseError, normalizeEntryPath } from './zip-reader.js';
export {
  resolveGitHubUrl,
  isValidGitHubUrl,
  GitHubUrlError,
  type GitHubRepoRef,
} from './github-url.js';
export {
  FetchZipDownloader,
  type ZipDownloader,
  type ZipDownloadResult,
  type ZipDownloadFailureKind,
} from './zip-downloader.js';
export { createDisabledIngestionModule } from './disabled-ingestion-module.js';
