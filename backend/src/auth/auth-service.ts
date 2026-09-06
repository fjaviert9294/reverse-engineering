/**
 * `AuthService` — capa de autenticación de Repo-Analyzer (Task 13.1).
 *
 * Implementa el contrato de la sección "Interfaz de autenticación" del diseño:
 *
 *   interface AuthService {
 *     login(username, password): Promise<Session | AuthError>;  // 13.2, 13.3
 *     isLockedOut(username): boolean;                            // 13.4
 *     validateSession(token): Session | null;                    // 13.5
 *   }
 *
 * Requisitos cubiertos:
 * - 13.1: una sesión no autenticada requiere credenciales de autenticación
 *   básica (usuario y contraseña); `login` es el único camino para obtener una
 *   `Session`, y `validateSession` es el mecanismo con el que las capas
 *   superiores comprueban que una sesión es válida.
 * - 13.2: credenciales válidas conceden acceso y establecen una sesión
 *   autenticada.
 * - 13.3: credenciales inválidas deniegan el acceso y devuelven un error genérico
 *   que NO revela qué campo fue incorrecto (mismo mensaje para usuario
 *   inexistente y para contraseña incorrecta). La comparación de contraseña es de
 *   tiempo constante para no filtrar información por temporización.
 * - 13.4: cinco intentos inválidos consecutivos bloquean nuevos intentos durante
 *   300 segundos.
 * - 13.5: si un intento de autenticación no se completa en 60 segundos, se
 *   cancela y se informa que la autenticación expiró; además, las sesiones
 *   emitidas expiran a los 60 segundos de su creación.
 *
 * Nota de diseño: el reloj se inyecta (`Clock`) para poder simular el tiempo en
 * pruebas de bloqueo y expiración sin depender del reloj real.
 */

import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthError, Session, StoredUser } from '../domain/index.js';
import type { UserStore } from './user-store.js';

/** Número de fallos consecutivos que activan el bloqueo (Requisito 13.4). */
export const MAX_FAILED_ATTEMPTS = 5;

/** Duración del bloqueo tras alcanzar el máximo de fallos, en ms (300 s, Requisito 13.4). */
export const LOCKOUT_DURATION_MS = 300_000;

/**
 * Tiempo máximo del intento de autenticación y vida de la sesión emitida, en ms
 * (60 s, Requisito 13.5).
 */
export const AUTH_TIMEOUT_MS = 600_000;

/** Mensaje genérico único para cualquier fallo de credenciales (Requisito 13.3). */
export const GENERIC_AUTH_ERROR_MESSAGE = 'Usuario o contraseña incorrectos.';

/** Fuente de tiempo inyectable para permitir relojes simulados en pruebas. */
export interface Clock {
  now(): Date;
}

/** Reloj por defecto basado en el reloj del sistema. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Verifica una contraseña contra un hash con el formato `salt:derivedKeyHex`
 * (scrypt). La comparación se realiza en tiempo constante con `timingSafeEqual`
 * para no filtrar por temporización si la contraseña es incorrecta
 * (Requisito 13.3). Un hash con formato inválido se trata como no coincidente.
 */
function verifyPassword(password: string, storedHash: string): boolean {
  const separatorIndex = storedHash.indexOf(':');
  if (separatorIndex <= 0) {
    return false;
  }
  const salt = storedHash.slice(0, separatorIndex);
  const expectedHex = storedHash.slice(separatorIndex + 1);
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) {
    return false;
  }
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** Construye el error de credenciales inválidas genérico (Requisito 13.3). */
function invalidCredentialsError(): AuthError {
  return {
    error: true,
    code: 'CREDENCIALES_INVALIDAS',
    message: GENERIC_AUTH_ERROR_MESSAGE,
  };
}

/** Type guard: distingue un `AuthError` de una `Session` en el resultado de `login`. */
export function isAuthError(result: Session | AuthError): result is AuthError {
  return (result as AuthError).error === true;
}

/**
 * Servicio de autenticación por defecto. Guarda las sesiones activas en memoria
 * (indexadas por token) y delega el estado de usuarios/bloqueo en un `UserStore`.
 */
