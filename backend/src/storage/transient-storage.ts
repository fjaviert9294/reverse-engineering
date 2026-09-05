/**
 * Abstracción de almacenamiento transitorio (efímero) de Repo-Analyzer (Task 5.1).
 *
 * El código fuente de un repositorio es TRANSITORIO: se extrae a un espacio
 * efímero por job, se analiza y se descarta al finalizar. Nunca se persiste
 * (Requisitos 1.5, 15.4; sección "Almacenamiento transitorio" del diseño).
 *
 * Este módulo define ÚNICAMENTE el contrato (`TransientStorage`) sin fijar la
 * tecnología concreta: el mecanismo real de almacenamiento efímero es una
 * "decisión abierta" del diseño (Open Question 3). El adaptador por defecto
 * respaldado por el sistema de archivos temporal vive en
 * `./fs-transient-storage.ts`, detrás de esta misma interfaz, de modo que pueda
 * sustituirse por otra implementación (p. ej. memoria, tmpfs) sin afectar a los
 * consumidores.
 *
 * INVARIANTE CENTRAL (Requisito 1.5, Property 2): tras `discard(jobId)`, el
 * espacio del job queda vacío y no permanece ningún artefacto de código.
 */

/**
 * Identificador del espacio de almacenamiento asociado a un job. Es un metadato
 * de identidad; nunca contiene código fuente.
 */
export type JobId = string;

/**
 * Entrada listada dentro del espacio de un job. `path` es una ruta relativa al
 * espacio del job (usando `/` como separador, independiente de la plataforma) y
 * `kind` distingue archivos de directorios. No expone el contenido del código,
 * solo su ubicación dentro del espacio efímero.
 */
export interface StorageEntry {
  /** Ruta relativa al espacio del job (separador `/`, sin barra inicial). */
  path: string;
  /** Tipo de la entrada. */
  kind: 'file' | 'directory';
}

/**
 * Contrato de almacenamiento transitorio, agnóstico a la tecnología.
 *
 * Modela el ciclo de vida del código extraído de un job: crear el espacio,
 * escribir el contenido extraído, listarlo y descartarlo. Todas las operaciones
 * operan sobre un `jobId`, de modo que el código de un job queda aislado del de
 * otro.
 */
export interface TransientStorage {
  /**
   * Crea (o reutiliza de forma idempotente) el espacio efímero del job y lo deja
   * vacío y listo para escribir. Devuelve un identificador opaco de la ubicación
   * del espacio (p. ej. una ruta), útil para los módulos de análisis; ese valor
   * NO debe persistirse como resultado.
   */
  createJobSpace(jobId: JobId): Promise<string>;

  /**
   * Escribe contenido extraído en `relativePath` dentro del espacio del job,
   * creando los directorios intermedios que hagan falta. `relativePath` se
   * interpreta relativo al espacio del job; las rutas que intenten escapar del
   * espacio (p. ej. con `..`) se rechazan.
   */
  writeFile(jobId: JobId, relativePath: string, content: Uint8Array | string): Promise<void>;

  /**
   * Lista de forma recursiva las entradas presentes en el espacio del job. Si el
   * espacio no existe o está vacío, devuelve una lista vacía. El orden no está
   * garantizado.
   */
  list(jobId: JobId): Promise<StorageEntry[]>;

  /**
   * Descarta por completo el espacio del job, eliminando todo su contenido de
   * forma que no permanezca ningún artefacto de código (Requisito 1.5,
   * Property 2). Es idempotente: descartar un espacio inexistente no es un error.
   * Tras esta operación, `list(jobId)` devuelve una lista vacía.
   */
  discard(jobId: JobId): Promise<void>;
}

/**
 * Error de la capa de almacenamiento transitorio. Permite a los consumidores
 * distinguir fallos del almacenamiento efímero de otros errores sin inspeccionar
 * mensajes de texto. `cause` conserva el error subyacente para diagnóstico.
 */
export class TransientStorageError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TransientStorageError';
    this.cause = cause;
  }
}
