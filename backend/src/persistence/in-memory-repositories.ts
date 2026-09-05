/**
 * Repositorios en memoria de la capa de persistencia (respaldo por defecto del
 * proceso único).
 *
 * La tecnología concreta de base de datos es una DECISIÓN ABIERTA del diseño
 * (Open Question 2/3): la capa de persistencia se define por sus interfaces
 * (`JobRepository`, `AnalysisResultRepository`, `PreferenceRepository`) y sus
 * respaldos concretos se inyectan. Las implementaciones SQL
 * (`SqlJobRepository`, `SqlAnalysisResultRepository`, `SqlPreferenceRepository`)
 * cubren el despliegue con PostgreSQL; estas implementaciones EN MEMORIA son el
 * respaldo por defecto del monolito modular cuando no hay una base de datos
 * externa configurada, de modo que el proceso arranca y responde como una única
 * unidad ejecutable accesible por su punto de entrada (Requisitos 14.1, 14.2).
 *
 * INVARIANTE (Requisito 2.2): al igual que las tablas SQL, estas estructuras solo
 * guardan resultados y metadatos operativos; NUNCA contenido del código fuente.
 * El código fuente vive en el almacenamiento transitorio y se descarta al
 * finalizar el job.
 *
 * Semántica preservada respecto a los respaldos SQL:
 * - `JobRepository`: valida el invariante de progreso/etapa/estado antes de
 *   escribir (Requisito 12.1) y solo modifica el propio job en `setStatus`, sin
 *   alterar otros datos (Requisito 12.5, 14.6).
 * - `AnalysisResultRepository`: un fallo de guardado (no aplicable en memoria)
 *   preservaría los datos previos; `findById` devuelve `null` si no existe
 *   (Requisitos 2.4, 2.5).
 * - `PreferenceRepository`: `getUseAI` devuelve `false` por defecto cuando no hay
 *   preferencia registrada (privacidad por defecto, Requisitos 4.1, 4.2).
 */

import type {
  AnalysisJob,
  AnalysisResult,
  AnalysisStage,
  JobStatus,
  ModuleError,
} from '../domain/index.js';
import type { AnalysisResultRepository } from './analysisResultRepository.js';
import type { JobRepository } from './job-repository.js';
import { assertValidProgress, assertValidStage, assertValidStatus } from './job-repository.js';
import type { PreferenceRepository } from './preference-repository.js';

/** Clona en profundidad un valor serializable para aislar el estado interno. */
function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * `JobRepository` en memoria. Indexa los jobs por su identificador y devuelve
 * copias para impedir mutaciones externas del estado interno.
 */
export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, AnalysisJob>();

  async create(job: AnalysisJob): Promise<void> {
    assertValidStatus(job.status);
    assertValidProgress(job.progress);
    assertValidStage(job.stage);
    this.jobs.set(job.id, deepClone(job));
  }

  async updateProgress(id: string, progress: number, stage: AnalysisStage): Promise<void> {
    assertValidProgress(progress);
    assertValidStage(stage);
    const job = this.jobs.get(id);
    if (job === undefined) {
      return;
    }
    job.progress = progress;
    job.stage = stage;
    job.updatedAt = new Date().toISOString();
  }

  async setStatus(id: string, status: JobStatus, error?: ModuleError): Promise<void> {
    assertValidStatus(status);
    const job = this.jobs.get(id);
    if (job === undefined) {
      return;
    }
    // Solo se modifica el propio job (estado/módulo afectado), sin tocar otros
    // datos, preservando el estado previo del resto (Requisitos 12.5, 14.6).
    job.status = status;
    if (error?.module !== undefined) {
      job.errorModule = error.module;
    } else {
      delete job.errorModule;
    }
    job.updatedAt = new Date().toISOString();
  }

  async findById(id: string): Promise<AnalysisJob | null> {
    const job = this.jobs.get(id);
    return job === undefined ? null : deepClone(job);
  }
}

/**
 * `AnalysisResultRepository` en memoria. Guarda una copia del resultado indexada
 * por su identificador. `findById` devuelve `null` cuando el identificador no
 * existe (Requisito 2.5).
 */
export class InMemoryAnalysisResultRepository implements AnalysisResultRepository {
  private readonly results = new Map<string, AnalysisResult>();

  async save(result: AnalysisResult): Promise<void> {
    this.results.set(result.id, deepClone(result));
  }

  async findById(id: string): Promise<AnalysisResult | null> {
    const result = this.results.get(id);
    return result === undefined ? null : deepClone(result);
  }
}

/**
 * `PreferenceRepository` en memoria. Conserva la preferencia de uso de IA por
 * usuario (Requisito 3.3) y devuelve `false` por defecto cuando no hay ninguna
 * registrada (privacidad por defecto, Requisitos 4.1, 4.2).
 */
export class InMemoryPreferenceRepository implements PreferenceRepository {
  private readonly useAiByUser = new Map<string, boolean>();

  async setUseAI(userId: string, useAI: boolean): Promise<void> {
    this.useAiByUser.set(userId, useAI);
  }

  async getUseAI(userId: string): Promise<boolean> {
    return this.useAiByUser.get(userId) ?? false;
  }
}