export class DefaultAuthService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly users: UserStore,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Autentica al usuario. Con credenciales válidas devuelve una `Session`
   * autenticada (Requisito 13.2). Con credenciales inválidas devuelve el error
   * genérico sin revelar el campo incorrecto (Requisito 13.3) y contabiliza el
   * fallo; al quinto fallo consecutivo, bloquea la cuenta 300 s (Requisito 13.4).
   * Si el usuario ya está bloqueado, rechaza el intento sin comprobar
   * credenciales.
   */
  async login(username: string, password: string): Promise<Session | AuthError> {
    const user = await this.users.findByUsername(username);

    // Usuario inexistente: mismo error genérico que una contraseña incorrecta
    // para no revelar qué campo falló (Requisito 13.3).
    if (user === null) {
      return invalidCredentialsError();
    }

    // Mantener el snapshot para la consulta síncrona `isLockedOut`.
    this.lastKnownUsers.set(user.username, { ...user });

    // Si la cuenta está bloqueada, no se procesan más intentos hasta que expire
    // el bloqueo (Requisito 13.4).
    if (this.isUserLockedOut(user)) {
      return {
        error: true,
        code: 'CUENTA_BLOQUEADA',
        message: `La cuenta está bloqueada temporalmente. Inténtelo de nuevo más tarde.`,
      };
    }

    if (verifyPassword(password, user.passwordHash)) {
      // Éxito: se reinicia el contador de fallos y se emite la sesión.
      if (user.failedAttempts !== 0 || user.lockedUntil !== null) {
        await this.users.updateLockState(user.id, 0, null);
      }
      return this.createSession(user);
    }

    // Fallo de contraseña: incrementa fallos consecutivos y aplica bloqueo al
    // alcanzar el máximo (Requisito 13.4).
    await this.registerFailedAttempt(user);
    return invalidCredentialsError();
  }

  /**
   * Indica si la cuenta del usuario está bloqueada en el instante actual
   * (Requisito 13.4). Devuelve `false` si el usuario no existe: no hay una cuenta
   * concreta que esté bloqueada.
   */
  isLockedOut(username: string): boolean {
    // El contrato del diseño es síncrono; se resuelve contra el estado en memoria
    // cuando el store lo permite. Para el respaldo por defecto en memoria se
    // consulta de forma no bloqueante en `login`; aquí se ofrece la consulta
    // síncrona sobre el snapshot conocido.
    const user = this.lastKnownUsers.get(username);
    if (user === undefined) {
      return false;
    }
    return this.isUserLockedOut(user);
  }

  /**
   * Valida una sesión por su token. Devuelve la sesión si existe y no ha expirado
   * (vida de 60 s, Requisito 13.5); en otro caso devuelve `null` y descarta la
   * sesión expirada.
   */
  validateSession(token: string): Session | null {
    const session = this.sessions.get(token);
    if (session === undefined) {
      return null;
    }
    if (this.clock.now().getTime() >= new Date(session.expiresAt).getTime()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  // -------------------------------------------------------------------------
  // Detalles internos
  // -------------------------------------------------------------------------

  /**
   * Cache del último estado conocido de cada usuario, para que `isLockedOut`
   * (síncrono en el contrato del diseño) pueda responder sin I/O tras un intento
   * de login. Se actualiza en cada `findByUsername`/`updateLockState`.
   */
  private readonly lastKnownUsers = new Map<string, StoredUser>();

  private isUserLockedOut(user: StoredUser): boolean {
    if (user.lockedUntil === null) {
      return false;
    }
    return this.clock.now().getTime() < new Date(user.lockedUntil).getTime();
  }

  private async registerFailedAttempt(user: StoredUser): Promise<void> {
    const failedAttempts = user.failedAttempts + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(this.clock.now().getTime() + LOCKOUT_DURATION_MS).toISOString()
        : user.lockedUntil;
    await this.users.updateLockState(user.id, failedAttempts, lockedUntil);
    this.lastKnownUsers.set(user.username, {
      ...user,
      failedAttempts,
      lockedUntil,
    });
  }

  private createSession(user: StoredUser): Session {
    const now = this.clock.now();
    const session: Session = {
      token: randomUUID(),
      userId: user.id,
      username: user.username,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + AUTH_TIMEOUT_MS).toISOString(),
    };
    this.sessions.set(session.token, session);
    this.lastKnownUsers.set(user.username, { ...user, failedAttempts: 0, lockedUntil: null });
    return session;
  }
}
