/**
 * Tipos del Módulo de Inferencia IA (opcional) de Repo-Analyzer (Task 10.1).
 *
 * El Módulo de Inferencia IA, cuando el uso de IA está habilitado y el
 * `Parametro_Privacidad` lo permite, enriquece el `AnalysisResult` con
 * inferencias de un proveedor externo (explicación funcional, categorías de
 * componentes, arquitectura). Esta tarea (10.1) implementa el cliente de IA
 * detrás de una **abstracción de proveedor**: `isConfigured()` y
 * `infer(input, privacyEnabled)`, respetando la privacidad por defecto y la
 * degradación elegante.
 *
 * DECISIÓN ABIERTA (diseño, "Decisiones abiertas" #1): el proveedor de IA
 * concreto NO se fija. La configuración del `Proveedor_IA` se obtiene de una
 * variable de entorno (Requisito 4.5) y el proveedor concreto se inyecta detrás
 * de la interfaz `AIProvider`. Este módulo fija el *comportamiento* (privacidad,
 * ausencia de proveedor, forma del resultado), no la tecnología concreta.
 *
 * IMPORTANTE (Requisito 2.2): el resultado de la inferencia (`AIFindings`) solo
 * transporta resultados y metadatos (resumen, categorías, arquitectura), nunca
 * se persiste código fuente. El código fuente que se envía al proveedor
 * (`AIInferenceInput.code`) es transitorio y solo se transmite cuando el
 * `Parametro_Privacidad` está habilitado (Requisitos 4.3, 4.4).
 */

import type {
  ArchitectureInference,
  ComponentCategory,
  FunctionalSummary,
} from '../domain/index.js';

// ---------------------------------------------------------------------------
// Entrada de la inferencia
// ---------------------------------------------------------------------------

/**
 * Fragmento de código fuente candidato a enviarse al proveedor de IA. Es
 * transitorio: solo se transmite cuando el `Parametro_Privacidad` está
 * habilitado (Requisitos 4.3, 4.4). No se persiste (Requisito 2.2).
 */
export interface AICodeFile {
  /** Ruta relativa del archivo dentro del repositorio extraído. */
  path: string;
  /** Contenido de texto del archivo. Transitorio; nunca se persiste. */
  content: string;
}

/**
 * Entrada de la inferencia por IA. Combina metadatos ya derivados del análisis
 * estático (perfil de lenguajes, rutas) con el código fuente candidato a enviar.
 *
 * El campo `code` solo se remite al proveedor cuando el `Parametro_Privacidad`
 * está habilitado; en caso contrario, el módulo se abstiene de enviarlo
 * (Requisito 4.3).
 */
export interface AIInferenceInput {
  /** Job propietario del análisis (metadato de identidad). */
  jobId: string;
  /** Lenguaje principal detectado por el análisis estático, si lo hay. */
  primaryLanguage?: string | null;
  /**
   * Código fuente candidato a enviar al proveedor. Se transmite únicamente si el
   * `Parametro_Privacidad` está habilitado (Requisitos 4.3, 4.4).
   */
  code: AICodeFile[];
}

// ---------------------------------------------------------------------------
// Salida de la inferencia
// ---------------------------------------------------------------------------

/**
 * Categoría de un componente inferida por IA. Complementa la clasificación
 * heurística del análisis estático (nunca la elimina; solo añade o refina, ver
 * Property 6). `path` no vacío y `category` del conjunto del dominio.
 */
export interface AIComponentCategory {
  path: string;
  category: ComponentCategory;
  confidence?: number;
}

/**
 * Hallazgos producidos por la inferencia por IA. Todos los campos son opcionales:
 * el proveedor puede refinar el resumen funcional, aportar categorías de
 * componentes y/o afinar la inferencia de arquitectura. La integración de estos
 * hallazgos en el `AnalysisResult` (superconjunto del estático) es
 * responsabilidad de la Task 10.2.
 */
export interface AIFindings {
  /** Marca discriminante para distinguir de `AIUnavailable`. */
  readonly kind: 'AI_FINDINGS';
  functionalSummary?: FunctionalSummary;
  componentCategories?: AIComponentCategory[];
  architecture?: ArchitectureInference;
}

