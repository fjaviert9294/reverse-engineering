/**
 * Composition root del monolito modular Repo-Analyzer (Task 18.1).
 *
 * Cablea TODOS los componentes del sistema en una única unidad ejecutable
 * accesible por su punto de entrada (Requisitos 14.1, 14.2):
 *
 *   API/Auth  <-  cola/worker (orquestador)  <-  módulos de dominio
 *   (Ingesta, Análisis Estático, Inferencia IA opcional, Exportación)
 *   +  persistencia  +  almacenamiento transitorio
 *
 * Todo se conecta detrás de interfaces, respetando las decisiones abiertas del
 * diseño (proveedor de IA, mecanismo de cola/almacenamiento transitorio y de
 * descarga de GitHub, base de datos): esta función solo elige los adaptadores por
 * defecto del proceso único y los inyecta.
 *
 * MODULARIDAD CON TOLERANCIA A FALLOS (Requisito 14.1): cada módulo se habilita o
 * deshabilita de forma independiente mediante `AppConfig.modules`. Deshabilitar
 * un módulo NO impide la ejecución de los demás:
 * - Ingesta deshabilitada: los análisis fallan en la etapa de ingesta
 *   identificando el módulo (Requisito 14.6), pero la API, la autenticación, la
 *   consulta de estado/resultados y la exportación siguen operativas.
 * - Inferencia IA deshabilitada: el pipeline continúa en modo solo estático y el
 *   resultado indica que la IA no se aplicó (Requisitos 14.5, 3.6). El resto del
 *   sistema no se ve afectado.
 * - Exportación deshabilitada: el endpoint de exportación devuelve un error
 *   controlado, pero el análisis y el resto de endpoints siguen funcionando.
 *
 * AISLAMIENTO DE FALLOS (Requisito 14.6): el orquestador acota el fallo de un
 * módulo, preserva los resultados de los módulos ya completados y devuelve una
 * indicación de error que identifica el módulo afectado.
 *
 * INVARIANTE (Requisito 2.2): el código fuente es transitorio. Solo el
 * almacenamiento transitorio lo contiene; la persistencia guarda únicamente
 * resultados y metadatos.
 */

import type { Server } from 'node:http';

import { loadConfig, type AppConfig } from './config.js';
import { createServer, type ApiRouter } from './server.js';

// Autenticación
import {
  DefaultAuthService,
  InMemoryUserStore,
  createDevelopmentDemoUser,
  type Clock as AuthClock,
} from './auth/index.js';
import type { StoredUser } from './domain/index.js';

// API / Auth
import { createApiRouter, createAnalysisRouter } from './api/index.js';

// Persistencia (respaldos por defecto en memoria del proceso único)
import {
  InMemoryJobRepository,
  InMemoryAnalysisResultRepository,
  InMemoryPreferenceRepository,
  type JobRepository,
  type AnalysisResultRepository,
  type PreferenceRepository,
} from './persistence/index.js';

// Almacenamiento transitorio
import {
  FsTransientStorage,
  type TransientStorage,
} from './storage/index.js';

// Ingesta
import { TransientIngestionModule, type IngestionModule } from './ingestion/index.js';

// Inferencia IA (opcional)
import {
  DefaultAIInferenceModule,
  type AIInferenceModule,
  type AIProvider,
} from './ai/index.js';

// Exportación
import { markdownExportModule, type ExportModule } from './export/index.js';

// Orquestación (cola + worker + pipeline)
import {
  InProcessAnalysisQueue,
  DefaultAnalysisOrchestrator,
  type AnalysisQueue,
  type TransientContentReader,
} from './orchestration/index.js';

import { createDisabledIngestionModule } from './ingestion/disabled-ingestion-module.js';
import { createDisabledAIInferenceModule } from './ai/disabled-ai-module.js';
import { createDisabledExportModule } from './export/disabled-export-module.js';

/**
 * Dependencias opcionales para sustituir los adaptadores por defecto (útil en
 * pruebas y para inyectar respaldos concretos de las decisiones abiertas, p. ej.
 * un `PgClient` real, un `AIProvider` concreto o un almacenamiento distinto).
 */
