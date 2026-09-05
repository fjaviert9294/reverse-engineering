/**
 * `PreferenceRepository` (Task 3.4) — conserva la preferencia de uso de IA por
 * usuario.
 *
 * Requisito 3.3: cuando el usuario activa o desactiva el uso de IA, el sistema
 * registra y conserva dicha preferencia y la aplica en los análisis posteriores
 * hasta que el usuario la modifique.
 *
 * Privacidad por defecto (Requisitos 4.1, 4.2): cuando un usuario no tiene una
 * preferencia registrada, el uso de IA se considera DESHABILITADO (`false`).
 * Esto es consistente con `PREFERENCIA.use_ai boolean NOT NULL DEFAULT false`
 * del esquema (0002_schema.sql).
 *
 * La persistencia solo guarda metadatos/preferencias; nunca código fuente
 * (Requisito 2.2).
 */

import type { Queryable } from './db.js';

/**
 * Contrato de la persistencia de preferencias de uso de IA (sección
 * "Capa de Persistencia" del diseño).
 */
export interface PreferenceRepository {
  /**
   * Registra/actualiza (upsert) la preferencia de uso de IA de un usuario para
   * que persista entre análisis (Requisito 3.3).
   */
  setUseAI(userId: string, useAI: boolean): Promise<void>;

  /**
   * Devuelve la preferencia de uso de IA almacenada del usuario. Si el usuario
   * no tiene ninguna preferencia registrada, devuelve `false` (privacidad por
   * defecto, Requisitos 4.1, 4.2).
   */
  getUseAI(userId: string): Promise<boolean>;
}

/**
 * Implementación de `PreferenceRepository` sobre PostgreSQL usando un `Queryable`
 * inyectado (abstracción de acceso a datos de la capa de persistencia). Todas las
 * consultas son parametrizadas (marcadores `$1, $2`) para prevenir inyección de
 * SQL.
 */
export class SqlPreferenceRepository implements PreferenceRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Upsert de la preferencia sobre la tabla `preferencia` (clave primaria
   * `user_id`). Si la fila ya existe, actualiza `use_ai`; si no, la crea. Así la
   * preferencia se conserva y se sobreescribe solo cuando el usuario la modifica
   * (Requisito 3.3).
   */
  async setUseAI(userId: string, useAI: boolean): Promise<void> {
    await this.db.query(
      `INSERT INTO preferencia (user_id, use_ai)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET use_ai = EXCLUDED.use_ai`,
      [userId, useAI],
    );
  }

  /**
   * Recupera `use_ai` del usuario. Ante la ausencia de fila, aplica el valor por
   * defecto `false` (privacidad por defecto, Requisitos 4.1, 4.2).
   */
  async getUseAI(userId: string): Promise<boolean> {
    const result = await this.db.query<{ use_ai: boolean }>(
      `SELECT use_ai FROM preferencia WHERE user_id = $1`,
      [userId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return false;
    }
    return row.use_ai === true;
  }
}
