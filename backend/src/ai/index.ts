/**
 * Punto de entrada del Módulo de Inferencia IA (opcional) de Repo-Analyzer.
 *
 * Reexporta el contrato (`AIInferenceModule`), los tipos de entrada/salida y la
 * abstracción de proveedor (`AIProvider`), junto con la implementación por
 * defecto detrás de la abstracción de proveedor (Task 10.1), para que el resto de
 * capas (orquestador, integración del resultado) los consuman sin acoplarse a las
 * rutas internas ni a un proveedor concreto.
 */
export type {
  AICodeFile,
  AIInferenceInput,
  AIComponentCategory,
  AIFindings,
  AIUnavailable,
  AIUnavailableReason,
  AIProvider,
  AIInferenceModule,
} from './types.js';
export {
  DefaultAIInferenceModule,
  AI_PROVIDER_ENV_VAR,
  type AIInferenceModuleOptions,
} from './ai-inference-module.js';
export {
  integrateAIFindings,
  type AIInferenceOutcome,
} from './ai-result-integration.js';
export {
  createDisabledAIInferenceModule,
  AI_DISABLED_NOTICE,
} from './disabled-ai-module.js';
export {
  GroqProvider,
  createGroqProviderFromEnv,
  GROQ_API_KEY_ENV_VAR,
  GROQ_DEFAULT_MODEL,
  type GroqProviderOptions,
} from './groq-provider.js';
