/**
 * Módulo de Inferencia IA DESHABILITADO (Requisitos 14.1, 14.5).
 *
 * Cuando el módulo de IA está deshabilitado por configuración, se inyecta esta
 * implementación en lugar de `DefaultAIInferenceModule`. Demuestra la modularidad
 * con tolerancia a fallos: con la IA deshabilitada, el pipeline continúa con
 * ingesta, análisis estático y exportación, y el resultado se produce en modo
 * solo estático con un aviso de que la inferencia por IA no se aplicó
 * (Requisitos 14.5, 3.6).
 *
 * `isConfigured()` devuelve `false` (no hay IA en esta configuración) e `infer`
 * devuelve siempre un `AIUnavailable`, que el orquestador integra como aviso sin
 * detener el análisis (degradación elegante).
 */

import type {
  AIFindings,
  AIInferenceInput,
  AIInferenceModule,
  AIUnavailable,
} from './types.js';

/** Aviso mostrado al usuario cuando la IA está deshabilitada por configuración. */
export const AI_DISABLED_NOTICE =
  'La inferencia por IA está deshabilitada en esta configuración: el análisis se produjo solo con el análisis estático.';

/** Crea una instancia del módulo de inferencia IA deshabilitado. */
export function createDisabledAIInferenceModule(): AIInferenceModule {
  return {
    isConfigured(): boolean {
      return false;
    },
    async infer(
      _input: AIInferenceInput,
      _privacyEnabled: boolean,
    ): Promise<AIFindings | AIUnavailable> {
      return {
        kind: 'AI_UNAVAILABLE',
        reason: 'PROVEEDOR_NO_CONFIGURADO',
        notice: AI_DISABLED_NOTICE,
      };
    },
  };
}
