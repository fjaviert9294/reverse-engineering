/**
 * Abstracción de descarga del archivo comprimido (ZIP) de un repositorio de
 * GitHub público (Task 6.2).
 *
 * El mecanismo concreto de descarga es una "decisión abierta" del diseño: aquí se
 * define ÚNICAMENTE el contrato (`ZipDownloader`) para no acoplar el Módulo de
 * Ingesta a una tecnología concreta. El adaptador por defecto usa el `fetch`
 * global de Node.js (>= 20), pero puede sustituirse por cualquier otro (p. ej. en
 * pruebas) sin afectar a los consumidores.
 *
 * Garantías del contrato (Requisito 15.2): la descarga se realiza contra
 * endpoints públicos y NO envía credenciales ni tokens; tampoco realiza clonación
 * Git (Requisito 15.1). No se imponen límites de tamaño ni de número de archivos
 * sobre lo descargado (Requisito 15.3).
 */

/**
 * Motivo por el que una descarga no produjo un ZIP. Permite al Módulo de Ingesta
 * traducir el fallo al error de dominio adecuado sin inspeccionar mensajes:
 *
 * - `NO_ENCONTRADO`: el recurso respondió como inexistente/privado/inaccesible
 *   (p. ej. 404/403/401). Corresponde a "repo inexistente, privado o inaccesible"
 *   (Requisito 15.6).
 * - `RED`: fallo de red o de transporte (conexión rechazada, DNS, timeout, o una
 *   respuesta de servidor no recuperable). El usuario puede reintentar
 *   (Requisito 15.7).
 */
export type ZipDownloadFailureKind = 'NO_ENCONTRADO' | 'RED';

/**
 * Resultado de intentar descargar una URL de ZIP. En caso de éxito transporta los
 * bytes del archivo comprimido; en caso de fallo, el motivo y un mensaje.
 */
export type ZipDownloadResult =
  | { ok: true; content: Uint8Array }
  | { ok: false; kind: ZipDownloadFailureKind; message: string };

/**
 * Contrato de descarga de un ZIP desde una URL pública, agnóstico a la
 * tecnología. Recibe una única URL y devuelve su resultado; la estrategia de
 * probar varias URL candidatas (ramas por defecto) vive en el Módulo de Ingesta.
 *
 * Una implementación NUNCA debe añadir cabeceras de autorización ni credenciales
 * (Requisito 15.2).
 */
export interface ZipDownloader {
  download(url: string): Promise<ZipDownloadResult>;
}

/**
 * Adaptador por defecto de `ZipDownloader` respaldado por el `fetch` global. No
 * envía credenciales (`credentials: 'omit'`, sin cabeceras de autorización) y
 * distingue "no encontrado/inaccesible" de "fallo de red/transporte" para que la
 * ingesta produzca el error de dominio correcto.
 */
export class FetchZipDownloader implements ZipDownloader {
  /**
   * @param fetchImpl Implementación de `fetch` a usar. Por defecto el `fetch`
   *   global de Node.js; se permite inyectar otra para pruebas o entornos sin
   *   `fetch` global.
   */
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  async download(url: string): Promise<ZipDownloadResult> {
    if (typeof this.fetchImpl !== 'function') {
      return {
        ok: false,
        kind: 'RED',
        message: 'No hay un cliente de descarga (fetch) disponible en el entorno.',
      };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        // Nunca se envían credenciales ni tokens (Requisito 15.2).
        credentials: 'omit',
        redirect: 'follow',
        headers: { Accept: 'application/zip, application/octet-stream' },
      });
    } catch (cause) {
      // Fallo de red/transporte: DNS, conexión rechazada, timeout, etc.
      return {
        ok: false,
        kind: 'RED',
        message: cause instanceof Error ? cause.message : 'Fallo de red al descargar el ZIP.',
      };
    }

    if (response.status === 404 || response.status === 403 || response.status === 401) {
      return {
        ok: false,
        kind: 'NO_ENCONTRADO',
        message: `El repositorio no existe, es privado o no es accesible (HTTP ${response.status}).`,
      };
    }

    if (!response.ok) {
      // Otros códigos (5xx, etc.) se tratan como fallo de transporte recuperable.
      return {
        ok: false,
        kind: 'RED',
        message: `Respuesta inesperada del servidor al descargar el ZIP (HTTP ${response.status}).`,
      };
    }

    try {
      const buffer = await response.arrayBuffer();
      return { ok: true, content: new Uint8Array(buffer) };
    } catch (cause) {
      return {
        ok: false,
        kind: 'RED',
        message: cause instanceof Error ? cause.message : 'Fallo al leer el cuerpo de la respuesta.',
      };
    }
  }
}
