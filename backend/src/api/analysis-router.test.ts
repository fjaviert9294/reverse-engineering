import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { randomUUID, scryptSync } from 'node:crypto';
import { createServer } from '../server.js';
import { createApiRouter, type PreferenceRepository } from './api-router.js';
import { createAnalysisRouter, type AnalysisDependencies } from './analysis-router.js';
import { DefaultAuthService } from '../auth/auth-service.js';
import { InMemoryUserStore } from '../auth/user-store.js';
import { UPLOADED_ZIP_PATH } from '../orchestration/index.js';
import type {
  AnalysisJob,
  AnalysisResult,
  AnalysisStage,
  JobStatus,
  ModuleError,
  StoredUser,
} from '../domain/index.js';
import type { JobRepository, AnalysisResultRepository } from '../persistence/index.js';
import type { AnalysisQueue } from '../orchestration/index.js';
import type { TransientStorage, StorageEntry } from '../storage/index.js';
import type { ExportModule, MarkdownDocument, ExportError } from '../export/index.js';

/**
 * Pruebas de ejemplo/integración de los endpoints de análisis (Task 15.2):
 * - `POST /analyses` responde `202` con `{ jobId }` sin bloquear (Req 12.2, 12.3),
 *   valida "exactamente una entrada" (ZIP o URL, Req 1.2, Property 1), deposita
 *   el ZIP en el almacenamiento transitorio (Req 1.1, 2.2) y encola el job.
 * - Una URL de GitHub mal formada se rechaza con `400` y NO crea job ni encola
 *   (Req 15.5, Property 32).
 * - `GET /analyses/{id}/status` devuelve progreso/etapa; "no encontrado" si no
 *   existe (Req 12.1, 12.4).
 * - `GET /analyses/{id}` devuelve el resultado persistido; "no encontrado" si el
 *   id no existe (Req 2.3, 2.5).
 * - `POST /analyses/{id}/export` solicita la exportación a Markdown (Req 11.1).
 * - Todas las rutas de análisis exigen sesión válida (Req 13.1).
 *
 * Se ejercita el flujo real de extremo a extremo: servidor HTTP + router +
 * `DefaultAuthService` + dobles en memoria de los puertos de I/O (repositorios,
 * cola, almacenamiento transitorio, exportación), sin mockear la lógica bajo
 * prueba.
 */

// ---------------------------------------------------------------------------
// Utilidades de usuario/autenticación (reutilizan la convención de la Task 15.1)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dobles en memoria de los puertos de I/O consumidos por los endpoints
// ---------------------------------------------------------------------------

class InMemoryPreferenceRepository implements PreferenceRepository {
  private readonly byUser = new Map<string, boolean>();
  async setUseAI(userId: string, useAI: boolean): Promise<void> {
    this.byUser.set(userId, useAI);
  }
  async getUseAI(userId: string): Promise<boolean> {
    return this.byUser.get(userId) ?? false;
  }
}

class InMemoryJobRepository implements JobRepository {
  readonly jobs = new Map<string, AnalysisJob>();
  async create(job: AnalysisJob): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }
  async updateProgress(id: string, progress: number, stage: AnalysisStage): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.progress = progress;
      job.stage = stage;
    }
  }
  async setStatus(id: string, status: JobStatus, error?: ModuleError): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.status = status;
      if (error) job.errorModule = error.module;
    }
  }
  async findById(id: string): Promise<AnalysisJob | null> {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }
}

class InMemoryResultRepository implements AnalysisResultRepository {
  readonly results = new Map<string, AnalysisResult>();
  async save(result: AnalysisResult): Promise<void> {
    this.results.set(result.id, result);
  }
  async findById(id: string): Promise<AnalysisResult | null> {
    return this.results.get(id) ?? null;
  }
}

/** Cola que registra los jobs encolados sin ejecutar el pipeline. */
class RecordingQueue implements AnalysisQueue {
  readonly enqueued: AnalysisJob[] = [];
  async enqueue(job: AnalysisJob): Promise<void> {
    this.enqueued.push(job);
  }
}

/** Almacenamiento transitorio en memoria que registra las escrituras. */
class InMemoryTransientStorage implements TransientStorage {
  readonly spaces = new Map<string, Map<string, Uint8Array>>();
  async createJobSpace(jobId: string): Promise<string> {
    this.spaces.set(jobId, new Map());
    return `mem://${jobId}`;
  }
  async writeFile(jobId: string, relativePath: string, content: Uint8Array | string): Promise<void> {
    const space = this.spaces.get(jobId) ?? new Map<string, Uint8Array>();
    space.set(relativePath, typeof content === 'string' ? Buffer.from(content) : content);
    this.spaces.set(jobId, space);
  }
  async list(jobId: string): Promise<StorageEntry[]> {
    const space = this.spaces.get(jobId);
    if (!space) return [];
    return [...space.keys()].map((path) => ({ path, kind: 'file' as const }));
  }
  async discard(jobId: string): Promise<void> {
    this.spaces.delete(jobId);
  }
}

