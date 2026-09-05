/**
 * Cola de jobs en memoria con worker in-process (Task 14.1).
 *
 * Adaptador por defecto de `AnalysisQueue` respaldado por una cola FIFO en
 * memoria y un bucle de worker que corre dentro del mismo proceso Node.js
 * (monolito modular, límite de 1 instancia; sección "Arquitectura" del diseño).
 * Cumple el procesamiento asíncrono en segundo plano (Requisito 12.2) sin fijar
 * una tecnología concreta de cola (Open Question 3): esta implementación puede
 * sustituirse por otra (p. ej. cola externa) sin afectar a los consumidores, que
 * dependen solo de la interfaz `AnalysisQueue`.
 *
 * Diseño del worker:
 * - `enqueue(job)` añade el job al final de la cola y "despierta" el worker de
 *   forma diferida (microtask). Retorna de inmediato, sin ejecutar el pipeline,
 *   por lo que el llamante NO queda bloqueado (Requisitos 12.2, 12.3).
 * - El worker consume los jobs uno a uno, EN ORDEN de encolado, esperando la
 *   finalización del `JobHandler` de cada job antes de tomar el siguiente. Con un
 *   único worker in-process el procesamiento es secuencial, respetando el límite
 *   de recursos del MVP (1 vCPU).
 * - El manejador de un job se invoca de forma aislada: si lanza, el worker lo
 *   registra mediante `onHandlerError` y continúa con el siguiente job, de modo
 *   que un job fallido no detiene el consumo del resto de la cola.
 */

import type { AnalysisJob } from '../domain/index.js';
import type { AnalysisQueue, JobHandler } from './analysis-queue.js';

/** Opciones de construcción de la cola in-process. */
export interface InProcessQueueOptions {
  /**
   * Callback invocado por cada job consumido de la cola. Aquí se inyecta el
   * pipeline real (Task 14.2), manteniendo la cola desacoplada del análisis.
   */
  handler: JobHandler;
  /**
   * Manejador opcional de errores del `handler`. Si el `handler` de un job
   * rechaza/lanza, se invoca con el job afectado y el error, y el worker continúa
   * con el siguiente job. Por defecto, el error se ignora (el aislamiento de
   * fallos por módulo y su reporte es responsabilidad del pipeline, Task 14.2).
   */
  onHandlerError?: (job: AnalysisJob, error: unknown) => void;
}

export class InProcessAnalysisQueue implements AnalysisQueue {
  private readonly queue: AnalysisJob[] = [];
  private readonly handler: JobHandler;
  private readonly onHandlerError?: (job: AnalysisJob, error: unknown) => void;

  /** Indica si el bucle del worker está actualmente procesando la cola. */
  private draining = false;

  /**
   * Promesa que resuelve cuando el worker termina de vaciar la cola actual.
   * Se usa solo para observabilidad/pruebas (`onIdle`), no para bloquear a
   * `enqueue`.
   */
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(options: InProcessQueueOptions) {
    this.handler = options.handler;
    this.onHandlerError = options.onHandlerError;
  }

  /**
   * Encola el job y programa el arranque del worker en un microtask, de modo que
   * `enqueue` retorne antes de que se ejecute cualquier `handler` (no bloqueo,
   * Requisitos 12.2, 12.3). Preserva el orden FIFO de encolado.
   */
  async enqueue(job: AnalysisJob): Promise<void> {
    this.queue.push(job);
    this.scheduleDrain();
  }

  /**
   * Devuelve una promesa que resuelve cuando la cola queda vacía y el worker
   * deja de estar activo. Útil para pruebas y para un apagado ordenado; no forma
   * parte del contrato `AnalysisQueue`.
   */
  async onIdle(): Promise<void> {
    await this.drainPromise;
  }

  /** Número de jobs pendientes de consumir (observabilidad/pruebas). */
  get pending(): number {
    return this.queue.length;
  }

  /** Arranca el bucle del worker si no está ya activo. */
  private scheduleDrain(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;
    // Diferir a un microtask garantiza que `enqueue` retorne antes de procesar.
    this.drainPromise = Promise.resolve().then(() => this.drain());
  }

  /**
   * Bucle del worker: consume jobs EN ORDEN hasta vaciar la cola. Aísla los
   * fallos del `handler` por job para no detener el consumo del resto.
   */
  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift() as AnalysisJob;
        try {
          await this.handler(job);
        } catch (error) {
          this.onHandlerError?.(job, error);
        }
      }
    } finally {
      this.draining = false;
      // Si llegaron jobs mientras se cerraba el bucle, reprograma el drenado.
      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    }
  }
}
