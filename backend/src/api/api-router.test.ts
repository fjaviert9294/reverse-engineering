import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { randomUUID, scryptSync } from 'node:crypto';
import { createServer } from '../server.js';
import { createApiRouter, type PreferenceRepository } from './api-router.js';
import { DefaultAuthService } from '../auth/auth-service.js';
import { InMemoryUserStore } from '../auth/user-store.js';
import type { StoredUser } from '../domain/index.js';

/**
 * Pruebas de ejemplo de los endpoints de la Task 15.1:
 * - `POST /auth/login`: login válido establece sesión y devuelve token (Req 13.2);
 *   credenciales inválidas devuelven 401 con error genérico (Req 13.3).
 * - Middleware de sesión: `PUT /preferences/ai` sin sesión válida se deniega con
 *   401 (Req 13.1).
 * - `PUT /preferences/ai` con sesión válida conserva la preferencia por usuario
 *   (Req 3.3).
 *
 * Se ejercita el flujo real de extremo a extremo: servidor HTTP + router +
 * `DefaultAuthService` + un `PreferenceRepository` en memoria (sustituye solo el
 * puerto de I/O, sin mockear la lógica bajo prueba).
 */

/** Construye un hash `salt:derivedKeyHex` (scrypt) compatible con `AuthService`. */
function hashPassword(password: string, salt = 'sal-fija'): string {
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

function makeUser(username: string, password: string): StoredUser {
  return {
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
    failedAttempts: 0,
    lockedUntil: null,
  };
}

/** `PreferenceRepository` en memoria para verificar la persistencia por usuario. */
class InMemoryPreferenceRepository implements PreferenceRepository {
  private readonly byUser = new Map<string, boolean>();

  async setUseAI(userId: string, useAI: boolean): Promise<void> {
    this.byUser.set(userId, useAI);
  }

  async getUseAI(userId: string): Promise<boolean> {
    return this.byUser.get(userId) ?? false;
  }
}

interface TestContext {
  baseUrl: string;
  prefs: InMemoryPreferenceRepository;
  close: () => Promise<void>;
}

async function startServer(users: StoredUser[]): Promise<TestContext> {
  const authService = new DefaultAuthService(new InMemoryUserStore(users));
  const prefs = new InMemoryPreferenceRepository();
  const router = createApiRouter({ authService, preferenceRepository: prefs });
  const server = createServer(router);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    prefs,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe('POST /auth/login (Req 13.1, 13.2, 13.3)', () => {
  it('con credenciales válidas devuelve 200 y un token de sesión (Req 13.2)', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const res = await fetch(`${ctx.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ana', password: 'clave-secreta' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; token: string; username: string };
      expect(body.status).toBe('ok');
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
      expect(body.username).toBe('ana');
    } finally {
      await ctx.close();
    }
  });

  it('con contraseña incorrecta devuelve 401 con error genérico que no revela el campo (Req 13.3)', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const res = await fetch(`${ctx.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ana', password: 'incorrecta' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { message: string; token?: string };
      expect(body.token).toBeUndefined();
      // El mensaje no debe revelar si el fallo fue por usuario o por contraseña.
      expect(body.message.toLowerCase()).not.toContain('contraseña incorrecta');
      expect(body.message.toLowerCase()).not.toContain('usuario no');
    } finally {
      await ctx.close();
    }
  });

  it('con usuario inexistente devuelve el mismo mensaje que con contraseña incorrecta (Req 13.3)', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const [wrongUser, wrongPass] = await Promise.all([
        fetch(`${ctx.baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'inexistente', password: 'clave-secreta' }),
        }).then((r) => r.json() as Promise<{ message: string }>),
        fetch(`${ctx.baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'ana', password: 'incorrecta' }),
        }).then((r) => r.json() as Promise<{ message: string }>),
      ]);
      expect(wrongUser.message).toBe(wrongPass.message);
    } finally {
      await ctx.close();
    }
  });
});

describe('PUT /preferences/ai (Req 13.1 middleware, Req 3.3)', () => {
  it('sin sesión (sin cabecera Authorization) deniega el acceso con 401 (Req 13.1)', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const res = await fetch(`${ctx.baseUrl}/preferences/ai`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useAI: true }),
      });
      expect(res.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  it('con token inválido deniega el acceso con 401 (Req 13.1)', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const res = await fetch(`${ctx.baseUrl}/preferences/ai`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-que-no-existe',
        },
        body: JSON.stringify({ useAI: true }),
      });
      expect(res.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  it('con sesión válida conserva la preferencia de IA del usuario autenticado (Req 3.3)', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const loginRes = await fetch(`${ctx.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ana', password: 'clave-secreta' }),
      });
      const { token, userId } = (await loginRes.json()) as { token: string; userId: string };

      const putRes = await fetch(`${ctx.baseUrl}/preferences/ai`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ useAI: true }),
      });
      expect(putRes.status).toBe(200);
      const putBody = (await putRes.json()) as { status: string; useAI: boolean };
      expect(putBody.status).toBe('ok');
      expect(putBody.useAI).toBe(true);

      // La preferencia se conserva para el usuario de la sesión (Req 3.3).
      await expect(ctx.prefs.getUseAI(userId)).resolves.toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('con sesión válida pero cuerpo sin "useAI" booleano devuelve 400', async () => {
    const ctx = await startServer([makeUser('ana', 'clave-secreta')]);
    try {
      const loginRes = await fetch(`${ctx.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ana', password: 'clave-secreta' }),
      });
      const { token } = (await loginRes.json()) as { token: string };

      const putRes = await fetch(`${ctx.baseUrl}/preferences/ai`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ useAI: 'sí' }),
      });
      expect(putRes.status).toBe(400);
    } finally {
      await ctx.close();
    }
  });
});
