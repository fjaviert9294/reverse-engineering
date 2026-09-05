import { describe, it, expect, vi } from 'vitest';
import type {
  AnalysisJob,
  AnalysisResult,
  AnalysisStage,
  JobStatus,
  ModuleError,
} from '../domain/index.js';
import type { JobRepository } from '../persistence/index.js';
import type { AnalysisResultRepository } from '../persistence/index.js';
import {
  IngestionError,
  type ExtractedRepo,
  type IngestionModule,
  type UploadedZip,
} from '../ingestion/index.js';
import type { AIFindings, AIInferenceModule, AIUnavailable } from '../ai/index.js';
import {
  DefaultAnalysisOrchestrator,
  type OrchestratorClock,
  type TransientContentReader,
} from './analysis-orchestrator.js';

/**
 * Pruebas de ejemplo del orquestador asíncrono (Task 14.2).
 *
 * Cubren el pipeline Ingesta -> Análisis Estático -> [IA] -> Persistir ->
 * Descartar, la cadencia de progreso y el 100% al completar (Requisitos 12.1,
 * 12.4), el descarte del código en éxito y fallo (Requisitos 1.5, 15.4), y el
 * aislamiento de fallos por módulo con identificación del módulo afectado y
 * preservación del estado previo (Requisitos 12.5, 14.6).
 */

// ---------------------------------------------------------------------------
// Dobles de prueba (in-memory) para las dependencias del orquestador
// ---------------------------------------------------------------------------

interface ProgressEvent {
  progress: number;
  stage: AnalysisStage;
}
interface StatusEvent {
  status: JobStatus;
  error?: ModuleError;
}

function makeJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    userId: 'user-1',
    status: 'EN_COLA',
    progress: 0,
    stage: 'INGESTA',
    useAIRequested: false,
    inputSource: 'ZIP',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class FakeJobRepository implements JobRepository {
  progressEvents: ProgressEvent[] = [];
  statusEvents: StatusEvent[] = [];
  private readonly job: AnalysisJob | null;

  constructor(job: AnalysisJob | null) {
    this.job = job;
  }

  async create(): Promise<void> {}
  async updateProgress(_id: string, progress: number, stage: AnalysisStage): Promise<void> {
    this.progressEvents.push({ progress, stage });
  }
  async setStatus(_id: string, status: JobStatus, error?: ModuleError): Promise<void> {
    this.statusEvents.push(error ? { status, error } : { status });
  }
  async findById(): Promise<AnalysisJob | null> {
    return this.job;
  }
}

class FakeResultRepository implements AnalysisResultRepository {
  saved: AnalysisResult[] = [];
  shouldFail = false;

  async save(result: AnalysisResult): Promise<void> {
    if (this.shouldFail) {
      throw new Error('fallo de persistencia simulado');
    }
    this.saved.push(result);
  }
  async findById(): Promise<AnalysisResult | null> {
    return this.saved[0] ?? null;
  }
}

/** Ingesta con un repositorio extraído fijo y descarte observable. */
class FakeIngestion implements IngestionModule {
  discarded: string[] = [];
  extractCalls = 0;
  fetchCalls = 0;

  constructor(
    private readonly behavior: {
      extractResult?: ExtractedRepo | IngestionError;
      fetchResult?: UploadedZip | IngestionError;
    } = {},
  ) {}

  async extract(zip: UploadedZip): Promise<ExtractedRepo | IngestionError> {
    this.extractCalls += 1;
    if (this.behavior.extractResult) {
      return this.behavior.extractResult;
    }
    return {
      jobId: zip.jobId,
      files: [{ path: 'src/index.ts', size: 10 }],
      analyzableLanguages: ['TYPESCRIPT'],
    };
  }
  async fetchFromGitHub(): Promise<UploadedZip | IngestionError> {
    this.fetchCalls += 1;
    return (
      this.behavior.fetchResult ?? {
        jobId: '',
        content: Buffer.from('PK', 'binary'),
        filename: 'owner-repo.zip',
      }
    );
  }
  async discard(repo: ExtractedRepo): Promise<void> {
    this.discarded.push(repo.jobId);
  }
}

class FakeAI implements AIInferenceModule {
  inferCalls = 0;
  constructor(private readonly outcome?: AIFindings | AIUnavailable) {}
  isConfigured(): boolean {
    return true;
  }
  async infer(): Promise<AIFindings | AIUnavailable> {
    this.inferCalls += 1;
    return (
      this.outcome ?? {
        kind: 'AI_UNAVAILABLE',
        reason: 'PROVEEDOR_NO_CONFIGURADO',
        notice: 'IA no aplicada',
      }
    );
  }
}

const fixedClock: OrchestratorClock = {
  newId: () => 'result-1',
  now: () => '2024-01-01T00:00:00.000Z',
};

