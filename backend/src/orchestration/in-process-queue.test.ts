import { describe, it, expect } from 'vitest';
import type { AnalysisJob } from '../domain/index.js';
import { InProcessAnalysisQueue } from './in-process-queue.js';

/**
 * Pruebas de ejemplo de la cola de jobs in-process (Task 14.1).
 *
 * Cubren el encolado y el consumo asíncrono por un worker in-process: los jobs se
 * procesan de forma asíncrona en segundo plano (Requisito 12.2), en el orden de
 * encolado, y el llamante de `enqueue` no queda bloqueado por la ejecución del
 * pipeline (Requisito 12.3).
 */

/** Construye un `AnalysisJob` mínimo para las pruebas, variando el id. */
function makeJob(id: string): AnalysisJob {
  const now = new Date().toISOString();
  return {
    id,
    userId: 'user-1',
    status: 'EN_COLA',
    progress: 0,
    stage: 'INGESTA',
    useAIRequested: false,
    inputSource: 'ZIP',
    createdAt: now,
    updatedAt: now,
  };
}

describe('InProcessAnalysisQueue - consumo asíncrono (Requisito 12.2)', () => {
  it('procesa el job encolado mediante el handler inyectado', async () => {
    const processed: string[] = [];
    const queue = new InProcessAnalysisQueue({
      handler: async (job) => {
        processed.push(job.id);
      },
    });

    await queue.enqueue(makeJob('job-a'));
    await queue.onIdle();

    expect(processed).toEqual(['job-a']);
  });

  it('no bloquea al llamante: enqueue resuelve sin esperar a que el handler termine', async () => {
    let handlerCompleted = false;
    // El handler bloquea hasta que la prueba lo libere, simulando un pipeline
    // pesado. `enqueue` debe resolver aunque el handler siga en curso.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queue = new InProcessAnalysisQueue({
      handler: async () => {
        await gate;
        handlerCompleted = true;
      },
    });

    await queue.enqueue(makeJob('job-a'));

    // enqueue ya resolvió; el pipeline pesado aún no ha terminado (no bloqueo).
    expect(handlerCompleted).toBe(false);

    // Libera el handler y espera a que la cola quede vacía.
    release();
    await queue.onIdle();

    expect(handlerCompleted).toBe(true);
  });

  it('procesa múltiples jobs en el orden de encolado (FIFO)', async () => {
    const processed: string[] = [];
    const queue = new InProcessAnalysisQueue({
      handler: async (job) => {
        // Retardo variable para descartar dependencia del tiempo de ejecución.
        const delay = job.id === 'job-1' ? 5 : 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
        processed.push(job.id);
      },
    });

    await queue.enqueue(makeJob('job-1'));
    await queue.enqueue(makeJob('job-2'));
    await queue.enqueue(makeJob('job-3'));
    await queue.onIdle();

    expect(processed).toEqual(['job-1', 'job-2', 'job-3']);
  });

  it('espera la finalización de cada handler antes de consumir el siguiente', async () => {
    const events: string[] = [];
    const queue = new InProcessAnalysisQueue({
      handler: async (job) => {
        events.push(`start:${job.id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end:${job.id}`);
      },
    });

    await queue.enqueue(makeJob('a'));
    await queue.enqueue(makeJob('b'));
    await queue.onIdle();

    // El consumo es secuencial: b no arranca hasta que a termina.
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('aísla un handler que falla y continúa con el resto de la cola', async () => {
    const processed: string[] = [];
    const errors: string[] = [];
    const queue = new InProcessAnalysisQueue({
      handler: async (job) => {
        if (job.id === 'bad') {
          throw new Error('fallo simulado del pipeline');
        }
        processed.push(job.id);
      },
      onHandlerError: (job) => {
        errors.push(job.id);
      },
    });

    await queue.enqueue(makeJob('good-1'));
    await queue.enqueue(makeJob('bad'));
    await queue.enqueue(makeJob('good-2'));
    await queue.onIdle();

    expect(processed).toEqual(['good-1', 'good-2']);
    expect(errors).toEqual(['bad']);
  });

  it('procesa jobs encolados mientras el worker ya está drenando', async () => {
    const processed: string[] = [];
    const queue = new InProcessAnalysisQueue({
      handler: async (job) => {
        processed.push(job.id);
        // Encola un job derivado durante el procesamiento del primero.
        if (job.id === 'first') {
          await queue.enqueue(makeJob('second'));
        }
      },
    });

    await queue.enqueue(makeJob('first'));
    await queue.onIdle();

    expect(processed).toEqual(['first', 'second']);
    expect(queue.pending).toBe(0);
  });
});
