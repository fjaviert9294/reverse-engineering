/**
 * `AnalysisOrchestrator.run` — pipeline asíncrono de análisis (Task 14.2).
 *
 * El worker in-process (Task 14.1) consume cada job encolado e invoca
 * `run(jobId)`, que ejecuta el pipeline del diseño (sección "Orquestador de jobs
 * (cola / worker)"):
 *
 *   Ingesta -> Análisis Estático -> [Inferencia IA] -> Persistir -> Descartar
 *
 * Responsabilidades y trazabilidad de requisitos:
 *
 * - **Progreso en tiempo real (Requisito 12.1)**: el orquestador actualiza el
 *   progreso/etapa del job al iniciar cada etapa y, además, refresca el progreso
 *   de forma periódica (por debajo de los 2 s) mientras una etapa está en curso,
 *   de modo que la cadencia "al menos cada 2 s" se mantiene aun cuando una etapa
 *   tarde más que ese intervalo.
 * - **Finalización al 100% (Requisito 12.4)**: al completar con éxito, el job se
 *   marca `COMPLETADO`, etapa `FINALIZADO` y progreso `100`.
 * - **Descarte del código en éxito o fallo (Requisitos 1.5, 15.4)**: el código
 *   extraído se descarta SIEMPRE al terminar, tanto si el análisis tiene éxito
 *   como si cualquier etapa falla.
 * - **Aislamiento de fallos por módulo (Requisitos 12.5, 14.6)**: si una etapa
 *   falla, el orquestador detiene el pipeline en ese punto, deja de actualizar el
 *   progreso, marca el job `FALLIDO` identificando el módulo afectado
 *   (`errorModule` vía `JobRepository.setStatus`), y no altera otros datos del
 *   usuario (no se persiste ningún resultado parcial), preservando su estado
 *   previo. Los resultados de módulos ya completados sobreviven en memoria hasta
 *   ese punto; nada parcial se persiste, de modo que los datos previos del usuario
 *   quedan intactos.
 *
 * IMPORTANTE (Requisito 2.2): el orquestador solo mueve metadatos y resultados
 * entre módulos; el contenido del código fuente vive exclusivamente en el
 * almacenamiento transitorio y se descarta al final. El `AnalysisResult` que se
 * persiste no contiene código fuente.
 *
 * DECISIONES ABIERTAS: el orquestador depende solo de abstracciones ya definidas
 * (módulos de ingesta/análisis/IA, repositorios, lectura de contenido
 * transitorio). No fija la tecnología de cola, de almacenamiento transitorio ni
 * del proveedor de IA; todas se inyectan detrás de sus interfaces.
 */

import type {
  AnalysisJob,
  AnalysisResult,
  AnalysisStage,
  ModuleError,
} from '../domain/index.js';
import type { JobRepository, AnalysisResultRepository } from '../persistence/index.js';
import {
  IngestionError,
  type ExtractedRepo,
  type IngestionModule,
  type UploadedZip,
} from '../ingestion/index.js';
import { runStaticAnalysis, type ConfigContentReader } from '../analysis/index.js';
import type { AICodeFile, AIInferenceModule } from '../ai/index.js';
import { integrateAIFindings } from '../ai/index.js';

/**
 * Identificadores de módulo usados para identificar el módulo afectado ante un
 * fallo (Requisito 14.6). Coinciden conceptualmente con las etapas del pipeline.
 */
export type PipelineModule =
  | 'INGESTA'
  | 'ANALISIS_ESTATICO'
  | 'INFERENCIA_IA'
  | 'PERSISTENCIA';

/**
 * Error interno del pipeline que acota el fallo a un módulo concreto. Permite al
 * orquestador identificar el módulo afectado al marcar el job como fallido
 * (Requisito 14.6). No transporta código fuente.
 */
export class PipelineError extends Error {
  readonly module: PipelineModule;
  override readonly cause?: unknown;

  constructor(module: PipelineModule, message: string, cause?: unknown) {
    super(message);
    this.name = 'PipelineError';
    this.module = module;
    this.cause = cause;
  }
}

