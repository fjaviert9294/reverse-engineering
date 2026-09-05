import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { authenticateRequest, extractBearerToken, type SessionValidator } from './auth-middleware.js';
import type { Session } from '../domain/index.js';

/**
 * Pruebas unitarias del middleware de autenticación (Task 15.1, Req 13.1).
 * Verifican la extracción del token `Bearer` y la decisión de autenticación
 * frente a un `SessionValidator` inyectado.
 */

/** Construye un `IncomingMessage` mínimo con la cabecera `Authorization` dada. */
function requestWithAuth(authorization?: string): IncomingMessage {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as IncomingMessage;
}

const validSession: Session = {
  token: 'tok-123',
  userId: 'u1',
  username: 'ana',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const validator: SessionValidator = {
  validateSession: (token) => (token === 'tok-123' ? validSession : null),
};

describe('extractBearerToken', () => {
  it('extrae el token del esquema Bearer', () => {
    expect(extractBearerToken(requestWithAuth('Bearer tok-123'))).toBe('tok-123');
  });

  it('tolera el esquema en minúsculas', () => {
    expect(extractBearerToken(requestWithAuth('bearer tok-123'))).toBe('tok-123');
  });

  it('devuelve null si falta la cabecera Authorization', () => {
    expect(extractBearerToken(requestWithAuth())).toBeNull();
  });

  it('devuelve null si el esquema no es Bearer', () => {
    expect(extractBearerToken(requestWithAuth('Basic dXNlcjpwYXNz'))).toBeNull();
  });

  it('devuelve null si el token está vacío', () => {
    expect(extractBearerToken(requestWithAuth('Bearer '))).toBeNull();
  });
});

describe('authenticateRequest (Req 13.1)', () => {
  it('autentica una petición con un token de sesión válido', () => {
    const result = authenticateRequest(requestWithAuth('Bearer tok-123'), validator);
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.session.userId).toBe('u1');
    }
  });

  it('rechaza una petición sin token', () => {
    expect(authenticateRequest(requestWithAuth(), validator).authenticated).toBe(false);
  });

  it('rechaza una petición con un token que no corresponde a ninguna sesión', () => {
    expect(
      authenticateRequest(requestWithAuth('Bearer otro-token'), validator).authenticated,
    ).toBe(false);
  });
});
