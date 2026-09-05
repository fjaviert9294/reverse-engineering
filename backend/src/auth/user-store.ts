/**
 * Almacenamiento de usuarios para la capa de autenticación (Task 13.1).
 *
 * Define el contrato de acceso a los usuarios (`UserStore`) y una implementación
 * en memoria por defecto (`InMemoryUserStore`). Corresponde a la tabla `USUARIO`
 * del modelo de datos (id, username, password_hash, failed_attempts,
 * locked_until) y solo guarda metadatos de autenticación: nunca contraseñas en
 * claro ni código fuente (Requisitos 2.2, 13.x).
 *
 * Nota de diseño: `AuthService` depende únicamente de esta interfaz, de modo que
 * el respaldo concreto (PostgreSQL en producción, memoria en pruebas) puede
 * variar sin acoplar la lógica de autenticación a una tecnología concreta.
 */

import type { StoredUser } from '../domain/index.js';

/**
 * Contrato de persistencia de usuarios usado por `AuthService`. Todas las
 * operaciones son asíncronas para admitir un respaldo real (PostgreSQL) detrás de
 * la misma interfaz.
 */
export interface UserStore {
  /** Recupera un usuario por su nombre, o `null` si no existe. */
  findByUsername(username: string): Promise<StoredUser | null>;

  /**
   * Actualiza el contador de fallos consecutivos y el instante de bloqueo de un
   * usuario (Requisito 13.4). `lockedUntil` en `null` significa "sin bloqueo".
   */
  updateLockState(
    userId: string,
    failedAttempts: number,
    lockedUntil: string | null,
  ): Promise<void>;
}

/**
 * Implementación en memoria de `UserStore`. Útil como respaldo por defecto y en
 * pruebas: mantiene los usuarios en un `Map` indexado por nombre de usuario.
 *
 * Se almacena una copia de cada usuario para evitar mutaciones externas
 * accidentales del estado interno.
 */
export class InMemoryUserStore implements UserStore {
  private readonly byUsername = new Map<string, StoredUser>();

  constructor(users: readonly StoredUser[] = []) {
    for (const user of users) {
      this.byUsername.set(user.username, { ...user });
    }
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    const user = this.byUsername.get(username);
    return user === undefined ? null : { ...user };
  }

  async updateLockState(
    userId: string,
    failedAttempts: number,
    lockedUntil: string | null,
  ): Promise<void> {
    for (const [key, user] of this.byUsername) {
      if (user.id === userId) {
        this.byUsername.set(key, { ...user, failedAttempts, lockedUntil });
        return;
      }
    }
  }
}
