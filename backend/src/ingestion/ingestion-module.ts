/**
 * Implementación del Módulo de Ingesta de Repo-Analyzer (Task 6.1).
 *
 * Responsabilidad de esta tarea: extraer un ZIP subido al almacenamiento
 * transitorio del job (sin persistir, sin límites de tamaño ni de número de
 * archivos), verificar que exista código analizable y descartar el contenido al
 * finalizar o ante un rechazo. La descarga desde `URL_GitHub` (`fetchFromGitHub`)
 * pertenece a la Task 6.2 y aquí solo se declara.
 *
 * Trazabilidad de requisitos:
 * - 1.1: `extract` extrae a almacenamiento transitorio sin persistir.
 * - 1.2/1.3: no se solicitan credenciales/tokens ni se hace clonación Git; la
 *   única entrada aceptada aquí es el ZIP subido.
 * - 1.4: no se imponen límites de tamaño ni de número de archivos.
 * - 1.5/15.4: `discard` deja el espacio del job vacío.
 * - 1.6: ZIP inválido/no extraíble -> rechazo con causa + descarte de parciales.
 * - 1.7: extraído pero sin código analizable -> rechazo con causa + descarte.
 *
 * La Task 6.2 añade `fetchFromGitHub`, que descarga el ZIP de un repositorio de
 * GitHub público (sin git clone, sin credenciales) detrás de la abstracción
 * `ZipDownloader` y converge en el mismo flujo `extract`/`discard`:
 * - 15.1: descarga el ZIP vía URL/API pública y reutiliza `extract`.
 * - 15.2: no se envían credenciales ni tokens.
 * - 15.3: sin límites de tamaño ni de número de archivos.
 * - 15.5: `URL_GitHub` mal formada o no-GitHub -> rechazo, no inicia análisis.
 * - 15.6: repo inexistente/privado/inaccesible -> error claro, no inicia análisis.
 * - 15.7: fallo de red/transporte -> se informa y se permite reintentar.
 */

import type { TransientStorage } from '../storage/index.js';
import { detectAnalyzableLanguages, hasAnalyzableCode } from './analyzable-code.js';
import { GitHubUrlError, resolveGitHubUrl } from './github-url.js';
import {
  IngestionError,
  type ExtractedFile,
  type ExtractedRepo,
  type IngestionModule,
  type UploadedZip,
} from './types.js';
import { readZipEntries, ZipParseError } from './zip-reader.js';
import { FetchZipDownloader, type ZipDownloader } from './zip-downloader.js';

/**
 * Módulo de ingesta respaldado por el almacenamiento transitorio inyectado. No
 * fija la tecnología de almacenamiento (se recibe el puerto `TransientStorage`),
 * de modo que puede usarse el adaptador de sistema de archivos por defecto o
 * cualquier otro en pruebas.
 */
export class TransientIngestionModule implements IngestionModule {
  private readonly downloader: ZipDownloader;

  /**
   * @param storage Puerto de almacenamiento transitorio (Task 5.1).
   * @param downloader Abstracción de descarga del ZIP desde `URL_GitHub`. Por
   *   defecto usa el adaptador basado en `fetch` (`FetchZipDownloader`), que no
   *   envía credenciales ni realiza clonación Git. Se inyecta para no acoplar el
   *   módulo a una tecnología concreta (decisión abierta) y para poder sustituirlo
   *   en pruebas.
   */
  constructor(private readonly storage: TransientStorage, downloader: ZipDownloader = new FetchZipDownloader()) {
    this.downloader = downloader;
  }

  /**
   * Extrae el ZIP al espacio transitorio del job. Ante un ZIP inválido/no
   * extraíble (Requisito 1.6) o extraído sin código analizable (Requisito 1.7),
   * descarta cualquier contenido parcial y devuelve un `IngestionError` con la
   * causa, sin persistir nada. No impone límites de tamaño ni de número de
   * archivos (Requisito 1.4).
   */
  async extract(zip: UploadedZip): Promise<ExtractedRepo | IngestionError> {
    const { jobId } = zip;

    // 1) Interpretar el ZIP. Un fallo aquí significa ZIP inválido/no extraíble.
    let entries;
    try {
      entries = readZipEntries(zip.content);
    } catch (cause) {
      // No se llegó a escribir nada, pero garantizamos un espacio limpio por si
      // existiera un residuo previo del mismo jobId (Requisito 1.6, Property 3).
      await this.safeDiscard(jobId);
      const reason = cause instanceof ZipParseError ? cause.message : 'El archivo no es un ZIP válido o no puede extraerse.';
      return new IngestionError('ZIP_INVALIDO', reason, cause);
    }

    // 2) Escribir el contenido extraído al almacenamiento transitorio. Cualquier
    //    fallo de escritura se trata como ZIP no extraíble y descarta parciales.
    try {
      await this.storage.createJobSpace(jobId);
      const files: ExtractedFile[] = [];
      for (const entry of entries) {
        await this.storage.writeFile(jobId, entry.path, entry.content);
        files.push({ path: entry.path, size: entry.content.length });
      }

      // 3) Verificar existencia de código analizable (Requisito 1.7).
      const paths = files.map((f) => f.path);
      if (!hasAnalyzableCode(paths)) {
        await this.safeDiscard(jobId);
        return new IngestionError(
          'SIN_CODIGO_ANALIZABLE',
          'El ZIP se extrajo correctamente pero no contiene código fuente analizable (Java, TypeScript, JavaScript o Python).',
        );
      }

      const repo: ExtractedRepo = {
        jobId,
        files,
        analyzableLanguages: detectAnalyzableLanguages(paths),
      };
      return repo;
    } catch (cause) {
      await this.safeDiscard(jobId);
      const reason = cause instanceof ZipParseError ? cause.message : 'No se pudo extraer el contenido del ZIP al almacenamiento transitorio.';
      return new IngestionError('ZIP_INVALIDO', reason, cause);
    }
  }

