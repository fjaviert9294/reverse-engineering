/**
 * Módulo de Exportación DESHABILITADO (Requisito 14.1).
 *
 * Cuando el módulo de exportación está deshabilitado por configuración, se
 * inyecta esta implementación. Demuestra que deshabilitar un módulo NO impide la
 * ejecución de los demás: el análisis, la autenticación y la consulta de
 * estado/resultados siguen operativos; solo la exportación devuelve un error
 * controlado (no lanza), que la capa API traduce a una respuesta de error.
 */

import type { AnalysisResult } from '../domain/index.js';
import type { ExportError, ExportModule, MarkdownDocument } from './types.js';

/** Crea una instancia del módulo de exportación deshabilitado. */
export function createDisabledExportModule(): ExportModule {
  return {
    async exportMarkdown(_result: AnalysisResult): Promise<MarkdownDocument | ExportError> {
      return {
        kind: 'EXPORT_ERROR',
        reason: 'FALLO_GENERACION',
        message:
          'El módulo de exportación está deshabilitado; la exportación a Markdown no está disponible en esta configuración.',
      };
    },
  };
}
