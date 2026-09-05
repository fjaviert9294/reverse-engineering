/**
 * Middleware de autenticación de la capa API/Auth (Task 15.1).
 *
 * Requisito 13.1: mientras la sesión del usuario no está autenticada, el sistema
 * exige credenciales para acceder a la interfaz. Traducido a la API HTTP: las
 * rutas protegidas requieren una sesión válida y, sin ella, se deniega el acceso
 * con `401`.
 *
 * El middleware extrae el token de sesión de la cabecera `Authorization` en el
 * esquema `Bearer <token>` y lo valida con `AuthService.validateSession`, que
 * aplica la expiración de sesión (60 s, Requisito 13.5). Si el token está
 * ausente, mal formado o corresponde a una sesión inexistente/expirada, la
 * autenticación falla.
 *
 * Depende únicamente de la abstracción `SessionValidator`, de modo que el
 * respaldo concreto (`DefaultAuthService`) puede sustituirse en pruebas sin
 * acoplar el middleware a una implementación.
 */

import type { IncomingMessage } from 'node:http';
import type { Session } from '../domain/index.js';

/**
 * Puerto mínimo que necesita el middleware para validar sesiones. Lo satisface
 * `AuthService.validateSession` (contrato de la sección "Interfaz de
 * autenticación" del diseño).
 */
export interface SessionValidator {
  validateSession(token: string): Session | null;
}

/** Resultado de autenticar una petición: éxito con la sesión, o fallo. */
export type AuthResult =
  | { authenticated: true; session: Session }
  | { authenticated: false };

/**
 * Extrae el token de sesión de la cabecera `Authorization` con el esquema
 * `Bearer <token>`. Devuelve `null` si la cabecera está ausente, no usa el
 * esquema `Bearer`, o el token está vacío. La comparación del esquema es
 * insensible a mayúsculas para tolerar `bearer`/`Bearer`.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme === undefined || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  const token = rest.join(' ').trim();
  return token.length === 0 ? null : token;
}

/**
 * Autentica una petición: extrae el token `Bearer` y lo valida contra el
 * `SessionValidator`. Devuelve la sesión si es válida (Requisitos 13.1, 13.5) o
 * un resultado no autenticado en cualquier otro caso.
 */
export function authenticateRequest(
  req: IncomingMessage,
  validator: SessionValidator,
): AuthResult {
  const token = extractBearerToken(req);
  if (token === null) {
    return { authenticated: false };
  }
  const session = validator.validateSession(token);
  if (session === null) {
    return { authenticated: false };
  }
  return { authenticated: true, session };
}