  /**
   * Descarta el código extraído del almacenamiento transitorio, dejando el
   * espacio del job vacío (Requisitos 1.5, 15.4). Reutiliza directamente la
   * operación `discard` del puerto de almacenamiento transitorio.
   */
  async discard(repo: ExtractedRepo): Promise<void> {
    await this.storage.discard(repo.jobId);
  }

  /**
   * Descarga el archivo comprimido (ZIP) de un repositorio de GitHub público a
   * partir de su `URL_GitHub`, sin clonación Git ni credenciales, y devuelve un
   * `UploadedZip` que converge en el mismo `extract`/`discard` que el ZIP subido
   * (Requisitos 15.1, 15.2, 15.3).
   *
   * Flujo:
   * 1. Valida y resuelve la `URL_GitHub`. Si está mal formada o no es de GitHub,
   *    devuelve `URL_GITHUB_INVALIDA` y no inicia el análisis (Requisito 15.5).
   * 2. Intenta descargar el ZIP por cada URL candidata (rama por defecto). Un
   *    "no encontrado/privado/inaccesible" produce `REPO_INACCESIBLE`
   *    (Requisito 15.6); un fallo de red/transporte produce `FALLO_DESCARGA`
   *    marcado como reintentable (Requisito 15.7).
   *
   * El `UploadedZip` devuelto no lleva `jobId` asignado (queda como cadena
   * vacía): la identidad del job la fija el llamador (orquestador) antes de
   * invocar `extract`, del mismo modo que con el ZIP subido.
   */
  async fetchFromGitHub(url: string): Promise<UploadedZip | IngestionError> {
    // 1) Validación de la URL (Requisito 15.5): no se intenta descarga si falla.
    let ref;
    try {
      ref = resolveGitHubUrl(url);
    } catch (cause) {
      const reason = cause instanceof GitHubUrlError ? cause.message : 'La URL de GitHub no es válida.';
      return new IngestionError('URL_GITHUB_INVALIDA', reason, cause);
    }

    // 2) Descarga por URL candidatas. Se prueban en orden (p. ej. main, master);
    //    un "no encontrado" en una candidata puede significar que esa rama no es
    //    la por defecto, así que se intenta la siguiente antes de concluir que el
    //    repo es inaccesible.
    let lastNotFound: string | null = null;
    for (const zipUrl of ref.zipUrls) {
      const result = await this.downloader.download(zipUrl);
      if (result.ok) {
        return {
          jobId: '',
          content: result.content,
          filename: `${ref.owner}-${ref.repo}.zip`,
        };
      }
      if (result.kind === 'RED') {
        // Fallo de red/transporte: se informa y se permite reintentar (15.7).
        return new IngestionError(
          'FALLO_DESCARGA',
          `No se pudo descargar el repositorio por un error de red o de transporte: ${result.message} Puede reintentar la carga.`,
          undefined,
          true,
        );
      }
      // NO_ENCONTRADO: recordar y probar la siguiente rama candidata.
      lastNotFound = result.message;
    }

    // Todas las candidatas respondieron "no encontrado/inaccesible" (15.6).
    return new IngestionError(
      'REPO_INACCESIBLE',
      lastNotFound ??
        'El repositorio no existe, es privado o no es accesible. Verifique que la URL corresponda a un repositorio de GitHub público.',
    );
  }

  /**
   * Descarta el espacio del job sin propagar errores de descarte, para no
   * enmascarar la causa original del rechazo. El descarte es idempotente en el
   * puerto de almacenamiento.
   */
  private async safeDiscard(jobId: string): Promise<void> {
    try {
      await this.storage.discard(jobId);
    } catch {
      // El descarte es best-effort en el camino de error; la causa relevante para
      // el usuario es el rechazo de la ingesta, no un fallo secundario de limpieza.
    }
  }
}