export interface CompositionOverrides {
  config?: AppConfig;
  transientStorage?: TransientStorage & {
    readFile(jobId: string, relativePath: string): Promise<string | null>;
  };
  jobRepository?: JobRepository;
  resultRepository?: AnalysisResultRepository;
  preferenceRepository?: PreferenceRepository;
  ingestion?: IngestionModule;
  aiModule?: AIInferenceModule;
  /** Proveedor de IA concreto (decisión abierta #1); se usa si la IA está habilitada. */
  aiProvider?: AIProvider;
  exportModule?: ExportModule;
  authClock?: AuthClock;
  /** Usuarios iniciales del store en memoria (respaldo por defecto). */
  users?: readonly StoredUser[];
  /** Variables de entorno para la resolución del proveedor de IA (Req 4.5). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resultado del cableado: el servidor HTTP listo para escuchar y las piezas
 * principales, expuestas para observabilidad y pruebas.
 */
export interface WiredApplication {
  server: Server;
  config: AppConfig;
  queue: AnalysisQueue;
  router: ApiRouter;
  jobRepository: JobRepository;
  resultRepository: AnalysisResultRepository;
  preferenceRepository: PreferenceRepository;
}

/**
 * Proveedor de IA "nulo": nunca produce hallazgos. Solo se usa cuando la IA está
 * habilitada por configuración pero no se inyecta un `AIProvider` concreto
 * (decisión abierta #1 sin resolver). Fuerza la degradación elegante: el módulo
 * de IA leerá "proveedor no configurado" vía la variable de entorno y, si aun así
 * se invocara, este proveedor no aporta hallazgos.
 */
const NULL_AI_PROVIDER: AIProvider = {
  async infer() {
    // Sin proveedor concreto no hay inferencia; se comporta como indisponible.
    throw new Error('No hay un proveedor de IA concreto configurado.');
  },
};

/**
 * Construye y cablea la aplicación completa a partir de la configuración y de los
 * overrides opcionales. No arranca la escucha del servidor; el llamador decide
 * cuándo `listen` (ver `index.ts`).
 */
export function createApplication(overrides: CompositionOverrides = {}): WiredApplication {
  const env = overrides.env ?? process.env;
  const config = overrides.config ?? loadConfig(env);

  // --- Almacenamiento transitorio (código efímero; se descarta al finalizar) ---
  const transientStorage =
    overrides.transientStorage ?? new FsTransientStorage();
  const readContent: TransientContentReader = (jobId, relativePath) =>
    transientStorage.readFile(jobId, relativePath);

  // --- Persistencia (solo resultados y metadatos; nunca código fuente) ---
  const jobRepository = overrides.jobRepository ?? new InMemoryJobRepository();
  const resultRepository =
    overrides.resultRepository ?? new InMemoryAnalysisResultRepository();
  const preferenceRepository =
    overrides.preferenceRepository ?? new InMemoryPreferenceRepository();

  // --- Módulos de dominio (habilitables/deshabilitables, Requisito 14.1) ---

  // Ingesta: real cuando está habilitada; deshabilitada -> falla acotada a
  // INGESTA sin impedir a los demás (Requisitos 14.1, 14.6).
  const ingestion: IngestionModule =
    overrides.ingestion ??
    (config.modules.ingestion
      ? new TransientIngestionModule(transientStorage)
      : createDisabledIngestionModule());

  // Inferencia IA (opcional): con la IA deshabilitada, el pipeline degrada a solo
  // estático con aviso (Requisitos 14.5, 3.6). Con la IA habilitada, se usa el
  // módulo por defecto detrás de la abstracción de proveedor (decisión abierta #1).
  const aiModule: AIInferenceModule =
    overrides.aiModule ??
    (config.modules.aiInference
      ? new DefaultAIInferenceModule({
          provider: overrides.aiProvider ?? NULL_AI_PROVIDER,
          env,
        })
      : createDisabledAIInferenceModule());

  // Exportación: real cuando está habilitada; deshabilitada -> el endpoint de
  // exportación devuelve un error controlado sin afectar al resto (Requisito 14.1).
  const exportModule: ExportModule =
    overrides.exportModule ??
    (config.modules.export ? markdownExportModule : createDisabledExportModule());

  // --- Orquestador (pipeline asíncrono) ---
  // El orquestador SIEMPRE dispone del análisis estático (fuente siempre
  // disponible del diseño); los módulos opcionales/deshabilitables se inyectan.
  const orchestrator = new DefaultAnalysisOrchestrator({
    jobRepository,
    resultRepository,
    ingestion,
    ai: aiModule,
    readContent,
  });

  // --- Cola de jobs + worker in-process ---
  // El worker consume cada job encolado y ejecuta el pipeline del orquestador.
  const queue = new InProcessAnalysisQueue({
    handler: (job) => orchestrator.run(job.id),
  });

  // --- Autenticación ---
  const defaultUsers = env.NODE_ENV === 'development' ? [createDevelopmentDemoUser()] : [];
  const userStore = new InMemoryUserStore(overrides.users ?? defaultUsers);
  const authService = new DefaultAuthService(userStore, overrides.authClock);

  // --- Router de análisis (Task 15.2) ---
  const analysisRouter = createAnalysisRouter({
    jobRepository,
    resultRepository,
    analysisQueue: queue,
    transientStorage,
    exportModule,
  });

  // --- Router de la API (Task 15.1) + análisis ---
  const router = createApiRouter({
    authService,
    preferenceRepository,
    analysisRouter,
  });

  // --- Servidor HTTP: punto de entrada único del monolito (Requisito 14.2) ---
  const server = createServer(router);

  return {
    server,
    config,
    queue,
    router,
    jobRepository,
    resultRepository,
    preferenceRepository,
  };
}
