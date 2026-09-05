import { describe, it, expect } from 'vitest';
import type { PgClient, Queryable, QueryResult, QueryRow } from './db.js';
import { PersistenceError } from './errors.js';
import { SqlAnalysisResultRepository } from './analysisResultRepository.js';
import type { AnalysisResult } from '../domain/index.js';

/**
 * Doble de prueba en memoria del cliente PostgreSQL.
 *
 * Emula lo mínimo del esquema (tablas relevantes al `AnalysisResult`) para
 * ejercitar la lógica REAL del repositorio: los INSERT parametrizados escriben
 * en tablas en memoria y los SELECT por `result_id`/`id` leen de ellas. La
 * transacción es atómica: si el callback lanza, se descartan los cambios
 * (ROLLBACK), preservando el estado previo (Requisito 2.4). No se mockea el
 * código bajo prueba; solo se sustituye el motor de base de datos.
 */
interface Tables {
  analysis_result: QueryRow[];
  functional_summary: QueryRow[];
  key_component: QueryRow[];
  architecture_inference: QueryRow[];
  vulnerability: QueryRow[];
  outdated_dependency: QueryRow[];
  api_endpoint: QueryRow[];
}

function emptyTables(): Tables {
  return {
    analysis_result: [],
    functional_summary: [],
    key_component: [],
    architecture_inference: [],
    vulnerability: [],
    outdated_dependency: [],
    api_endpoint: [],
  };
}

function clone(tables: Tables): Tables {
  return JSON.parse(JSON.stringify(tables)) as Tables;
}

class FakePgClient implements PgClient {
  tables: Tables = emptyTables();
  /** Si se define, la consulta cuyo SQL contenga esta subcadena lanzará. */
  failOnSqlContaining?: string;