/**
 * Puerto de lectura del contenido del código extraído dentro del espacio
 * transitorio de un job. El almacenamiento transitorio (`TransientStorage`)
 * expone escritura/listado/descarte pero no lectura; el orquestador necesita leer
 * el contenido de los archivos de configuración (para el análisis estático) y del
 * código candidato (para la inferencia por IA). Este puerto se mantiene agnóstico
 * a la tecnología de almacenamiento (decisión abierta del diseño) y se inyecta,
 * de modo que pueda respaldarse con el adaptador de sistema de archivos por
 * defecto o sustituirse en pruebas.
 *
 * Debe ser tolerante a fallos: ante cualquier problema de lectura debe devolver
 * `null` en lugar de lanzar, de forma coherente con `ConfigContentReader`
 * (Requisito 5.7).
 */
export type TransientContentReader = (
  jobId: string,
  relativePath: string,
) => Promise<string | null>;

/** Genera identificadores y marcas de tiempo (inyectable para pruebas deterministas). */
export interface OrchestratorClock {
  /** Identificador único para el `AnalysisResult`. */
  newId(): string;
  /** Marca de tiempo ISO-8601 actual. */
  now(): string;
}

/** Contrato del orquestador de jobs (sección "Orquestador de jobs" del diseño). */
export interface AnalysisOrchestrator {
  /**
   * Ejecuta el pipeline completo para el job indicado. Nunca lanza: los fallos se
   * traducen en el estado `FALLIDO` del job con el módulo afectado, y el código
   * transitorio se descarta en cualquier caso (Requisitos 12.5, 14.6, 1.5, 15.4).
   */
  run(jobId: string): Promise<void>;
}

/** Dependencias del orquestador (todas detrás de interfaces / decisiones abiertas). */
export interface AnalysisOrchestratorOptions {
  jobRepository: JobRepository;
  resultRepository: AnalysisResultRepository;
  ingestion: IngestionModule;
  ai: AIInferenceModule;
  /** Lee el contenido de un archivo del espacio transitorio del job. */
  readContent: TransientContentReader;
  /** Generador de identidad/tiempo del resultado; por defecto usa `crypto`/`Date`. */
  clock?: OrchestratorClock;
  /**
   * Intervalo (ms) del refresco periódico de progreso mientras una etapa está en
   * curso. Debe ser < 2000 ms para garantizar la cadencia del Requisito 12.1. Por
   * defecto, 1500 ms.
   */
  progressTickMs?: number;
}

/**
 * Progreso (%) asociado al INICIO de cada etapa. Al entrar en una etapa se fija
 * su progreso base; el ticker periódico mantiene ese valor refrescado hasta la
 * siguiente etapa. Al completar con éxito se fija 100 (Requisito 12.4).
 */
const STAGE_PROGRESS: Readonly<Record<AnalysisStage, number>> = {
  INGESTA: 10,
  ANALISIS_ESTATICO: 40,
  INFERENCIA_IA: 70,
  PERSISTENCIA: 90,
  FINALIZADO: 100,
};

/** Intervalo por defecto del refresco periódico de progreso (< 2 s, Requisito 12.1). */
const DEFAULT_PROGRESS_TICK_MS = 1500;

