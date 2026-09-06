/**
 * Implementación de `UserStore` sobre PostgreSQL (tabla `usuario`).
 *
 * Respaldo concreto usado cuando la persistencia SQL está activa (DATABASE_URL).
 * Solo maneja metadatos de autenticación y el hash de la contraseña; NUNCA la
 * contraseña en claro ni código fuente (Requisitos 2.2, 13.x). Todas las
 * consultas son parametrizadas para prevenir inyección de SQL.
 */

import type { Queryable, QueryRow } from '../persistence/db.js';
import type { StoredUser } from '../domain/index.js';
import type { UserStore } from './user-store.js';

interface UserRow extends QueryRow {
  id: string;
  username: string;
  password_hash: string;
  failed_attempts: number | string;
  locked_until: string | Date | null;
}

/** Convierte una fila de `usuario` en `StoredUser`. */
function toStoredUser(row: UserRow): StoredUser {
  const lockedUntil =
    row.locked_until === null
      ? null
      : row.locked_until instanceof Date
        ? row.locked_until.toISOString()
        : new Date(row.locked_until).toISOString();
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    failedAttempts:
      typeof row.failed_attempts === 'string'
        ? Number.parseInt(row.failed_attempts, 10)
        : row.failed_attempts,
    lockedUntil,
  };
}

export class SqlUserStore implements UserStore {
  constructor(private readonly db: Queryable) {}

  async findByUsername(username: string): Promise<StoredUser | null> {
    const result = await this.db.query<UserRow>(
      `SELECT id, username, password_hash, failed_attempts, locked_until
         FROM usuario
        WHERE username = $1`,
      [username],
    );
    const row = result.rows[0];
    return row === undefined ? null : toStoredUser(row);
  }

  async updateLockState(
    userId: string,
    failedAttempts: number,
    lockedUntil: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE usuario
          SET failed_attempts = $2,
              locked_until = $3
        WHERE id = $1`,
      [userId, failedAttempts, lockedUntil],
    );
  }
}
