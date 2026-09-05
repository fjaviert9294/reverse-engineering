/**
 * Adaptador por defecto de almacenamiento transitorio respaldado por el sistema
 * de archivos temporal (Task 5.1).
 *
 * Implementa el contrato `TransientStorage` usando un directorio base dentro del
 * almacenamiento temporal del sistema operativo (por defecto `os.tmpdir()`). Es
 * la implementación por defecto de la "decisión abierta" sobre el mecanismo de
 * almacenamiento efímero (diseño, Open Question 3): al vivir detrás de la
 * interfaz, puede sustituirse por otra tecnología sin afectar a los consumidores.
 *
 * Garantías:
 * - Aislamiento por job: el espacio de cada job es un subdirectorio propio bajo
 *   el directorio base.
 * - Descarte total (Requisito 1.5, 15.4, Property 2): `discard(jobId)` elimina
 *   recursivamente el espacio del job, dejándolo vacío sin artefactos residuales.
 * - Contención de rutas: las escrituras que intenten escapar del espacio del job
 *   (p. ej. mediante `..`) se rechazan, evitando fugas fuera del espacio efímero.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  type JobId,
  type StorageEntry,
  type TransientStorage,
  TransientStorageError,
} from './transient-storage.js';

/** Opciones de configuración del adaptador de sistema de archivos. */
export interface FsTransientStorageOptions {
  /**
   * Directorio raíz bajo el cual se crean los espacios de los jobs. Por defecto,
   * un subdirectorio `repo-analyzer-transient` dentro de `os.tmpdir()`.
   */
  baseDir?: string;
}

/** Nombre del subdirectorio raíz por defecto dentro del temporal del sistema. */
const DEFAULT_ROOT_NAME = 'repo-analyzer-transient';

/**
 * Valida que `jobId` sea utilizable como nombre de directorio seguro. Se
 * rechazan valores vacíos o con separadores de ruta / secuencias `..` para
 * impedir que un job acceda al espacio de otro o escape del directorio base.
 */
function assertSafeJobId(jobId: JobId): void {
  if (typeof jobId !== 'string' || jobId.length === 0) {
    throw new TransientStorageError('El jobId debe ser una cadena no vacía.');
  }
  if (jobId.includes('/') || jobId.includes('\\') || jobId === '.' || jobId === '..') {
    throw new TransientStorageError(`jobId inválido para un espacio de almacenamiento: "${jobId}".`);
  }
}

/**
 * Normaliza una ruta relativa (con separador `/` o el nativo) y garantiza que se
 * mantiene dentro de `spaceDir`. Devuelve la ruta absoluta resuelta. Lanza
 * `TransientStorageError` si la ruta escapa del espacio del job.
 */
function resolveWithinSpace(spaceDir: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new TransientStorageError('La ruta relativa debe ser una cadena no vacía.');
  }
  const normalized = path.normalize(relativePath);
  if (path.isAbsolute(normalized)) {
    throw new TransientStorageError(`La ruta debe ser relativa al espacio del job: "${relativePath}".`);
  }
  const resolved = path.resolve(spaceDir, normalized);
  const relativeToSpace = path.relative(spaceDir, resolved);
  if (relativeToSpace.startsWith('..') || path.isAbsolute(relativeToSpace)) {
    throw new TransientStorageError(
      `La ruta "${relativePath}" escapa del espacio del job.`,
    );
  }
  return resolved;
}

/**
 * Adaptador de `TransientStorage` sobre el sistema de archivos temporal.
 */
export class FsTransientStorage implements TransientStorage {
  private readonly baseDir: string;

  constructor(options: FsTransientStorageOptions = {}) {
    this.baseDir = options.baseDir ?? path.join(os.tmpdir(), DEFAULT_ROOT_NAME);
  }

  /** Ruta absoluta del espacio de un job (subdirectorio del `baseDir`). */
  private spaceDir(jobId: JobId): string {
    assertSafeJobId(jobId);
    return path.join(this.baseDir, jobId);
  }

  /**
   * Crea el espacio del job dejándolo vacío. Si ya existía, se descarta primero
   * para garantizar un punto de partida sin residuos. Devuelve la ruta absoluta
   * del espacio.
   */
  async createJobSpace(jobId: JobId): Promise<string> {
    const dir = this.spaceDir(jobId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      return dir;
    } catch (cause) {
      throw new TransientStorageError(
        `No se pudo crear el espacio transitorio del job "${jobId}".`,
        cause,
      );
    }
  }

  /**
   * Escribe contenido extraído en `relativePath` dentro del espacio del job,
   * creando los directorios intermedios necesarios.
   */
  async writeFile(
    jobId: JobId,
    relativePath: string,
    content: Uint8Array | string,
  ): Promise<void> {
    const dir = this.spaceDir(jobId);
    const target = resolveWithinSpace(dir, relativePath);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    } catch (cause) {
      throw new TransientStorageError(
        `No se pudo escribir el contenido en el espacio del job "${jobId}".`,
        cause,
      );
    }
  }

  /**
   * Lee el contenido de `relativePath` dentro del espacio del job y lo devuelve
   * como cadena. Es TOLERANTE A FALLOS: ante cualquier problema de lectura
   * (archivo inexistente, ruta que escapa del espacio, error de E/S) devuelve
   * `null` en lugar de lanzar, de forma coherente con el contrato de
   * `TransientContentReader`/`ConfigContentReader` (Requisito 5.7).
   *
   * El contenido se lee en codificación `latin1` para preservar los bytes exactos
   * (round-trip byte a byte): el consumidor de contenido de texto lo interpreta
   * como texto, y el consumidor de bytes (p. ej. el ZIP subido) lo reconstruye
   * con `Buffer.from(content, 'binary')` sin pérdida.
   */
  async readFile(jobId: JobId, relativePath: string): Promise<string | null> {
    let target: string;
    try {
      const dir = this.spaceDir(jobId);
      target = resolveWithinSpace(dir, relativePath);
    } catch {
      // jobId o ruta inválida: se trata como contenido no legible.
      return null;
    }
    try {
      return await fs.readFile(target, 'latin1');
    } catch {
      return null;
    }
  }

  /**
   * Lista recursivamente las entradas del espacio del job con rutas relativas y
   * separador `/`. Un espacio inexistente se trata como vacío.
   */
  async list(jobId: JobId): Promise<StorageEntry[]> {
    const dir = this.spaceDir(jobId);
    try {
      const dirents = await fs.readdir(dir, {
        recursive: true,
        withFileTypes: true,
      });
      const entries: StorageEntry[] = [];
      for (const dirent of dirents) {
        // `parentPath` (Node >= 20) apunta al directorio contenedor del dirent.
        const parent = (dirent as unknown as { parentPath?: string; path?: string }).parentPath
          ?? (dirent as unknown as { path?: string }).path
          ?? dir;
        const absolute = path.join(parent, dirent.name);
        const relative = path.relative(dir, absolute).split(path.sep).join('/');
        entries.push({
          path: relative,
          kind: dirent.isDirectory() ? 'directory' : 'file',
        });
      }
      return entries;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
      throw new TransientStorageError(
        `No se pudo listar el espacio del job "${jobId}".`,
        cause,
      );
    }
  }

  /**
   * Descarta por completo el espacio del job. Es idempotente y garantiza que, al
   * terminar, no queda ningún artefacto (Requisito 1.5, Property 2).
   */
  async discard(jobId: JobId): Promise<void> {
    const dir = this.spaceDir(jobId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (cause) {
      throw new TransientStorageError(
        `No se pudo descartar el espacio del job "${jobId}".`,
        cause,
      );
    }
  }
}
