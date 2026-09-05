/**
 * Endpoints de análisis de la capa API/Auth de Repo-Analyzer (Task 15.2).
 *
 * Expone los endpoints del ciclo de vida de un análisis, todos detrás del
 * middleware de sesión (rutas protegidas, Requisito 13.1):
 *
 * - `POST /analyses` — recibe EXACTAMENTE una de las dos entradas admitidas (un
 *   archivo ZIP subido o una `URL_GitHub`) junto con las opciones (`useAI`);
 *   crea el job, deja el ZIP subido en el almacenamiento transitorio del job,
 *   encola el job para su procesamiento ASÍNCRONO en segundo plano y responde
 *   `202` con `{ jobId }` SIN bloquear al usuario (Requisitos 1.1, 1.2, 15.1,
 *   12.2, 12.3). Si no se aporta ninguna entrada, o se aportan ambas, se rechaza
 *   con `400` sin crear el job (Requisito 1.2, Property 1). Una `URL_GitHub` mal
 *   formada o ajena a GitHub se rechaza con `400` y NO inicia el análisis
 *   (Requisito 15.5, Property 32).
 * - `GET /analyses/{id}/status` — devuelve el estado/progreso/etapa del job
 *   (Requisitos 12.1, 12.4); "no encontrado" si el job no existe.
 * - `GET /analyses/{id}` — devuelve el `Resultado_Analisis` persistido; "no
 *   encontrado" si el identificador no existe (Requisitos 2.3, 2.5).
 * - `POST /analyses/{id}/export` — solicita la exportación a Markdown del
 *   resultado persistido (Requisito 11.1).
 *
 * El router depende SOLO de abstracciones ya definidas (repositorios, cola de
 * análisis, ingesta, almacenamiento transitorio, exportación), de modo que los
 * respaldos concretos se inyectan y pueden sustituirse en pruebas. No fija
 * ninguna decisión abierta (cola/almacenamiento/descarga de GitHub): consume sus
 * interfaces.
 *
 * INVARIANTE (Requisito 2.2): el código fuente es transitorio. El ZIP subido se
 * deposita en el almacenamiento efímero del job (nunca en la base de datos) y el
 * job solo guarda metadatos operativos; `sourceUrl` es un metadato de origen, no
 * código fuente (Requisito 15.1).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AnalysisJob, InputSource, Session } from '../domain/index.js';
import type { JobRepository, AnalysisResultRepository } from '../persistence/index.js';
import type { AnalysisQueue } from '../orchestration/index.js';
import { UPLOADED_ZIP_PATH } from '../orchestration/index.js';
import type { TransientStorage } from '../storage/index.js';
import type { ExportModule } from '../export/index.js';
import { isValidGitHubUrl } from '../ingestion/index.js';
import { readJsonBody, sendError, sendJson, BodyParseError } from './http-helpers.js';

/**
 * Puertos de persistencia y servicios que consumen los endpoints de análisis.
 * Todos son abstracciones satisfechas por implementaciones existentes
 * (`SqlJobRepository`, `SqlAnalysisResultRepository`, `InProcessAnalysisQueue`,
 * `FsTransientStorage`, `markdownExportModule`).
 */
export interface AnalysisDependencies {
  jobRepository: JobRepository;
  resultRepository: AnalysisResultRepository;
  analysisQueue: AnalysisQueue;
  /** Almacenamiento transitorio donde se deposita el ZIP subido antes de encolar. */
  transientStorage: TransientStorage;
  exportModule: ExportModule;
  /** Generador de identidad/tiempo del job (inyectable para pruebas deterministas). */
  clock?: AnalysisClock;
}

/** Genera identificadores y marcas de tiempo de los jobs. */
export interface AnalysisClock {
  newId(): string;
  now(): string;
}

/** Reloj por defecto: `crypto.randomUUID()` + `Date`. */
const DEFAULT_CLOCK: AnalysisClock = {
  newId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/**
 * Cuerpo esperado de `POST /analyses`. Se admite exactamente una de las dos
 * entradas: `zip` (contenido del ZIP en base64) o `url` (`URL_GitHub`).
 * `useAI` es opcional y por defecto `false` (privacidad por defecto).
 */
interface CreateAnalysisBody {
  zip?: unknown;
  url?: unknown;
  useAI?: unknown;
}

/** Manejador de rutas de análisis: atiende la petición o devuelve `false`. */
export type AnalysisRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
) => Promise<boolean>;

