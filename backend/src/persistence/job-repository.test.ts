import { describe, it, expect } from 'vitest';
import type { AnalysisJob, AnalysisStage, JobStatus } from '../domain/index.js';
import type { QueryResult, QueryRow, Queryable } from './db.js';
import {
  SqlJobRepository,
  JobValidationError,
  assertValidProgress,
  assertValidStage,
} from './job-repository.js';

/**
 * Doble de prueba en memoria del `Queryable`. Simula la tabla `analysis_job`
 * interpretando las sentencias que emite `SqlJobRepository` (INSERT/UPDATE/SELECT
 * por id), suficiente para verificar el comportamiento del repositorio sin una
 * instancia real de PostgreSQL. Registra además las consultas ejecutadas para
 * poder afirmar sobre parametrización.
 */
class FakeQueryable implements Queryable {
  readonly calls: Array<{ text: string; params: readonly unknown[] }> = [];
  private readonly table = new Map<string, Record<string, unknown>>();

  async query<R extends QueryRow = QueryRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.calls.push({ text, params });
    const sql = text.trim();

    if (sql.startsWith('INSERT INTO analysis_job')) {
      const [
        id,
        user_id,
        status,
        progress,
        stage,
        use_ai_requested,
        input_source,
        source_url,
        error_module,
        created_at,
        updated_at,
      ] = params;
      this.table.set(id as string, {
        id,
        user_id,
        status,
        progress,
        stage,
        use_ai_requested,
        input_source,
        source_url,
        error_module,
        created_at,
        updated_at,
      });
      return { rows: [] as R[], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE analysis_job') && sql.includes('progress = $2')) {
      const [id, progress, stage] = params;
      const row = this.table.get(id as string);
      if (row) {
        row.progress = progress;
        row.stage = stage;
        row.updated_at = new Date().toISOString();
      }
      return { rows: [] as R[], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE analysis_job') && sql.includes('status = $2')) {
      const [id, status, error_module] = params;
      const row = this.table.get(id as string);
      if (row) {
        row.status = status;
        row.error_module = error_module;
        row.updated_at = new Date().toISOString();
      }
      return { rows: [] as R[], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('SELECT')) {
      const [id] = params;
      const row = this.table.get(id as string);
      const rows = (row ? [row] : []) as R[];
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Consulta no soportada por el doble de prueba: ${sql}`);
  }
}

function makeJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    status: 'EN_COLA',
    progress: 0,
    stage: 'INGESTA',
    useAIRequested: false,
    inputSource: 'ZIP',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqlJobRepository.create', () => {
  it('inserta el job con parámetros posicionales y hace round-trip por findById', async () => {
    const db = new FakeQueryable();
    const repo = new SqlJobRepository(db);
    const job = makeJob({
      inputSource: 'GITHUB_URL',
      sourceUrl: 'https://github.com/acme/repo',
    });

    await repo.create(job);

    // La sentencia es parametrizada (no interpola valores en el texto SQL).
    const insert = db.calls.find((c) => c.text.includes('INSERT INTO analysis_job'));
    expect(insert).toBeDefined();
    expect(insert?.text).toContain('$11');
    expect(insert?.text).not.toContain(job.userId);

    const found = await repo.findById('job-1');
    expect(found).toEqual(job);
  });

  it('rechaza un progress fuera de rango al crear', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    await expect(repo.create(makeJob({ progress: 150 }))).rejects.toBeInstanceOf(
      JobValidationError,
    );
  });

  it('rechaza una etapa no definida al crear', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    await expect(
      repo.create(makeJob({ stage: 'DESCONOCIDA' as unknown as AnalysisStage })),
    ).rejects.toBeInstanceOf(JobValidationError);
  });
});

describe('SqlJobRepository.updateProgress', () => {
  it('actualiza progreso y etapa dentro de los invariantes', async () => {
    const db = new FakeQueryable();
    const repo = new SqlJobRepository(db);
    await repo.create(makeJob());

    await repo.updateProgress('job-1', 100, 'FINALIZADO');

    const found = await repo.findById('job-1');
    expect(found?.progress).toBe(100);
    expect(found?.stage).toBe('FINALIZADO');
  });

  it('rechaza progreso negativo o superior a 100 (Requisito 12.1)', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    await expect(repo.updateProgress('job-1', -1, 'INGESTA')).rejects.toBeInstanceOf(
      JobValidationError,
    );
    await expect(repo.updateProgress('job-1', 101, 'INGESTA')).rejects.toBeInstanceOf(
      JobValidationError,
    );
  });

  it('rechaza progreso no entero', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    await expect(repo.updateProgress('job-1', 12.5, 'INGESTA')).rejects.toBeInstanceOf(
      JobValidationError,
    );
  });

  it('rechaza una etapa inválida', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    await expect(
      repo.updateProgress('job-1', 50, 'X' as unknown as AnalysisStage),
    ).rejects.toBeInstanceOf(JobValidationError);
  });
});

describe('SqlJobRepository.setStatus', () => {
  it('fija el estado sin módulo de error cuando no se aporta', async () => {
    const db = new FakeQueryable();
    const repo = new SqlJobRepository(db);
    await repo.create(makeJob());

    await repo.setStatus('job-1', 'EN_PROGRESO');

    const found = await repo.findById('job-1');
    expect(found?.status).toBe('EN_PROGRESO');
    expect(found?.errorModule).toBeUndefined();
  });

  it('registra el módulo afectado ante fallo (Requisito 14.6)', async () => {
    const db = new FakeQueryable();
    const repo = new SqlJobRepository(db);
    await repo.create(makeJob());

    await repo.setStatus('job-1', 'FALLIDO', {
      module: 'ANALISIS_ESTATICO',
      message: 'fallo del parser',
    });

    const found = await repo.findById('job-1');
    expect(found?.status).toBe('FALLIDO');
    expect(found?.errorModule).toBe('ANALISIS_ESTATICO');
  });

  it('rechaza un estado no definido', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    await expect(
      repo.setStatus('job-1', 'RARO' as unknown as JobStatus),
    ).rejects.toBeInstanceOf(JobValidationError);
  });
});

describe('SqlJobRepository.findById', () => {
  it('devuelve null cuando el job no existe', async () => {
    const repo = new SqlJobRepository(new FakeQueryable());
    expect(await repo.findById('inexistente')).toBeNull();
  });
});

describe('validadores de dominio', () => {
  it('assertValidProgress acepta los bordes 0 y 100', () => {
    expect(() => assertValidProgress(0)).not.toThrow();
    expect(() => assertValidProgress(100)).not.toThrow();
  });

  it('assertValidStage acepta todas las etapas definidas', () => {
    const stages: AnalysisStage[] = [
      'INGESTA',
      'ANALISIS_ESTATICO',
      'INFERENCIA_IA',
      'PERSISTENCIA',
      'FINALIZADO',
    ];
    for (const stage of stages) {
      expect(() => assertValidStage(stage)).not.toThrow();
    }
  });
});
