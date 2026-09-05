/**
 * Integración de la Inferencia IA en el `AnalysisResult` + degradación elegante
 * (Task 10.2).
 *
 * Esta etapa toma el `AnalysisResult` producido por el Módulo de Análisis
 * Estático (siempre disponible, `analysisMode = "SOLO_ESTATICO"`, ver Task 8.18)
 * y el resultado de `AIInferenceModule.infer(...)` (Task 10.1), y produce el
 * `AnalysisResult` final:
 *
 * - **IA aplicada con éxito** (`AIFindings`): el resultado es un **superconjunto**
 *   del estático. La IA solo **añade o refina**, nunca elimina hallazgos
 *   estáticos, y se fija `analysisMode = "ESTATICO_MAS_IA"` (Requisitos 3.2, 3.5,
 *   14.4; Property 6, Property 8).
 * - **IA no disponible / falla / no permitida** (`AIUnavailable`): el resultado se
 *   mantiene en `analysisMode = "SOLO_ESTATICO"` y se añade a `notices` un aviso
 *   de que la inferencia por IA no se completó (Requisitos 3.4, 3.6, 14.5;
 *   Property 8, Property 9).
 *
 * Reglas de superconjunto (la IA nunca elimina información estática):
 * - `keyComponents`: se **unen**. Se preservan todos los componentes estáticos;
 *   los componentes que aporta la IA para rutas aún no presentes se **añaden**.
 * - `functionalSummary`: la IA solo **refina** cuando el análisis estático no lo
 *   determinó (`determined === false`). Si el estático ya lo determinó, se
 *   conserva; así nunca se degrada un resultado ya determinado.
 * - `architecture`: mismo criterio que el resumen funcional (solo se refina
 *   cuando el estático no la determinó).
 * - `additionalFindings`, `configReadNotes`, `primaryLanguage`,
 *   `secondaryLanguages`: no los aporta la IA; se preservan intactos del estático.
 * - `notices`: se preservan y, en degradación, se **añade** el aviso de la IA.
 *
 * IMPORTANTE (Requisito 2.2): esta función es pura y solo compone resultados y
 * metadatos ya producidos (resúmenes, categorías, arquitectura, avisos). No lee
 * ni transporta contenido del código fuente.
 */

import type { AnalysisResult, KeyComponent } from '../domain/index.js';
import type { AIComponentCategory, AIFindings, AIUnavailable } from './types.js';

/** Resultado que devuelve `AIInferenceModule.infer(...)` (Task 10.1). */
export type AIInferenceOutcome = AIFindings | AIUnavailable;

/**
 * Integra el resultado de la inferencia por IA en el `AnalysisResult` estático,
 * aplicando degradación elegante cuando la IA no se aplicó (Task 10.2).
 *
 * @param staticResult Resultado del análisis estático (base siempre disponible;
 *   `analysisMode = "SOLO_ESTATICO"`).
 * @param outcome Resultado de la inferencia por IA: `AIFindings` cuando se aplicó
 *   con éxito, o `AIUnavailable` cuando no estaba disponible, falló o no estaba
 *   permitida.
 * @returns Un nuevo `AnalysisResult` (no muta el de entrada):
 *   - superconjunto del estático con `analysisMode = "ESTATICO_MAS_IA"` cuando la
 *     IA se aplicó;
 *   - copia en `SOLO_ESTATICO` con el aviso de degradación añadido a `notices`
 *     cuando la IA no se aplicó.
 */
export function integrateAIFindings(
  staticResult: AnalysisResult,
  outcome: AIInferenceOutcome,
): AnalysisResult {
  if (outcome.kind === 'AI_UNAVAILABLE') {
    return degradeToStaticOnly(staticResult, outcome);
  }
  return enrichWithAI(staticResult, outcome);
}

/**
 * Degradación elegante: mantiene el resultado en `SOLO_ESTATICO` y añade a
 * `notices` el aviso de que la inferencia por IA no se completó (Requisitos 3.4,
 * 3.6, 14.5; Property 9). No modifica ningún hallazgo estático.
 */
