/**
 * Adaptador de PostgreSQL real que implementa `PgClient` sobre `pg` (node-postgres).
 *
 * Es el respaldo concreto de la decisión abierta de acceso a datos: la capa de
 * persistencia depende solo de `PgClient`/`Queryable`, y este adaptador conecta
 * esas interfaces con un `Pool` de conexiones de `pg`. Se usa únicamente cuando
 * `DATABASE_URL` está definida; en otro caso el sistema cae a los repositorios en
 * memoria (composition root).
 *
 * `transaction` ejecuta el callback dentro de BEGIN/COMMIT y hace ROLLBACK ante
 * cualquier error, garantizando el guardado multi-tabla atómico del resultado
 * (Requisito 2.4).
 */

// `pg` es CommonJS: bajo ESM se importa el default y se desestructura, en lugar
// de usar named imports (que Node rechaza en tiempo de ejecución).
import pg from 'pg';
import type { Pool as PoolType, PoolClient } from 'pg';

const { Pool } = pg;

import type { PgClient, Queryable, QueryResult, QueryRow } from './db.js';

export interface PgClientAdapterOptions {
  connectionString: string;
  /** Máximo de conexiones del pool (1 vCPU / 1 instancia del MVP). */
  max?: number;
}

/** Envuelve un `PoolClient`/`Pool` como `Queryable`. */
function asQueryable(executor: PoolType | PoolClient): Queryable {
  return {
    async query<R extends QueryRow = QueryRow>(
      sql: string,
      params: unknown[] = [],
    ): Promise<QueryResult<R>> {
      const result = await executor.query(sql, params);
      return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
    },
  };
}

export class PgClientAdapter implements PgClient {
  private readonly pool: PoolType;

  constructor(options: PgClientAdapterOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 5,
    });
  }

  async query<R extends QueryRow = QueryRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    return asQueryable(this.pool).query<R>(sql, params);
  }

  /**
   * Ejecuta `fn` dentro de una transacción sobre una conexión dedicada del pool.
   * COMMIT si `fn` resuelve; ROLLBACK si lanza. La conexión se libera siempre.
   */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(asQueryable(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Si el ROLLBACK falla, se propaga el error original de `fn`.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Cierra el pool de conexiones (apagado ordenado). */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
