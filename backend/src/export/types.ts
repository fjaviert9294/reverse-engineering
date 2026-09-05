/**
 * Tipos del Módulo de Exportación de Repo-Analyzer (Task 11.1).
 *
 * El Módulo de Exportación genera un documento Markdown válido que incluye todos
 * los elementos del `Resultado_Analisis` (Requisito 11.1) y notifica la
 * finalización dejándolo disponible (Requisito 11.2). Ante un resultado vacío o
 * inexistente se abstiene de generar y devuelve un error (Requisito 11.3); ante
 * un fallo durante la generación informa del error sin alterar el resultado de
 * entrada (Requisito 11.4).
 *
 * DECISIÓN DE CONTRATO: siguiendo el patrón de los demás módulos del dominio
 * (p. ej. el Módulo de Inferencia IA, que devuelve `AIFindings | AIUnavailable`),
 * el resultado de la exportación se modela como una **unión discriminada** por el
 * campo `kind`: `MarkdownDocument` en caso de éxito y `ExportError` en caso de
 * abstención o fallo. Así las capas superiores (API/Interfaz_Web) distinguen sin
 * ambigüedad y sin inspeccionar mensajes de texto.
 *
 * IMPORTANTE (Requisito 2.2): estos tipos solo transportan resultados y
 * metadatos del análisis renderizados a texto Markdown; nunca contienen ni
 * transportan contenido del código fuente del repositorio.
 */

import type { AnalysisResult } from '../domain/index.js';

/**
 * Documento Markdown generado con éxito (Requisitos 11.1, 11.2). Además del
 * contenido, transporta metadatos de disponibilidad para que la capa superior
 * pueda notificar la finalización y ofrecerlo para descarga o almacenamiento.
 */
export interface MarkdownDocument {
  /** Marca discriminante para distinguir de `ExportError`. */
  readonly kind: 'MARKDOWN_DOCUMENT';
  /** Contenido Markdown válido con todos los elementos del resultado (Requisito 11.1). */
  content: string;
  /** Nombre de archivo sugerido para la descarga/almacenamiento (Requisito 11.2). */
  filename: string;
  /** Tipo de contenido del documento generado. */
  mediaType: 'text/markdown';
}

/**
 * Motivo por el que la exportación no produjo un documento.
 *
 * - `RESULTADO_VACIO`: el `Resultado_Analisis` está vacío o no existe cuando se
 *   solicita la exportación; el módulo se abstiene de generar (Requisito 11.3).
 * - `FALLO_GENERACION`: ocurrió un fallo durante la generación del documento; el
 *   módulo informa del error y preserva el resultado sin alterarlo
 *   (Requisito 11.4).
 */
export type ExportErrorReason = 'RESULTADO_VACIO' | 'FALLO_GENERACION';

/**
 * Error de exportación. No es una excepción lanzada: es un valor de retorno que
 * permite a la capa superior informar al usuario (Requisitos 11.3, 11.4) sin
 * interrumpir el flujo. En `FALLO_GENERACION` la entrada nunca se altera.
 */
export interface ExportError {
  /** Marca discriminante para distinguir de `MarkdownDocument`. */
  readonly kind: 'EXPORT_ERROR';
  reason: ExportErrorReason;
  /** Mensaje legible para el usuario; nunca contiene código fuente. */
  message: string;
}

/**
 * Contrato del Módulo de Exportación (sección "Modulo_Exportacion" del diseño).
 */
export interface ExportModule {
  /**
   * Genera el `Resultado_Analisis` como un documento Markdown válido con todos
   * sus elementos (objetivo <= 5 s) y lo deja disponible (Requisitos 11.1, 11.2).
   *
   * - Si el resultado está vacío o no existe, se abstiene y devuelve un
   *   `ExportError` con motivo `RESULTADO_VACIO` (Requisito 11.3).
   * - Si ocurre un fallo durante la generación, devuelve un `ExportError` con
   *   motivo `FALLO_GENERACION` sin alterar el resultado de entrada
   *   (Requisito 11.4).
   */
  exportMarkdown(result: AnalysisResult): Promise<MarkdownDocument | ExportError>;
}
