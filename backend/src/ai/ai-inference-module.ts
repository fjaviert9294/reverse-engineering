/**
 * Cliente del Módulo de Inferencia IA detrás de una abstracción de proveedor
 * (Task 10.1).
 *
 * Implementa `isConfigured()` e `infer(input, privacyEnabled)` respetando:
 * - **Privacidad por defecto** (Requisitos 4.1, 4.2): el envío de código está
 *   controlado por el `Parametro_Privacidad`, cuyo valor por defecto es
 *   deshabilitado. Este módulo no envía código salvo activación explícita.
 * - **Abstinencia con privacidad deshabilitada** (Requisito 4.3): si
 *   `privacyEnabled` es `false`, no se envía código y el flujo continúa sin
 *   interrupción; la inferencia se omite.
 * - **Envío con privacidad habilitada + IA** (Requisito 4.4): si `privacyEnabled`
 *   es `true` y el proveedor está configurado, se envía el código al proveedor.
 * - **Proveedor vía variable de entorno** (Requisito 4.5): la configuración del
 *   `Proveedor_IA` se lee de una variable de entorno; el proveedor concreto no se
 *   fija (decisión abierta #1 del diseño).
 * - **Ausencia de proveedor** (Requisito 4.6): si la configuración del proveedor
 *   está ausente o vacía cuando se requiere IA, no se envía código, se omite la
 *   inferencia y se emite un aviso de error.
 *
 * IMPORTANTE (Requisito 2.2): el código que se envía al proveedor es transitorio
 * y solo se transmite cuando la privacidad está habilitada. El resultado de la
 * inferencia contiene resultados/metadatos, nunca código fuente persistible.
 */

import type {
  AIFindings,
  AIInferenceInput,
  AIInferenceModule,
  AIProvider,
  AIUnavailable,
  AIUnavailableReason,
} from './types.js';

/**
 * Nombre de la variable de entorno que configura el `Proveedor_IA` (Requisito
 * 4.5). No fija un proveedor concreto: su sola presencia (no vacía) indica que la
 * IA está configurada. El proveedor concreto se inyecta como `AIProvider`
 * (decisión abierta #1 del diseño).
 */
export const AI_PROVIDER_ENV_VAR = 'AI_PROVIDER';

/** Avisos legibles asociados a cada motivo de indisponibilidad (en español). */
const UNAVAILABLE_NOTICES: Readonly<Record<AIUnavailableReason, string>> = {
  PRIVACIDAD_DESHABILITADA:
    'El parámetro de privacidad está deshabilitado: no se envió código al proveedor de IA y la inferencia por IA se omitió.',
  PROVEEDOR_NO_CONFIGURADO:
    'El proveedor de IA no está configurado: no se envió código y la inferencia por IA no se completó.',
  PROVEEDOR_FALLO:
    'El proveedor de IA no está disponible o falló: el análisis se produjo solo con el análisis estático.',
};

/** Construye un resultado `AIUnavailable` con el aviso correspondiente al motivo. */
function unavailable(reason: AIUnavailableReason): AIUnavailable {
  return { kind: 'AI_UNAVAILABLE', reason, notice: UNAVAILABLE_NOTICES[reason] };
}

/**
 * Opciones de construcción del módulo de inferencia por IA.
 *
 * - `provider`: adaptador del proveedor concreto (decisión abierta #1). Se invoca
 *   solo cuando la privacidad está habilitada y el proveedor está configurado.
 * - `env`: fuente de variables de entorno. Se inyecta para poder probar
 *   `isConfigured()` de forma determinista; por defecto, `process.env`.
 * - `envVarName`: nombre de la variable de entorno que indica el proveedor
 *   configurado; por defecto, `AI_PROVIDER`.
 */
export interface AIInferenceModuleOptions {
  provider: AIProvider;
  env?: NodeJS.ProcessEnv;
  envVarName?: string;
}

/**
 * Implementación del Módulo de Inferencia IA detrás de una abstracción de
 * proveedor. No conoce al proveedor concreto: recibe un `AIProvider` inyectado y
 * decide, según privacidad y configuración, si invocarlo (Requisitos 4.1–4.6).
 */
export class DefaultAIInferenceModule implements AIInferenceModule {
  private readonly provider: AIProvider;
  private readonly env: NodeJS.ProcessEnv;
  private readonly envVarName: string;

  constructor(options: AIInferenceModuleOptions) {
    this.provider = options.provider;
    this.env = options.env ?? process.env;
    this.envVarName = options.envVarName ?? AI_PROVIDER_ENV_VAR;
  }

  /**
   * Comprueba que el `Proveedor_IA` esté configurado leyendo su variable de
   * entorno (Requisitos 4.5, 4.6). Devuelve `true` únicamente si la variable
   * existe y, tras recortar espacios, no está vacía. No fija ni valida un
   * proveedor concreto: solo verifica la presencia de configuración.
   */
  isConfigured(): boolean {
    const value = this.env[this.envVarName];
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * Ejecuta la inferencia respetando privacidad y disponibilidad del proveedor
   * (Requisitos 4.3–4.6, 3.6, 14.5).
   *
   * Orden de decisión:
   * 1. Privacidad deshabilitada -> no se envía código; se omite la inferencia
   *    (Requisito 4.3).
   * 2. Proveedor no configurado -> no se envía código; se omite la inferencia y se
   *    emite aviso de error (Requisitos 4.5, 4.6).
   * 3. Privacidad habilitada + proveedor configurado -> se envía el código al
   *    proveedor (Requisito 4.4). Un fallo del proveedor degrada a solo estático
   *    con aviso (Requisitos 3.6, 14.5).
   *
   * Nunca lanza: los fallos del proveedor se capturan y se devuelven como
   * `AIUnavailable` para permitir la degradación elegante en el orquestador.
   */
  async infer(
    input: AIInferenceInput,
    privacyEnabled: boolean,
  ): Promise<AIFindings | AIUnavailable> {
    // 1) Privacidad deshabilitada: nunca se envía código (Requisito 4.3).
    if (!privacyEnabled) {
      return unavailable('PRIVACIDAD_DESHABILITADA');
    }

    // 2) Proveedor ausente/vacío cuando se requiere IA (Requisitos 4.5, 4.6).
    if (!this.isConfigured()) {
      return unavailable('PROVEEDOR_NO_CONFIGURADO');
    }

    // 3) Privacidad habilitada y proveedor configurado: se envía el código
    //    (Requisito 4.4). Fallo del proveedor -> degradación (Requisitos 3.6, 14.5).
    try {
      return await this.provider.infer(input);
    } catch {
      return unavailable('PROVEEDOR_FALLO');
    }
  }
}