function degradeToStaticOnly(
  staticResult: AnalysisResult,
  unavailable: AIUnavailable,
): AnalysisResult {
  return {
    ...staticResult,
    analysisMode: 'SOLO_ESTATICO',
    notices: appendNotice(staticResult.notices, unavailable.notice),
  };
}

/**
 * Enriquecimiento por IA: produce un superconjunto del resultado estático y fija
 * `analysisMode = "ESTATICO_MAS_IA"` (Requisitos 3.2, 3.5, 14.4; Property 6,
 * Property 8). La IA solo añade o refina; nunca elimina hallazgos estáticos.
 */
function enrichWithAI(staticResult: AnalysisResult, findings: AIFindings): AnalysisResult {
  return {
    ...staticResult,
    analysisMode: 'ESTATICO_MAS_IA',
    functionalSummary: refineFunctionalSummary(staticResult, findings),
    keyComponents: mergeComponents(staticResult.keyComponents, findings.componentCategories),
    architecture: refineArchitecture(staticResult, findings),
  };
}

/**
 * Refina el resumen funcional: la IA solo lo aporta cuando el análisis estático
 * no lo determinó. Si el estático ya lo determinó, se conserva (nunca se degrada
 * información ya determinada; el resultado sigue siendo un superconjunto).
 */
function refineFunctionalSummary(
  staticResult: AnalysisResult,
  findings: AIFindings,
): AnalysisResult['functionalSummary'] {
  if (!staticResult.functionalSummary.determined && findings.functionalSummary) {
    return findings.functionalSummary;
  }
  return staticResult.functionalSummary;
}

/**
 * Refina la inferencia de arquitectura: la IA solo la aporta cuando el análisis
 * estático no la determinó. Si el estático ya la determinó, se conserva.
 */
function refineArchitecture(
  staticResult: AnalysisResult,
  findings: AIFindings,
): AnalysisResult['architecture'] {
  if (!staticResult.architecture.determined && findings.architecture) {
    return findings.architecture;
  }
  return staticResult.architecture;
}

/**
 * Une los componentes clave del análisis estático con los aportados por la IA:
 * conserva **todos** los componentes estáticos (en su orden y forma originales) y
 * **añade** los de la IA cuyas rutas aún no están presentes. Esto garantiza que
 * el conjunto resultante es un superconjunto del estático (Property 6).
 *
 * La coincidencia se hace por `path` (una ruta ya presente por el estático no se
 * sobrescribe con la categoría inferida por IA, para no eliminar el hallazgo
 * estático). Los componentes de IA se marcan como `inferred: true`.
 */
function mergeComponents(
  staticComponents: readonly KeyComponent[],
  aiComponents: readonly AIComponentCategory[] | undefined,
): KeyComponent[] {
  const merged: KeyComponent[] = [...staticComponents];

  if (!aiComponents || aiComponents.length === 0) {
    return merged;
  }

  const seenPaths = new Set(staticComponents.map((component) => component.path));

  for (const aiComponent of aiComponents) {
    if (seenPaths.has(aiComponent.path)) {
      continue;
    }
    seenPaths.add(aiComponent.path);
    const component: KeyComponent = {
      path: aiComponent.path,
      category: aiComponent.category,
      inferred: true,
    };
    if (typeof aiComponent.confidence === 'number') {
      component.confidence = aiComponent.confidence;
    }
    merged.push(component);
  }

  return merged;
}

/**
 * Añade un aviso a la lista de `notices` sin duplicados ni cadenas vacías,
 * preservando los avisos previos y su orden (los avisos de degradación de IA se
 * agregan al final).
 */
function appendNotice(notices: readonly string[], notice: string | undefined): string[] {
  const result = [...notices];
  if (typeof notice !== 'string') {
    return result;
  }
  const trimmed = notice.trim();
  if (trimmed.length === 0 || result.includes(trimmed)) {
    return result;
  }
  result.push(trimmed);
  return result;
}
