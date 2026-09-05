/**
 * Abstracción mínima de cliente PostgreSQL para la capa de persistencia.
 *
 * Nota de diseño (decisión abierta): el mecanismo concreto de acceso a la base
 * de datos no se fija aquí. La capa de persistencia depende solo de estas
 * interfaces, de modo que puede respaldarse con el driver real de PostgreSQL en
 * producción o con un doble de prueba en los tests, sin acoplar la lógica del
 * repositorio a una librería concreta.
 *
 * El contrato es deliberadamente pequeño: ejecutar consultas parametrizadas y
 * ejecutar una unidad de trabajo dentro de una transacción con COMMIT/ROLLBACK
 * atómico (necesario para el guardado multi-tabla del `AnalysisResult`).
 */

/** Fila genérica devuelta por una consulta. */
export type QueryRow = Record<string, unknown>;

/** Resultado de una consulta: filas y número de filas afectadas. */
export interface QueryResult<R extends QueryRow = QueryRow> {
  rows: R[];
  rowCount: number;
}

/**
 * Ejecutor de consultas parametrizadas. Lo implementan tanto el cliente de
 * conexión como el contexto transaccional, de modo que el repositorio use la
 * misma API dentro y fuera de una transacción.
 */
export interface Queryable {
  query<R extends QueryRow = QueryRow>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * Cliente de base de datos. Además de ejecutar consultas sueltas, expone
 * `transaction` para agrupar varias operaciones de escritura de forma atómica:
 * si el callback lanza, se revierte todo (ROLLBACK) y no queda ningún cambio
 * parcial (Requisito 2.4).
 */
export interface PgClient extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