/** Módulo de exportación configurable para las pruebas. */
class FakeExportModule implements ExportModule {
  constructor(private readonly outcome: MarkdownDocument | ExportError) {}
  async exportMarkdown(): Promise<MarkdownDocument | ExportError> {
    return this.outcome;
  }
}

function makeResult(id: string): AnalysisResult {
  return {
    id,
    jobId: 'job-x',
    primaryLanguage: 'TYPESCRIPT',
    secondaryLanguages: [],
    analysisMode: 'SOLO_ESTATICO',
    functionalSummary: { summary: '', confidencePct: 0, determined: false },
    keyComponents: [],
    architecture: { type: null, confidencePct: 0, determined: false, evidence: '' },
    additionalFindings: {
      vulnerabilities: { status: 'SIN_HALLAZGOS', items: [] },
      outdatedDependencies: { status: 'SIN_HALLAZGOS', items: [] },
      apiEndpoints: { status: 'SIN_HALLAZGOS', items: [] },
    },
    configReadNotes: [],
    notices: [],
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Arranque del servidor de prueba
// ---------------------------------------------------------------------------

interface TestContext {
  baseUrl: string;
  token: string;
  jobs: InMemoryJobRepository;
  results: InMemoryResultRepository;
  queue: RecordingQueue;
  storage: InMemoryTransientStorage;
  close: () => Promise<void>;
}

interface StartOptions {
  exportOutcome?: MarkdownDocument | ExportError;
}

async function startServer(options: StartOptions = {}): Promise<TestContext> {
  const user = makeUser('ana', 'clave-secreta');
  const authService = new DefaultAuthService(new InMemoryUserStore([user]));
  const jobs = new InMemoryJobRepository();
  const results = new InMemoryResultRepository();
  const queue = new RecordingQueue();
  const storage = new InMemoryTransientStorage();
  const exportModule = new FakeExportModule(
    options.exportOutcome ?? {
      kind: 'MARKDOWN_DOCUMENT',
      content: '# doc',
      filename: 'repo-analysis.md',
      mediaType: 'text/markdown',
    },
  );

  const analysisDeps: AnalysisDependencies = {
    jobRepository: jobs,
    resultRepository: results,
    analysisQueue: queue,
    transientStorage: storage,
    exportModule,
  };
  const analysisRouter = createAnalysisRouter(analysisDeps);
  const router = createApiRouter({
    authService,
    preferenceRepository: new InMemoryPreferenceRepository(),
    analysisRouter,
  });
  const server = createServer(router);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Sesión válida para las rutas protegidas.
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'clave-secreta' }),
  });
  const { token } = (await loginRes.json()) as { token: string };

  return {
    baseUrl,
    token,
    jobs,
    results,
    queue,
    storage,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

describe('POST /analyses (Req 1.1, 1.2, 15.1, 12.2, 12.3)', () => {
  it('con un ZIP responde 202 con jobId, deposita el ZIP en transitorio y encola (Req 12.2, 12.3, 1.1)', async () => {
    const ctx = await startServer();
    try {
      const zipBase64 = Buffer.from('contenido-zip-de-prueba').toString('base64');
      const res = await fetch(`${ctx.baseUrl}/analyses`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
        body: JSON.stringify({ zip: zipBase64, useAI: false }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { status: string; jobId: string };
      expect(body.status).toBe('aceptado');
      expect(typeof body.jobId).toBe('string');

      // El job se creó como EN_COLA (procesamiento asíncrono, no bloqueante).
      const job = ctx.jobs.jobs.get(body.jobId);
      expect(job?.status).toBe('EN_COLA');
      expect(job?.inputSource).toBe('ZIP');
      // El job se encoló para el worker en segundo plano (Req 12.2).
      expect(ctx.queue.enqueued.map((j) => j.id)).toContain(body.jobId);
      // El ZIP se depositó en el espacio transitorio del job (Req 1.1, 2.2).
      const stored = ctx.storage.spaces.get(body.jobId);
      expect(stored?.has(UPLOADED_ZIP_PATH)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('con una URL de GitHub válida responde 202 y guarda sourceUrl como metadato (Req 15.1)', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
        body: JSON.stringify({ url: 'https://github.com/owner/repo' }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { jobId: string };
      const job = ctx.jobs.jobs.get(body.jobId);
      expect(job?.inputSource).toBe('GITHUB_URL');
      expect(job?.sourceUrl).toBe('https://github.com/owner/repo');
      // Para URL de GitHub no se deposita ningún ZIP en transitorio desde la API.
      expect(ctx.storage.spaces.get(body.jobId)).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });

  it('sin ninguna entrada responde 400 y no crea job ni encola (Req 1.2, Property 1)', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
        body: JSON.stringify({ useAI: true }),
      });
      expect(res.status).toBe(400);
      expect(ctx.jobs.jobs.size).toBe(0);
      expect(ctx.queue.enqueued.length).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('con ambas entradas (ZIP y URL) responde 400 y no crea job (Req 1.2, Property 1)', async () => {
    const ctx = await startServer();
    try {
      const zipBase64 = Buffer.from('x').toString('base64');
      const res = await fetch(`${ctx.baseUrl}/analyses`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
        body: JSON.stringify({ zip: zipBase64, url: 'https://github.com/owner/repo' }),
      });
      expect(res.status).toBe(400);
      expect(ctx.jobs.jobs.size).toBe(0);
      expect(ctx.queue.enqueued.length).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('con una URL de GitHub mal formada responde 400 y no inicia el análisis (Req 15.5, Property 32)', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
        body: JSON.stringify({ url: 'https://gitlab.com/owner/repo' }),
      });
      expect(res.status).toBe(400);
      expect(ctx.jobs.jobs.size).toBe(0);
      expect(ctx.queue.enqueued.length).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('sin sesión válida deniega el acceso con 401 (Req 13.1)', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/owner/repo' }),
      });
      expect(res.status).toBe(401);
      expect(ctx.jobs.jobs.size).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});

describe('GET /analyses/{id}/status (Req 12.1, 12.4)', () => {
  it('devuelve el progreso/etapa/estado de un job existente', async () => {
    const ctx = await startServer();
    try {
      await ctx.jobs.create({
        id: 'job-42',
        userId: 'user-1',
        status: 'EN_PROGRESO',
        progress: 40,
        stage: 'ANALISIS_ESTATICO',
        useAIRequested: false,
        inputSource: 'ZIP',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const res = await fetch(`${ctx.baseUrl}/analyses/job-42/status`, {
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        jobStatus: string;
        progress: number;
        stage: string;
      };
      expect(body.jobStatus).toBe('EN_PROGRESO');
      expect(body.progress).toBe(40);
      expect(body.stage).toBe('ANALISIS_ESTATICO');
    } finally {
      await ctx.close();
    }
  });

  it('devuelve 404 "no encontrado" cuando el job no existe', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses/inexistente/status`, {
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('no_encontrado');
    } finally {
      await ctx.close();
    }
  });
});

describe('GET /analyses/{id} (Req 2.3, 2.5)', () => {
  it('devuelve el resultado persistido', async () => {
    const ctx = await startServer();
    try {
      await ctx.results.save(makeResult('res-1'));
      const res = await fetch(`${ctx.baseUrl}/analyses/res-1`, {
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: AnalysisResult };
      expect(body.result.id).toBe('res-1');
    } finally {
      await ctx.close();
    }
  });

  it('devuelve 404 "no encontrado" cuando el id no existe (Req 2.5)', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses/no-existe`, {
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('no_encontrado');
    } finally {
      await ctx.close();
    }
  });
});

describe('POST /analyses/{id}/export (Req 11.1, 11.3, 2.5)', () => {
  it('solicita la exportación a Markdown del resultado persistido (Req 11.1)', async () => {
    const ctx = await startServer();
    try {
      await ctx.results.save(makeResult('res-2'));
      const res = await fetch(`${ctx.baseUrl}/analyses/res-2/export`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        filename: string;
        mediaType: string;
        content: string;
      };
      expect(body.mediaType).toBe('text/markdown');
      expect(body.content).toContain('# doc');
    } finally {
      await ctx.close();
    }
  });

  it('devuelve 404 cuando el resultado no existe (Req 2.5)', async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/analyses/ausente/export`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(404);
    } finally {
      await ctx.close();
    }
  });

  it('traduce un resultado vacío de exportación a 422 (Req 11.3)', async () => {
    const ctx = await startServer({
      exportOutcome: {
        kind: 'EXPORT_ERROR',
        reason: 'RESULTADO_VACIO',
        message: 'No hay resultado.',
      },
    });
    try {
      await ctx.results.save(makeResult('res-3'));
      const res = await fetch(`${ctx.baseUrl}/analyses/res-3/export`, {
        method: 'POST',
        headers: authHeaders(ctx.token),
      });
      expect(res.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });
});
