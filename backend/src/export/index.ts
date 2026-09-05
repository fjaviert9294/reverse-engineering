/**
 * Punto de entrada del Módulo de Exportación de Repo-Analyzer.
 *
 * Reexporta el contrato (`ExportModule`), los tipos de resultado
 * (`MarkdownDocument`, `ExportError`) y la implementación de exportación a
 * Markdown (Task 11.1), para que el resto de capas (API, orquestador) los
 * consuman sin acoplarse a las rutas internas.
 */
export type {
  ExportModule,
  MarkdownDocument,
  ExportError,
  ExportErrorReason,
} from './types.js';
export {
  exportMarkdown,
  markdownExportModule,
  DEFAULT_EXPORT_FILENAME,
  EMPTY_RESULT_MESSAGE,
  GENERATION_FAILURE_MESSAGE,
} from './markdown-export.js';
export { createDisabledExportModule } from './disabled-export-module.js';