/**
 * Motivo por el que la inferencia por IA no está disponible o no se aplicó.
 *
 * - `PRIVACIDAD_DESHABILITADA`: el `Parametro_Privacidad` está deshabilitado, por
 *   lo que no se envía código y la inferencia se omite sin interrumpir el flujo
 *   (Requisito 4.3).
 * - `PROVEEDOR_NO_CONFIGURADO`: la configuración del `Proveedor_IA` está ausente o
 *   vacía; no se envía código, se omite la inferencia y se emite un aviso de
 *   error (Requisitos 4.5, 4.6).
 * - `PROVEEDOR_FALLO`: el proveedor estaba configurado pero la inferencia falló;
 *   se degrada a solo estático con aviso (Requisitos 3.6, 14.5).
 */
export type AIUnavailableReason =
  | 'PRIVACIDAD_DESHABILITADA'
  | 'PROVEEDOR_NO_CONFIGURADO'
  | 'PROVEEDOR_FALLO';

/**
 * Resultado de una inferencia que no se completó. No es un error lanzado: es un
 * valor de retorno que permite al orquestador degradar con elegancia a modo solo
 * estático y adjuntar el aviso correspondiente (Requisitos 3.6, 4.6, 14.5).
 */
export interface AIUnavailable {
  /** Marca discriminante para distinguir de `AIFindings`. */
  readonly kind: 'AI_UNAVAILABLE';
  reason: AIUnavailableReason;
  /** Aviso legible para el usuario; se propaga a `AnalysisResult.notices`. */
  notice: string;
}

// ---------------------------------------------------------------------------
// Abstracción del proveedor (decisión abierta: la tecnología no se fija)
// ---------------------------------------------------------------------------

/**
 * Puerto del proveedor de IA concreto. La tecnología (proveedor de LLM, endpoint,
 * modelo) es una decisión abierta del diseño; este puerto solo se compromete a
 * recibir la entrada de inferencia y devolver hallazgos.
 *
 * El proveedor recibe la entrada ya filtrada por privacidad: cuando el
 * `Parametro_Privacidad` está deshabilitado, el módulo NO invoca al proveedor con
 * código (Requisito 4.3). El proveedor puede lanzar/rechazar ante un fallo; el
 * módulo lo captura y degrada a `AIUnavailable` (Requisitos 3.6, 14.5).
 */
export interface AIProvider {
  infer(input: AIInferenceInput): Promise<AIFindings>;
}

/**
 * Contrato del Módulo de Inferencia IA (sección "Modulo_Inferencia_IA" del
 * diseño). Desacoplado del proveedor concreto (decisión abierta #1).
 */
export interface AIInferenceModule {
  /**
   * Indica si el `Proveedor_IA` está configurado, leyendo su configuración desde
   * una variable de entorno (Requisitos 4.5, 4.6). No fija un proveedor concreto:
   * solo comprueba que la variable de entorno correspondiente esté presente y no
   * vacía.
   */
  isConfigured(): boolean;

  /**
   * Ejecuta la inferencia por IA respetando la privacidad y la disponibilidad del
   * proveedor:
   *
   * - Si `privacyEnabled` es `false`, no se envía código y se omite la inferencia
   *   (Requisito 4.3) -> `AIUnavailable` con motivo `PRIVACIDAD_DESHABILITADA`.
   * - Si el proveedor no está configurado, no se envía código, se omite la
   *   inferencia y se emite un aviso de error (Requisitos 4.5, 4.6) ->
   *   `AIUnavailable` con motivo `PROVEEDOR_NO_CONFIGURADO`.
   * - Si el proveedor está configurado y la privacidad habilitada, se envía el
   *   código al proveedor (Requisito 4.4). Si el proveedor falla, se degrada con
   *   aviso (Requisitos 3.6, 14.5) -> `AIUnavailable` con motivo `PROVEEDOR_FALLO`.
   */
  infer(input: AIInferenceInput, privacyEnabled: boolean): Promise<AIFindings | AIUnavailable>;
}
