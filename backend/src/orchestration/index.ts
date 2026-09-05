/**
 * Punto de entrada de la capa de orquestación de jobs de Repo-Analyzer.
 *
 * Reexporta el contrato agnóstico a la tecnología (`AnalysisQueue`), el tipo del
 * manejador de jobs (`JobHandler`) y el adaptador por defecto —una cola en
 * memoria con worker in-process—, para que el resto de capas (API, wiring) los
 * consuman sin acoplarse a las rutas internas ni a la implementación concreta.
 */
export type { AnalysisQueue, JobHandler } from './analysis-queue.js';
export {
  InProcessAnalysisQueue,
  type InProcessQueueOptions,
} from './in-process-queue.js';
export {
  DefaultAnalysisOrchestrator,
  PipelineError,
  UPLOADED_ZIP_PATH,
  type AnalysisOrchestrator,
  type AnalysisOrchestratorOptions,
  type OrchestratorClock,
  type PipelineModule,
  type TransientContentReader,
} from './analysis-orchestrator.js';
