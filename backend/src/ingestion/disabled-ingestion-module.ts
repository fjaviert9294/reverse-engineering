/**
 * Módulo de Ingesta DESHABILITADO (Requisito 14.1).
 *
 * Cuando el módulo de ingesta está deshabilitado por configuración, se inyecta
 * esta implementación en lugar del `TransientIngestionModule`. Su propósito es
 * demostrar que deshabilitar un módulo NO impide la ejecución de los demás: la
 * API, la autenticación, la consulta de estado/resultados y la exportación
 * siguen operativas; únicamente los análisis que requieren ingesta fallan de
 * forma acotada a este módulo (Requisito 14.6).
 *
 * Todas las operaciones de ingesta devuelven un `IngestionError` que indica que
 * el módulo está deshabilitado; `discard` es una operación inocua (no hay nada
 * que descartar porque no se extrajo contenido).
 */

import {
  IngestionError,
  type ExtractedRepo,
  type IngestionModule,
  type UploadedZip,
} from './types.js';

/** Mensaje único para las operaciones del módulo de ingesta deshabilitado. */
const DISABLED_MESSAGE =
  'El módulo de ingesta está deshabilitado; no es posible extraer ni descargar código en esta configuración.';

/** Crea una instancia del módulo de ingesta deshabilitado. */
export function createDisabledIngestionModule(): IngestionModule {
  return {
    async extract(_zip: UploadedZip): Promise<IngestionError> {
      return new IngestionError('ZIP_INVALIDO', DISABLED_MESSAGE);
    },
    async fetchFromGitHub(_url: string): Promise<IngestionError> {
      return new IngestionError('FALLO_DESCARGA', DISABLED_MESSAGE);
    },
    async discard(_repo: ExtractedRepo): Promise<void> {
      // No hay contenido extraído que descartar cuando la ingesta está off.
    },
  };
}
