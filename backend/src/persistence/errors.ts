/**
 * Errores de la capa de persistencia.
 *
 * Se modelan como clases de error dedicadas para que las capas superiores
 * (API/orquestador) puedan distinguir sin ambigüedad entre "no se pudo
 * persistir" (Requisito 2.4) y "no encontrado" (Requisito 2.5), sin inspeccionar
 * mensajes de texto.
 */

/**
 * La operación de persistencia no se completó. Ante este error, los datos
 * previamente almacenados se conservan sin cambios gracias al ROLLBACK de la
 * transacción (Requisito 2.4). `cause` conserva el error subyacente para
 * diagnóstico, sin exponerlo como parte del contrato al usuario.
 */
export class PersistenceError extends Error {
  override readonly cause?: unknown;

  constructor(message = 'La persistencia del resultado no se completó.', cause?: unknown) {
    super(message);
    this.name = 'PersistenceError';
    this.cause = cause;
  }
}

/**
 * El `Resultado_Analisis` solicitado no existe para el identificador dado
 * (Requisito 2.5). Se usa cuando la capa de servicio prefiere una excepción en
 * lugar del `null` que devuelve `findById`.
 */
export class ResultNotFoundError extends Error {
  readonly resultId: string;

  constructor(resultId: string) {
    super(`No se encontró el resultado de análisis con identificador "${resultId}".`);
    this.name = 'ResultNotFoundError';
    this.resultId = resultId;
  }
}
