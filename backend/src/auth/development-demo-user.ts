/**
 * Usuario demo disponible únicamente en entornos de desarrollo.
 *
 * Este usuario nunca se crea en producción ni se persiste en PostgreSQL. La
 * contraseña se transforma a scrypt en memoria al construir la aplicación.
 */

import { scryptSync } from 'node:crypto';
import type { StoredUser } from '../domain/index.js';

export const DEVELOPMENT_DEMO_USERNAME = 'demo';
export const DEVELOPMENT_DEMO_PASSWORD = 'demo1234';

/** Construye el usuario demo para el entorno explícito `NODE_ENV=development`. */
export function createDevelopmentDemoUser(): StoredUser {
  const salt = 'repo-analyzer-dev-demo-salt';
  const passwordHash = `${salt}:${scryptSync(DEVELOPMENT_DEMO_PASSWORD, salt, 32).toString('hex')}`;

  return {
    id: 'development-demo-user',
    username: DEVELOPMENT_DEMO_USERNAME,
    passwordHash,
    failedAttempts: 0,
    lockedUntil: null,
  };
}