/** Reloj por defecto: `crypto.randomUUID()` + `Date`. */
const DEFAULT_CLOCK: OrchestratorClock = {
  newId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/**
 * Implementación del orquestador. Ejecuta el pipeline asíncrono aislando fallos
 * por módulo y garantizando el descarte del código extraído.
 */
export class DefaultAnalysisOrchestrator implements AnalysisOrchestrator {
  private readonly jobs: JobRepository;
  private readonly results: AnalysisResultRepository;
  private readonly ingestion: IngestionModule;
  private readonly ai: AIInferenceModule;
  private readonly readContent: TransientContentReader;
  private readonly clock: OrchestratorClock;
  private readonly progressTickMs: number;

  constructor(options: AnalysisOrchestratorOptions) {
    this.jobs = options.jobRepository;
    this.results = options.resultRepository;
    this.ingestion = options.ingestion;
    this.ai = options.ai;
    this.readContent = options.readContent;
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.progressTickMs = options.progressTickMs ?? DEFAULT_PROGRESS_TICK_MS;
  }

  /**
   * Ejecuta el pipeline para `jobId`. Recupera el job, ejecuta las etapas en
   * orden, persiste el resultado y descarta el código. Cualquier fallo se acota
   * al módulo y marca el job `FALLIDO`; el descarte del código ocurre siempre.
   */
  async run(jobId: string): Promise<void> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      // Sin job no hay nada que orquestar; el llamador (worker) ya opera sobre
      // un job encolado, este caso solo protege ante estados inconsistentes.
      return;
    }

    // Referencia al repositorio extraído, para poder descartarlo pase lo que pase
    // (éxito o fallo), reutilizando la ingesta (Requisitos 1.5, 15.4).
    let repo: ExtractedRepo | null = null;
    // Ticker de refresco de progreso de la etapa en curso (Requisito 12.1).
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let currentProgress = job.progress;

    /** Fija la etapa y su progreso base, y arranca el refresco periódico. */
    const enterStage = async (stage: AnalysisStage): Promise<void> => {
      currentProgress = STAGE_PROGRESS[stage];
      stopTicker();
      await this.safeUpdateProgress(jobId, currentProgress, stage);
      // Refresco periódico (< 2 s) mientras dure la etapa: mantiene la cadencia
      // del Requisito 12.1 incluso si la etapa se prolonga.
      progressTimer = setInterval(() => {
        void this.safeUpdateProgress(jobId, currentProgress, stage);
      }, this.progressTickMs);
      // No mantener vivo el proceso solo por el ticker.
      (progressTimer as { unref?: () => void }).unref?.();
    };

    const stopTicker = (): void => {
      if (progressTimer !== null) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    };

    try {
      // Job en progreso desde el arranque del pipeline.
      await this.jobs.setStatus(jobId, 'EN_PROGRESO');

      // 1) INGESTA: obtener y extraer el código a almacenamiento transitorio.
      await enterStage('INGESTA');
      repo = await this.runIngestion(job);

      // 2) ANÁLISIS ESTÁTICO: fuente siempre disponible; produce el resultado base.
      await enterStage('ANALISIS_ESTATICO');
      let result = await this.runStaticAnalysisStage(repo, job);

      // 3) INFERENCIA IA (opcional): enriquece o degrada con elegancia.
      await enterStage('INFERENCIA_IA');
      result = await this.runAIStage(result, repo, job);

      // 4) PERSISTIR: guardar el `AnalysisResult` (nunca contiene código fuente).
      await enterStage('PERSISTENCIA');
      await this.runPersistenceStage(result);

      // Éxito: detener refresco, marcar COMPLETADO y progreso 100 (Requisito 12.4).
      stopTicker();
      await this.safeUpdateProgress(jobId, 100, 'FINALIZADO');
      await this.jobs.setStatus(jobId, 'COMPLETADO');
    } catch (error) {
      // Fallo aislado por módulo: detener el progreso e identificar el módulo
      // afectado, sin alterar otros datos del usuario (Requisitos 12.5, 14.6).
      stopTicker();
      const moduleError = toModuleError(error);
      await this.jobs.setStatus(jobId, 'FALLIDO', moduleError);
    } finally {
      // Detener el refresco en cualquier caso y DESCARTAR el código extraído,
      // tanto en éxito como en fallo (Requisitos 1.5, 15.4).
      stopTicker();
      if (repo !== null) {
        await this.safeDiscard(repo);
      }
    }
  }

  /**
   * Etapa de INGESTA: si el origen es una `URL_GitHub`, descarga el ZIP; en ambos
   * casos extrae al almacenamiento transitorio. Un `IngestionError` (o cualquier
   * fallo) se acota al módulo `INGESTA` (Requisito 14.6).
   */
  private async runIngestion(job: AnalysisJob): Promise<ExtractedRepo> {
    try {
      let zip: UploadedZip;
      if (job.inputSource === 'GITHUB_URL') {
        if (!job.sourceUrl) {
          throw new PipelineError('INGESTA', 'El job de origen GitHub no tiene URL de origen.');
        }
        const fetched = await this.ingestion.fetchFromGitHub(job.sourceUrl);
        if (fetched instanceof IngestionError) {
          throw new PipelineError('INGESTA', fetched.message, fetched);
        }
        // La identidad del job la fija el orquestador antes de extraer.
        zip = { ...fetched, jobId: job.id };
      } else {
        // El ZIP subido se materializa en el espacio transitorio por la capa API
        // antes de encolar; aquí lo leemos como bytes del propio espacio. Cuando
        // no hay bytes en línea, la ingesta ya habrá dejado el ZIP disponible en
        // el flujo de la API. Para el pipeline reutilizamos el mismo `extract`.
        const content = await this.loadUploadedZip(job.id);
        if (content === null) {
          throw new PipelineError(
            'INGESTA',
            'No se encontró el contenido del ZIP subido para el job.',
          );
        }
        zip = { jobId: job.id, content };
      }

      const extracted = await this.ingestion.extract(zip);
      if (extracted instanceof IngestionError) {
        throw new PipelineError('INGESTA', extracted.message, extracted);
      }
      return extracted;
    } catch (error) {
      throw wrapAsPipelineError(error, 'INGESTA');
    }
  }

  /**
   * Carga los bytes del ZIP subido desde el espacio transitorio del job. La capa
   * API deposita el ZIP subido en el espacio del job bajo `upload.zip` antes de
   * encolar. Devuelve `null` si no está disponible.
   */
  private async loadUploadedZip(jobId: string): Promise<Uint8Array | null> {
    const content = await this.readContent(jobId, UPLOADED_ZIP_PATH);
    if (content === null) {
      return null;
    }
    return Buffer.from(content, 'binary');
  }

  /**
   * Etapa de ANÁLISIS ESTÁTICO: ejecuta el pipeline heurístico y ensambla el
   * `AnalysisResult` base (`SOLO_ESTATICO`). Cualquier fallo se acota al módulo
   * `ANALISIS_ESTATICO` (Requisito 14.6).
   */
  private async runStaticAnalysisStage(
    repo: ExtractedRepo,
    job: AnalysisJob,
  ): Promise<AnalysisResult> {
    try {
      const readConfig: ConfigContentReader = (relativePath) =>
        this.readContent(repo.jobId, relativePath);
      // El identificador del resultado coincide con el del job para que el flujo
      // de consulta use un único `{id}`: el cliente sondea el estado por `jobId`
      // (`GET /analyses/{id}/status`) y recupera el resultado con el mismo
      // identificador (`GET /analyses/{id}`), como refleja el diagrama de
      // secuencia del diseño. El generador de identidad se conserva para la marca
      // de tiempo y para posibles resultados sin job asociado.
      return await runStaticAnalysis(repo, readConfig, {
        id: job.id,
        jobId: job.id,
        createdAt: this.clock.now(),
      });
    } catch (error) {
      throw wrapAsPipelineError(error, 'ANALISIS_ESTATICO');
    }
  }

  /**
   * Etapa opcional de INFERENCIA IA: cuando el usuario solicitó IA, invoca el
   * módulo y integra el resultado (superconjunto del estático) o degrada con
   * elegancia; cuando no la solicitó, se mantiene `SOLO_ESTATICO`. La degradación
   * (IA no disponible/falla/no permitida) NO es un fallo del pipeline: se refleja
   * en `notices` sin detener el análisis (Requisitos 3.4, 3.6, 14.5). Solo un
   * error inesperado de integración se acota al módulo `INFERENCIA_IA`.
   */
  private async runAIStage(
    staticResult: AnalysisResult,
    repo: ExtractedRepo,
    job: AnalysisJob,
  ): Promise<AnalysisResult> {
    try {
      // Sin solicitud de IA: se conserva el resultado estático tal cual.
      if (!job.useAIRequested) {
        return staticResult;
      }

      const code = await this.loadCandidateCode(repo);
      const outcome = await this.ai.infer(
        {
          jobId: job.id,
          primaryLanguage: staticResult.primaryLanguage,
          code,
        },
        // `privacyEnabled`: el envío de código solo procede si el usuario habilitó
        // el uso de IA para este análisis (Requisitos 4.1-4.4). El módulo de IA
        // aplica la abstinencia y la degradación elegante internamente.
        job.useAIRequested,
      );
      return integrateAIFindings(staticResult, outcome);
    } catch (error) {
      throw wrapAsPipelineError(error, 'INFERENCIA_IA');
    }
  }

  /**
   * Carga el código candidato a enviar a la IA leyendo el contenido de los
   * archivos del repositorio extraído desde el almacenamiento transitorio. Solo
   * incluye archivos cuyo contenido pudo leerse; nunca lanza (los fallos de
   * lectura se omiten). El envío efectivo lo decide el módulo de IA según la
   * privacidad (Requisito 4.3).
   */
  private async loadCandidateCode(repo: ExtractedRepo): Promise<AICodeFile[]> {
    const code: AICodeFile[] = [];
    for (const file of repo.files) {
      const content = await this.readContent(repo.jobId, file.path);
      if (content !== null) {
        code.push({ path: file.path, content });
      }
    }
    return code;
  }

  /**
   * Etapa de PERSISTENCIA: guarda el `AnalysisResult`. Un fallo de guardado
   * conserva los datos previos (transacción atómica en el repositorio) y se acota
   * al módulo `PERSISTENCIA` (Requisitos 2.4, 14.6).
   */
  private async runPersistenceStage(result: AnalysisResult): Promise<void> {
    try {
      await this.results.save(result);
    } catch (error) {
      throw wrapAsPipelineError(error, 'PERSISTENCIA');
    }
  }

  /**
   * Actualiza el progreso sin propagar errores: un fallo transitorio al escribir
   * el progreso (p. ej. el ticker) no debe abortar el pipeline ni enmascarar el
   * resultado del análisis. El invariante de rango/etapa lo garantiza el
   * repositorio (Requisito 12.1).
   */
  private async safeUpdateProgress(
    jobId: string,
    progress: number,
    stage: AnalysisStage,
  ): Promise<void> {
    try {
      await this.jobs.updateProgress(jobId, progress, stage);
    } catch {
      // Best-effort: el progreso es informativo; su fallo no detiene el análisis.
    }
  }

  /**
   * Descarta el código extraído sin propagar errores de descarte, para no
   * enmascarar el resultado del pipeline. El descarte es idempotente en el módulo
   * de ingesta (Requisitos 1.5, 15.4).
   */
  private async safeDiscard(repo: ExtractedRepo): Promise<void> {
    try {
      await this.ingestion.discard(repo);
    } catch {
      // Best-effort: la limpieza no debe alterar el estado terminal del job.
    }
  }
}

/**
 * Ruta convenida donde la capa API deposita el ZIP subido dentro del espacio
 * transitorio del job antes de encolar, de modo que el pipeline lo lea con el
 * mismo `readContent` que el resto del código extraído.
 */
export const UPLOADED_ZIP_PATH = 'upload.zip';

/** Convierte un error arbitrario en `PipelineError` acotado a `module`. */
function wrapAsPipelineError(error: unknown, module: PipelineModule): PipelineError {
  if (error instanceof PipelineError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new PipelineError(module, message, error);
}

/** Traduce un error del pipeline al `ModuleError` que identifica el módulo afectado. */
function toModuleError(error: unknown): ModuleError {
  if (error instanceof PipelineError) {
    return { module: error.module, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { module: 'DESCONOCIDO', message };
}
