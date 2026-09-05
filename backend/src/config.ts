/**
 * Configuración del proceso leída del entorno.
 *
 * Nota de diseño: las decisiones abiertas (proveedor de IA, plataforma de nube,
 * mecanismo de cola/almacenamiento transitorio y descarga de GitHub) NO se fijan
 * aquí. Solo se leen valores de arranque genéricos. El proveedor de IA concreto
 * se resuelve vía variable de entorno en el módulo correspondiente (Req 4.5).
 *
 * Además de los parámetros de red, la configuración expone los CONMUTADORES DE
 * MÓDULO (`modules`): cada módulo del monolito puede habilitarse o deshabilitarse
 * de forma independiente. Deshabilitar un módulo no impide la ejecución de los
 * demás (Requisito 14.1). En particular, con la inferencia por IA deshabilitada,
 * el análisis continúa con ingesta, análisis estático y exportación, y el
 * resultado indica que la IA no se aplicó (Requisito 14.5).
 */

/**
 * Conmutadores de habilitación por módulo del monolito modular (Requisito 14.1).
 * `true` = módulo habilitado; `false` = deshabilitado (sin impedir a los demás).
 */
export interface ModulesConfig {
  /** Módulo de Ingesta (extracción de ZIP y descarga desde GitHub). */
  ingestion: boolean;
  /** Módulo de Análisis Estático (fuente siempre disponible del análisis). */
  staticAnalysis: boolean;
  /**
   * Módulo de Inferencia IA (opcional). Deshabilitado -> el análisis continúa en
   * modo solo estático con aviso de que la IA no se aplicó (Requisitos 14.5, 3.6).
   */
  aiInference: boolean;
  /** Módulo de Exportación a Markdown. */
  export: boolean;
}

export interface AppConfig {
  port: number;
  host: string;
  /** Conmutadores de habilitación por módulo (Requisito 14.1). */
  modules: ModulesConfig;
}

/**
 * Interpreta una variable de entorno booleana. Se considera deshabilitado solo
 * cuando el valor es explícitamente "false"/"0"/"no"/"off" (sin distinción de
 * mayúsculas); cualquier otro valor, o su ausencia, se interpreta como habilitado
 * (los módulos están habilitados por defecto).
 */
function parseBooleanFlag(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  return defaultValue;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? '3000', 10);
  const host = env.HOST ?? '0.0.0.0';
  return {
    port: Number.isNaN(port) ? 3000 : port,
    host,
    modules: {
      ingestion: parseBooleanFlag(env.MODULE_INGESTION_ENABLED),
      staticAnalysis: parseBooleanFlag(env.MODULE_STATIC_ANALYSIS_ENABLED),
      aiInference: parseBooleanFlag(env.MODULE_AI_ENABLED),
      export: parseBooleanFlag(env.MODULE_EXPORT_ENABLED),
    },
  };
}
