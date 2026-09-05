import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Queryable, QueryResult, QueryRow } from './db.js';
import { SqlPreferenceRepository } from './preference-repository.js';

/**
 * Fake en memoria de `Queryable` que emula el comportamiento relevante de la
 * tabla `preferencia` (0002_schema.sql): upsert por clave primaria `user_id` y
 * lectura de `use_ai`. Permite ejercitar `SqlPreferenceRepository` con lógica
 * real de persistencia (round-trip, upsert, valor por defecto) sin una base de
 * datos real. No usa mocks de la lógica bajo prueba: solo sustituye el puerto de
 * I/O.
 */
class InMemoryPreferenceDb implements Queryable {
  private readonly table = new Map<string, boolean>();
  public readonly executed: Array<{ sql: string; params: unknown[] }> = [];

  async query<R extends QueryRow = QueryRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.executed.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    if (normalized.startsWith('INSERT INTO PREFERENCIA')) {
      const [userId, useAI] = params as [string, boolean];
      // Upsert: crea o sobreescribe (ON CONFLICT ... DO UPDATE).
      this.table.set(userId, useAI);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('SELECT USE_AI FROM PREFERENCIA')) {
      const [userId] = params as [string];
      if (!this.table.has(userId)) {
        return { rows: [], rowCount: 0 };
      }
      const row = { use_ai: this.table.get(userId) } as unknown as R;
      return { rows: [row], rowCount: 1 };
    }

    throw new Error(`Consulta no soportada por el fake: ${sql}`);
  }
}

describe('SqlPreferenceRepository (Task 3.4)', () => {
  it('getUseAI devuelve false cuando el usuario no tiene preferencia (privacidad por defecto, Req 4.1/4.2)', async () => {
    const db = new InMemoryPreferenceDb();
    const repo = new SqlPreferenceRepository(db);

    await expect(repo.getUseAI('usuario-sin-preferencia')).resolves.toBe(false);
  });

  it('setUseAI(true) se conserva y getUseAI lo recupera (Req 3.3)', async () => {
    const db = new InMemoryPreferenceDb();
    const repo = new SqlPreferenceRepository(db);

    await repo.setUseAI('u1', true);

    await expect(repo.getUseAI('u1')).resolves.toBe(true);
  });

  it('setUseAI(false) se conserva y getUseAI lo recupera', async () => {
    const db = new InMemoryPreferenceDb();
    const repo = new SqlPreferenceRepository(db);

    await repo.setUseAI('u1', false);

    await expect(repo.getUseAI('u1')).resolves.toBe(false);
  });

  it('setUseAI sobreescribe (upsert) la preferencia previa del mismo usuario (Req 3.3)', async () => {
    const db = new InMemoryPreferenceDb();
    const repo = new SqlPreferenceRepository(db);

    await repo.setUseAI('u1', true);
    await repo.setUseAI('u1', false);

    await expect(repo.getUseAI('u1')).resolves.toBe(false);
  });

  it('la preferencia es por usuario: no se mezcla entre usuarios distintos', async () => {
    const db = new InMemoryPreferenceDb();
    const repo = new SqlPreferenceRepository(db);

    await repo.setUseAI('u1', true);
    await repo.setUseAI('u2', false);

    await expect(repo.getUseAI('u1')).resolves.toBe(true);
    await expect(repo.getUseAI('u2')).resolves.toBe(false);
    await expect(repo.getUseAI('u3')).resolves.toBe(false);
  });

  it('usa consultas parametrizadas (marcadores posicionales) para prevenir inyección de SQL', async () => {
    const db = new InMemoryPreferenceDb();
    const repo = new SqlPreferenceRepository(db);

    await repo.setUseAI("u'; DROP TABLE preferencia; --", true);

    const insert = db.executed.find((e) => e.sql.trim().toUpperCase().startsWith('INSERT'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('$1');
    expect(insert!.sql).toContain('$2');
    expect(insert!.params).toEqual(["u'; DROP TABLE preferencia; --", true]);
  });

  // Prueba de propiedad de round-trip de la preferencia de IA: para cualquier
  // valor booleano guardado, recuperarlo devuelve el mismo valor (Requisito 3.3).
  // Cubre el comportamiento del repositorio; la Property 7 formal se implementa
  // en la tarea opcional 3.5.
  it('round-trip: para cualquier booleano, setUseAI seguido de getUseAI devuelve el mismo valor (Req 3.3)', () => {
    fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), fc.boolean(), async (userId, useAI) => {
        const db = new InMemoryPreferenceDb();
        const repo = new SqlPreferenceRepository(db);

        await repo.setUseAI(userId, useAI);
        const recovered = await repo.getUseAI(userId);

        return recovered === useAI;
      }),
      { numRuns: 100 },
    );
  });
});