  private run(store: Tables, sql: string, params: unknown[] = []): QueryResult {
    if (this.failOnSqlContaining && sql.includes(this.failOnSqlContaining)) {
      throw new Error(`fallo simulado de base de datos en: ${this.failOnSqlContaining}`);
    }
    const norm = sql.trim();

    if (norm.startsWith('INSERT INTO analysis_result')) {
      store.analysis_result.push({
        id: params[0],
        job_id: params[1],
        primary_language: params[2],
        secondary_languages: params[3],
        analysis_mode: params[4],
        config_read_notes: params[5],
        notices: params[6],
        vulnerabilities_status: params[7],
        outdated_dependencies_status: params[8],
        api_endpoints_status: params[9],
        created_at: params[10],
      });
      return { rows: [], rowCount: 1 };
    }
    if (norm.startsWith('INSERT INTO functional_summary')) {
      store.functional_summary.push({
        result_id: params[0],
        summary: params[1],
        confidence_pct: params[2],
        determined: params[3],
      });
      return { rows: [], rowCount: 1 };
    }
    if (norm.startsWith('INSERT INTO key_component')) {
      store.key_component.push({
        result_id: params[0],
        path: params[1],
        category: params[2],
        confidence: params[3],
        inferred: params[4],
      });
      return { rows: [], rowCount: 1 };
    }
    if (norm.startsWith('INSERT INTO architecture_inference')) {
      store.architecture_inference.push({
        result_id: params[0],
        type: params[1],
        confidence_pct: params[2],
        evidence: params[3],
        determined: params[4],
      });
      return { rows: [], rowCount: 1 };
    }
    if (norm.startsWith('INSERT INTO vulnerability')) {
      store.vulnerability.push({ result_id: params[0], location: params[1], severity: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (norm.startsWith('INSERT INTO outdated_dependency')) {
      store.outdated_dependency.push({
        result_id: params[0],
        name: params[1],
        detected_version: params[2],
        latest_version: params[3],
      });
      return { rows: [], rowCount: 1 };
    }
    if (norm.startsWith('INSERT INTO api_endpoint')) {
      store.api_endpoint.push({ result_id: params[0], path: params[1], method: params[2] });
      return { rows: [], rowCount: 1 };
    }

    // SELECTs
    if (norm.includes('FROM analysis_result')) {
      const rows = store.analysis_result.filter((r) => r.id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (norm.includes('FROM functional_summary')) {
      const rows = store.functional_summary.filter((r) => r.result_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (norm.includes('FROM key_component')) {
      const rows = store.key_component
        .filter((r) => r.result_id === params[0])
        .sort((a, b) => String(a.path).localeCompare(String(b.path)));
      return { rows, rowCount: rows.length };
    }
    if (norm.includes('FROM architecture_inference')) {
      const rows = store.architecture_inference.filter((r) => r.result_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (norm.includes('FROM vulnerability')) {
      const rows = store.vulnerability.filter((r) => r.result_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (norm.includes('FROM outdated_dependency')) {
      const rows = store.outdated_dependency.filter((r) => r.result_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (norm.includes('FROM api_endpoint')) {
      const rows = store.api_endpoint.filter((r) => r.result_id === params[0]);
      return { rows, rowCount: rows.length };
    }

    throw new Error(`SQL no soportado por el doble de prueba: ${sql}`);
  }

  async query<R extends QueryRow = QueryRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.run(this.tables, sql, params) as QueryResult<R>;
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const snapshot = clone(this.tables);
    const staged = clone(this.tables);
    const tx: Queryable = {
      query: async <R extends QueryRow = QueryRow>(sql: string, params?: unknown[]) =>
        this.run(staged, sql, params) as QueryResult<R>,
    };
    try {
      const out = await fn(tx);
      this.tables = staged; // COMMIT
      return out;
    } catch (err) {
      this.tables = snapshot; // ROLLBACK
      throw err;
    }
  }
}

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const base: AnalysisResult = {
    id: 'res-1',
    jobId: 'job-1',
    primaryLanguage: 'TYPESCRIPT',
    secondaryLanguages: ['JAVASCRIPT', 'PYTHON'],
    analysisMode: 'SOLO_ESTATICO',
    functionalSummary: {
      summary: 'Servicio de análisis de repositorios que expone una API HTTP.',
      confidencePct: 80,
      determined: true,
    },
    keyComponents: [
      { path: 'src/server.ts', category: 'punto_de_entrada', inferred: false },
      { path: 'src/services/analysis.ts', category: 'servicio', confidence: 0.65, inferred: true },
    ],
    architecture: {
      type: 'por_capas',
      confidencePct: 72,
      determined: true,
      evidence: 'Separación clara entre capas de API, dominio y persistencia.',
    },
    additionalFindings: {
      vulnerabilities: {
        status: 'CON_HALLAZGOS',
        items: [{ location: 'src/auth.ts', severity: 'alta' }],
      },
      outdatedDependencies: {
        status: 'SIN_HALLAZGOS',
        items: [],
      },
      apiEndpoints: {
        status: 'NO_ANALIZABLE',
        items: [],
      },
    },
    configReadNotes: ['package.json leído correctamente.'],
    notices: [],
    createdAt: '2024-01-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('SqlAnalysisResultRepository.save + findById (Requisitos 2.1, 2.3)', () => {
  it('hace round-trip completo del AnalysisResult a través de las tablas', async () => {
    const db = new FakePgClient();
    const repo = new SqlAnalysisResultRepository(db);
    const result = makeResult();

    await repo.save(result);
    const loaded = await repo.findById(result.id);

    expect(loaded).toEqual(result);
  });

  it('preserva un resultado con valores límite (sin componentes, arquitectura no determinada)', async () => {
    const db = new FakePgClient();
    const repo = new SqlAnalysisResultRepository(db);
    const result = makeResult({
      id: 'res-2',
      primaryLanguage: null,
      secondaryLanguages: [],
      keyComponents: [],
      analysisMode: 'ESTATICO_MAS_IA',
      functionalSummary: { summary: '', confidencePct: 0, determined: false },
      architecture: { type: null, confidencePct: 0, determined: false, evidence: '' },
      additionalFindings: {
        vulnerabilities: { status: 'SIN_HALLAZGOS', items: [] },
        outdatedDependencies: {
          status: 'CON_HALLAZGOS',
          items: [{ name: 'lodash', detectedVersion: '4.17.20', latestVersion: '4.17.21' }],
        },
        apiEndpoints: {
          status: 'CON_HALLAZGOS',
          items: [{ path: '/analyses', method: 'POST' }],
        },
      },
      configReadNotes: [],
      notices: ['La inferencia por IA no se completó.'],
    });

    await repo.save(result);
    const loaded = await repo.findById(result.id);

    expect(loaded).toEqual(result);
  });
});

describe('SqlAnalysisResultRepository.findById: identificador inexistente (Requisito 2.5)', () => {
  it('devuelve null cuando el id no existe', async () => {
    const db = new FakePgClient();
    const repo = new SqlAnalysisResultRepository(db);

    expect(await repo.findById('inexistente')).toBeNull();
  });

  it('devuelve null tras guardar un resultado distinto', async () => {
    const db = new FakePgClient();
    const repo = new SqlAnalysisResultRepository(db);
    await repo.save(makeResult({ id: 'res-A' }));

    expect(await repo.findById('res-B')).toBeNull();
  });
});

describe('SqlAnalysisResultRepository.save: fallo preserva datos previos (Requisito 2.4)', () => {
  it('lanza PersistenceError y conserva sin cambios los datos ya almacenados', async () => {
    const db = new FakePgClient();
    const repo = new SqlAnalysisResultRepository(db);

    // Estado previo: un resultado ya persistido correctamente.
    const previo = makeResult({ id: 'res-previo' });
    await repo.save(previo);

    // El siguiente guardado falla al insertar una vulnerabilidad (a mitad de la
    // transacción, después de varias inserciones).
    db.failOnSqlContaining = 'INSERT INTO vulnerability';
    const nuevo = makeResult({ id: 'res-nuevo' });

    await expect(repo.save(nuevo)).rejects.toBeInstanceOf(PersistenceError);

    // Los datos previos permanecen intactos...
    expect(await repo.findById('res-previo')).toEqual(previo);
    // ...y no queda ningún artefacto parcial del guardado fallido (ROLLBACK).
    expect(await repo.findById('res-nuevo')).toBeNull();
    expect(db.tables.functional_summary.some((r) => r.result_id === 'res-nuevo')).toBe(false);
    expect(db.tables.analysis_result.some((r) => r.id === 'res-nuevo')).toBe(false);
  });

  it('envuelve un fallo en la primera inserción como PersistenceError sin dejar rastro', async () => {
    const db = new FakePgClient();
    const repo = new SqlAnalysisResultRepository(db);
    db.failOnSqlContaining = 'INSERT INTO analysis_result';

    await expect(repo.save(makeResult())).rejects.toBeInstanceOf(PersistenceError);
    expect(db.tables.analysis_result).toHaveLength(0);
  });
});