/** Lector de contenido que devuelve un texto no vacío para cualquier ruta. */
const readAll: TransientContentReader = async () => 'contenido';

function makeOrchestrator(opts: {
  job: AnalysisJob | null;
  ingestion?: FakeIngestion;
  results?: FakeResultRepository;
  jobs?: FakeJobRepository;
  ai?: FakeAI;
  readContent?: TransientContentReader;
}) {
  const jobs = opts.jobs ?? new FakeJobRepository(opts.job);
  const results = opts.results ?? new FakeResultRepository();
  const ingestion = opts.ingestion ?? new FakeIngestion();
  const ai = opts.ai ?? new FakeAI();
  const orchestrator = new DefaultAnalysisOrchestrator({
    jobRepository: jobs,
    resultRepository: results,
    ingestion,
    ai,
    readContent: opts.readContent ?? readAll,
    clock: fixedClock,
    progressTickMs: 100_000, // evita el ticker periódico en pruebas unitarias
  });
  return { orchestrator, jobs, results, ingestion, ai };
}

describe('DefaultAnalysisOrchestrator - pipeline exitoso', () => {
  it('ejecuta las etapas en orden, persiste el resultado y descarta el código', async () => {
    const { orchestrator, jobs, results, ingestion } = makeOrchestrator({ job: makeJob() });

    await orchestrator.run('job-1');

    // Etapas en orden (Ingesta -> Estático -> IA -> Persistencia -> Finalizado).
    const stages = jobs.progressEvents.map((e) => e.stage);
    expect(stages).toEqual([
      'INGESTA',
      'ANALISIS_ESTATICO',
      'INFERENCIA_IA',
      'PERSISTENCIA',
      'FINALIZADO',
    ]);

    // Resultado persistido y código descartado (Requisitos 1.5, 15.4).
    expect(results.saved).toHaveLength(1);
    expect(results.saved[0]?.jobId).toBe('job-1');
    expect(ingestion.discarded).toEqual(['job-1']);
  });

  it('marca COMPLETADO con progreso 100% al finalizar (Requisitos 12.4)', async () => {
    const { orchestrator, jobs } = makeOrchestrator({ job: makeJob() });

    await orchestrator.run('job-1');

    const last = jobs.progressEvents.at(-1);
    expect(last).toEqual({ progress: 100, stage: 'FINALIZADO' });
    expect(jobs.statusEvents.at(-1)).toEqual({ status: 'COMPLETADO' });
  });

  it('el progreso es monótonamente creciente y siempre en [0, 100] (Requisito 12.1)', async () => {
    const { orchestrator, jobs } = makeOrchestrator({ job: makeJob() });

    await orchestrator.run('job-1');

    let previous = -1;
    for (const { progress } of jobs.progressEvents) {
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(100);
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
  });

  it('cuando el usuario solicita IA, invoca el módulo de inferencia', async () => {
    const ai = new FakeAI({
      kind: 'AI_FINDINGS',
      functionalSummary: {
        summary: 'x'.repeat(60),
        confidencePct: 80,
        determined: true,
      },
    });
    const { orchestrator, results } = makeOrchestrator({
      job: makeJob({ useAIRequested: true }),
      ai,
    });

    await orchestrator.run('job-1');

    expect(ai.inferCalls).toBe(1);
    expect(results.saved[0]?.analysisMode).toBe('ESTATICO_MAS_IA');
  });

  it('sin solicitud de IA no invoca el módulo y mantiene SOLO_ESTATICO', async () => {
    const ai = new FakeAI();
    const { orchestrator, results } = makeOrchestrator({ job: makeJob({ useAIRequested: false }), ai });

    await orchestrator.run('job-1');

    expect(ai.inferCalls).toBe(0);
    expect(results.saved[0]?.analysisMode).toBe('SOLO_ESTATICO');
  });

  it('descarga desde GitHub cuando el origen es una URL', async () => {
    const ingestion = new FakeIngestion();
    const { orchestrator, results } = makeOrchestrator({
      job: makeJob({ inputSource: 'GITHUB_URL', sourceUrl: 'https://github.com/o/r' }),
      ingestion,
    });

    await orchestrator.run('job-1');

    expect(ingestion.fetchCalls).toBe(1);
    expect(results.saved).toHaveLength(1);
  });
});

describe('DefaultAnalysisOrchestrator - aislamiento de fallos por módulo (Requisitos 12.5, 14.6)', () => {
  it('un fallo de ingesta marca FALLIDO identificando INGESTA, no persiste y descarta', async () => {
    const ingestion = new FakeIngestion({
      extractResult: new IngestionError('SIN_CODIGO_ANALIZABLE', 'sin código analizable'),
    });
    const { orchestrator, jobs, results } = makeOrchestrator({ job: makeJob(), ingestion });

    await orchestrator.run('job-1');

    const failure = jobs.statusEvents.find((e) => e.status === 'FALLIDO');
    expect(failure?.error?.module).toBe('INGESTA');
    expect(results.saved).toHaveLength(0); // datos previos preservados (12.5)
    // El código extraído se descarta aunque la ingesta rechace (el módulo maneja
    // sus parciales; aquí no hubo repo, así que no se llama discard del orquestador).
    expect(ingestion.extractCalls).toBe(1);
  });

  it('un fallo de persistencia identifica PERSISTENCIA y descarta el código (Requisitos 1.5, 15.4)', async () => {
    const results = new FakeResultRepository();
    results.shouldFail = true;
    const ingestion = new FakeIngestion();
    const { orchestrator, jobs } = makeOrchestrator({ job: makeJob(), ingestion, results });

    await orchestrator.run('job-1');

    const failure = jobs.statusEvents.find((e) => e.status === 'FALLIDO');
    expect(failure?.error?.module).toBe('PERSISTENCIA');
    // El código se descarta también en el camino de fallo (Requisitos 1.5, 15.4).
    expect(ingestion.discarded).toEqual(['job-1']);
    // No se emite progreso 100% ni COMPLETADO cuando falla.
    expect(jobs.progressEvents.some((e) => e.progress === 100)).toBe(false);
    expect(jobs.statusEvents.some((e) => e.status === 'COMPLETADO')).toBe(false);
  });

  it('una URL de GitHub inaccesible acota el fallo a INGESTA y no inicia el análisis pesado', async () => {
    const ingestion = new FakeIngestion({
      fetchResult: new IngestionError('REPO_INACCESIBLE', 'repo inaccesible'),
    });
    const { orchestrator, jobs, results } = makeOrchestrator({
      job: makeJob({ inputSource: 'GITHUB_URL', sourceUrl: 'https://github.com/o/r' }),
      ingestion,
    });

    await orchestrator.run('job-1');

    expect(jobs.statusEvents.find((e) => e.status === 'FALLIDO')?.error?.module).toBe('INGESTA');
    expect(ingestion.extractCalls).toBe(0);
    expect(results.saved).toHaveLength(0);
  });

  it('sin contenido de ZIP subido, falla en INGESTA', async () => {
    const readNone: TransientContentReader = async () => null;
    const { orchestrator, jobs } = makeOrchestrator({ job: makeJob(), readContent: readNone });

    await orchestrator.run('job-1');

    expect(jobs.statusEvents.find((e) => e.status === 'FALLIDO')?.error?.module).toBe('INGESTA');
  });

  it('si el job no existe, no lanza ni orquesta', async () => {
    const { orchestrator, jobs, results } = makeOrchestrator({ job: null });

    await expect(orchestrator.run('missing')).resolves.toBeUndefined();
    expect(jobs.progressEvents).toHaveLength(0);
    expect(results.saved).toHaveLength(0);
  });
});

describe('DefaultAnalysisOrchestrator - cadencia de progreso (Requisito 12.1)', () => {
  it('refresca el progreso periódicamente por debajo de 2 s mientras una etapa está en curso', async () => {
    vi.useFakeTimers();
    try {
      const jobs = new FakeJobRepository(makeJob());
      const results = new FakeResultRepository();
      // Ingesta que tarda: mantiene la etapa INGESTA en curso mientras avanza el reloj.
      let releaseIngestion!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseIngestion = resolve;
      });
      const ingestion: IngestionModule = {
        async extract(zip) {
          await gate;
          return { jobId: zip.jobId, files: [{ path: 'a.ts', size: 1 }], analyzableLanguages: ['TYPESCRIPT'] };
        },
        async fetchFromGitHub() {
          return { jobId: '', content: Buffer.from(''), filename: 'x.zip' };
        },
        async discard() {},
      };
      const orchestrator = new DefaultAnalysisOrchestrator({
        jobRepository: jobs,
        resultRepository: results,
        ingestion,
        ai: new FakeAI(),
        readContent: readAll,
        clock: fixedClock,
        progressTickMs: 1500,
      });

      const run = orchestrator.run('job-1');

      // Deja pasar 4 s (> 2 intervalos de 1.5 s) con la etapa INGESTA en curso.
      await vi.advanceTimersByTimeAsync(4000);

      const ingestaTicks = jobs.progressEvents.filter((e) => e.stage === 'INGESTA');
      // Al menos: la actualización inicial + refrescos periódicos por debajo de 2 s.
      expect(ingestaTicks.length).toBeGreaterThanOrEqual(2);

      releaseIngestion();
      await vi.runAllTimersAsync();
      await run;
    } finally {
      vi.useRealTimers();
    }
  });
});
