/**
 * Abstracción de la cola de jobs de análisis de Repo-Analyzer (Task 14.1).
 *
 * El análisis pesado se procesa de forma ASÍNCRONA en segundo plano: la capa
 * API encola el job y responde de inmediato, y un worker in-process consume los
 * jobs encolados y ejecuta el pipeline (Requisito 12.2; sección "Orquestador de
 * jobs" del diseño).
 *
 * Este módulo define ÚNICAMENTE el contrato (`AnalysisQueue`) sin fijar la
 * tecnología concreta de cola: el mecanismo real es una "decisión abierta" del
 * diseño (Open Question 3). El adaptador por defecto —una cola en memoria con un
 * worker in-process— vive en `./in-process-queue.ts`, detrás de esta misma
 * interfaz, de modo que pueda sustituirse por otra implementación (p. ej. una
 * cola externa ligera) sin afectar a los consumidores.
 *
 * INVARIANTE (Requisito 12.2, 12.3): `enqueue(job)` no bloquea al llamante con la
 * ejecución del pipeline; el procesamiento ocurre después, en segundo plano.
 */

import type { AnalysisJob } from '../domain/index.js';

/**
 * Manejador de procesamiento de un job. El worker invoca este callback por cada
 * job consumido de la cola. La implementación concreta del pipeline
 * (Ingesta -> Análisis Estático -> [IA] -> Persistir -> Descartar) se inyecta
 * desde fuera (Task 14.2), de modo que la cola/worker permanezca desacoplada del
 * pipeline y de la tecnología concreta.
 *
 * El manejador es asíncrono; el worker espera su finalización antes de consumir
 * el siguiente job, preservando el orden de encolado.
 */
export type JobHandler = (job: AnalysisJob) => Promise<void>;

/**
 * Contrato de la cola de jobs de análisis, agnóstico a la tecnología.
 *
 * `enqueue` registra un job para su procesamiento en segundo plano y retorna sin
 * ejecutar el pipeline (no bloquea al llamante). El consumo lo realiza un worker
 * in-process a través del `JobHandler` inyectado en la implementación concreta.
 */
export interface AnalysisQueue {
  /**
   * Encola un job de análisis para su procesamiento asíncrono en segundo plano
   * (Requisito 12.2). Resuelve una vez el job queda encolado, sin esperar a que
   * el pipeline se ejecute; el llamante no queda bloqueado (Requisito 12.3).
   */
  enqueue(job: AnalysisJob): Promise<void>;
}