/**
 * Extrae el segmento `{id}` de las rutas `/analyses/{id}` y `/analyses/{id}/...`.
 * Devuelve `null` si la ruta no encaja con el prefijo de análisis.
 */
function matchAnalysisPath(
  path: string,
): { id: string; suffix: string } | null {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length < 2 || segments[0] !== 'analyses') {
    return null;
  }
  const id = decodeURIComponent(segments[1] ?? '');
  const suffix = segments.slice(2).join('/');
  return { id, suffix };
}

/**
 * Crea el manejador de rutas de análisis. Devuelve una función que atiende las
 * rutas `/analyses...` (ya autenticadas por el llamador) o resuelve a `false` si
 * la ruta/método no corresponde a un endpoint de análisis.
 */
export function createAnalysisRouter(deps: AnalysisDependencies): AnalysisRouteHandler {
  const {
    jobRepository,
    resultRepository,
    analysisQueue,
    transientStorage,
    exportModule,
  } = deps;
  const clock = deps.clock ?? DEFAULT_CLOCK;

  /**
   * `POST /analyses`: valida la entrada (exactamente ZIP o URL), crea el job,
   * deposita el ZIP subido en el almacenamiento transitorio y encola el job para
   * su procesamiento en segundo plano. Responde `202` con `{ jobId }` sin
   * ejecutar el pipeline (no bloquea al usuario, Requisitos 12.2, 12.3).
   */
  async function handleCreate(
    req: IncomingMessage,
    res: ServerResponse,
    session: Session,
  ): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err instanceof BodyParseError) {
        sendError(res, 400, 'peticion_invalida', err.message);
        return;
      }
      throw err;
    }

    const { zip, url, useAI } = (body ?? {}) as CreateAnalysisBody;

    const hasZip = typeof zip === 'string' && zip.length > 0;
    const hasUrl = typeof url === 'string' && url.trim().length > 0;

    // Solo se aceptan los métodos de entrada admitidos, y EXACTAMENTE uno de
    // ellos (Requisito 1.2, Property 1). Ni ninguno ni ambos.
    if (hasZip === hasUrl) {
      sendError(
        res,
        400,
        'entrada_invalida',
        'Debe aportar exactamente una entrada: un archivo ZIP o una URL de GitHub.',
      );
      return;
    }

    // `useAI` es opcional; si viene, debe ser booleano. Por defecto, false
    // (privacidad por defecto, Requisito 4.2).
    let useAIRequested = false;
    if (useAI !== undefined) {
      if (typeof useAI !== 'boolean') {
        sendError(
          res,
          400,
          'peticion_invalida',
          'El campo "useAI" debe ser booleano.',
        );
        return;
      }
      useAIRequested = useAI;
    }

    const inputSource: InputSource = hasUrl ? 'GITHUB_URL' : 'ZIP';

    // Validación temprana de la `URL_GitHub`: una URL mal formada o ajena a
    // GitHub se rechaza y NO inicia el análisis (Requisito 15.5, Property 32).
    // Los fallos de repo inaccesible/privado o de red se detectan de forma
    // asíncrona durante la ingesta (Requisitos 15.6, 15.7).
    if (inputSource === 'GITHUB_URL' && !isValidGitHubUrl((url as string).trim())) {
      sendError(
        res,
        400,
        'url_github_invalida',
        'La URL de GitHub está mal formada o no corresponde a un repositorio de GitHub.',
      );
      return;
    }

    const jobId = clock.newId();
    const now = clock.now();

    // Para el ZIP subido: se deposita su contenido en el espacio transitorio del
    // job ANTES de encolar, en la ruta convenida que el orquestador lee para la
    // ingesta (nunca se persiste en base de datos; Requisitos 2.2, 1.1). El ZIP
    // llega en base64 dentro del cuerpo JSON.
    if (inputSource === 'ZIP') {
      let content: Buffer;
      try {
        content = Buffer.from(zip as string, 'base64');
      } catch {
        sendError(res, 400, 'entrada_invalida', 'El contenido del ZIP no es base64 válido.');
        return;
      }
      if (content.length === 0) {
        sendError(res, 400, 'entrada_invalida', 'El archivo ZIP está vacío.');
        return;
      }
      await transientStorage.createJobSpace(jobId);
      await transientStorage.writeFile(jobId, UPLOADED_ZIP_PATH, content);
    }

    const job: AnalysisJob = {
      id: jobId,
      userId: session.userId,
      status: 'EN_COLA',
      progress: 0,
      stage: 'INGESTA',
      useAIRequested,
      inputSource,
      createdAt: now,
      updatedAt: now,
    };
    if (inputSource === 'GITHUB_URL') {
      // `sourceUrl` es metadato de origen, NUNCA código fuente (Requisito 15.1).
      job.sourceUrl = (url as string).trim();
    }

    await jobRepository.create(job);

    // Procesamiento asíncrono: se encola el job y se responde de inmediato. El
    // worker in-process ejecuta el pipeline en segundo plano (Requisitos 12.2,
    // 12.3). `enqueue` no bloquea al llamante con la ejecución del pipeline.
    await analysisQueue.enqueue(job);

    sendJson(res, 202, { status: 'aceptado', jobId });
  }

  /**
   * `GET /analyses/{id}/status`: devuelve el progreso/etapa/estado del job
   * (Requisitos 12.1, 12.4). "No encontrado" si el job no existe.
   */
  async function handleStatus(res: ServerResponse, id: string): Promise<void> {
    const job = await jobRepository.findById(id);
    if (job === null) {
      sendError(res, 404, 'no_encontrado', 'No se encontró el análisis solicitado.');
      return;
    }
    sendJson(res, 200, {
      status: 'ok',
      jobId: job.id,
      jobStatus: job.status,
      progress: job.progress,
      stage: job.stage,
      errorModule: job.errorModule ?? null,
    });
  }

  /**
   * `GET /analyses/{id}`: devuelve el `Resultado_Analisis` persistido. Devuelve
   * "no encontrado" cuando el identificador no existe (Requisitos 2.3, 2.5).
   */
  async function handleGetResult(res: ServerResponse, id: string): Promise<void> {
    const result = await resultRepository.findById(id);
    if (result === null) {
      sendError(res, 404, 'no_encontrado', 'No se encontró el resultado de análisis solicitado.');
      return;
    }
    sendJson(res, 200, { status: 'ok', result });
  }

  /**
   * `POST /analyses/{id}/export`: solicita la exportación a Markdown del
   * resultado persistido (Requisito 11.1). Si el resultado no existe, "no
   * encontrado" (Requisito 2.5); si la exportación se abstiene/falla, se traduce
   * su error a la respuesta (Requisitos 11.3, 11.4).
   */
  async function handleExport(res: ServerResponse, id: string): Promise<void> {
    const result = await resultRepository.findById(id);
    if (result === null) {
      sendError(res, 404, 'no_encontrado', 'No se encontró el resultado de análisis solicitado.');
      return;
    }

    const outcome = await exportModule.exportMarkdown(result);
    if (outcome.kind === 'EXPORT_ERROR') {
      // Resultado vacío -> 422; fallo de generación -> 500. En ambos casos el
      // resultado se conserva sin cambios (Requisitos 11.3, 11.4).
      const statusCode = outcome.reason === 'RESULTADO_VACIO' ? 422 : 500;
      sendError(res, statusCode, 'exportacion_no_disponible', outcome.message);
      return;
    }

    sendJson(res, 200, {
      status: 'ok',
      filename: outcome.filename,
      mediaType: outcome.mediaType,
      content: outcome.content,
    });
  }

  return async function route(
    req: IncomingMessage,
    res: ServerResponse,
    session: Session,
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (method === 'POST' && path === '/analyses') {
      await handleCreate(req, res, session);
      return true;
    }

    const matched = matchAnalysisPath(path);
    if (matched === null) {
      return false;
    }
    const { id, suffix } = matched;

    if (method === 'GET' && suffix === 'status') {
      await handleStatus(res, id);
      return true;
    }
    if (method === 'GET' && suffix === '') {
      await handleGetResult(res, id);
      return true;
    }
    if (method === 'POST' && suffix === 'export') {
      await handleExport(res, id);
      return true;
    }

    return false;
  };
}
