/**
 * Tipos del Módulo de Ingesta de Repo-Analyzer (Task 6.1).
 *
 * El Módulo de Ingesta recibe el código de entrada, lo extrae a almacenamiento
 * transitorio, verifica que exista código analizable y descarta el contenido al
 * finalizar o ante un fallo. Estos tipos modelan la entrada (ZIP subido) y la
 * salida (repositorio extraído en el espacio efímero) del módulo.
 *
 * IMPORTANTE (Requisito 2.2): estos tipos NO son persistibles. `UploadedZip`
 * transporta los bytes del archivo comprimido de forma transitoria, y
 * `ExtractedRepo` solo referencia el espacio efímero del job (por su `jobId`) más
 * metadatos de las entradas extraídas (rutas y tamaños). Ninguno de ellos se
 * guarda en la base de datos; el código fuente es siempre transitorio.
 */

import type { SupportedLanguage } from '../domain/index.js';
import type { JobId } from '../storage/index.js';

/**
 * Archivo ZIP subido por el usuario, o descargado desde una `URL_GitHub` y
 * convergido a este mismo tipo (Requisitos 1.1, 15.1). Transporta los bytes del
 * archivo comprimido de forma transitoria; nunca se persiste.
 */
export interface UploadedZip {
  /** Identificador del job al que pertenece la ingesta (metadato de identidad). */
  jobId: JobId;
  /** Contenido binario del archivo ZIP. Transitorio; no se persiste. */
  content: Uint8Array;
  /** Nombre de archivo original, si se conoce (metadato opcional para mensajes). */
  filename?: string;
}

/**
 * Metadato de una entrada de archivo extraída al espacio transitorio. Registra
 * únicamente la ubicación (ruta relativa) y el tamaño; NO el contenido del
 * código (Requisito 2.2). El contenido real vive solo en el almacenamiento
 * transitorio hasta su descarte.
 */
export interface ExtractedFile {
  /** Ruta relativa dentro del espacio del job (separador `/`). */
  path: string;
  /** Tamaño en bytes del archivo extraído. */
  size: number;
}

/**
 * Repositorio extraído en almacenamiento transitorio, listo para el análisis.
 * Referencia el espacio efímero por `jobId` (nunca contiene código fuente) y
 * expone metadatos de las entradas extraídas y el perfil de lenguajes analizables
 * detectados durante la ingesta.
 */
export interface ExtractedRepo {
  /** Job propietario del espacio transitorio donde vive el código extraído. */
  jobId: JobId;
  /** Metadatos (ruta + tamaño) de los archivos extraídos; sin contenido. */
  files: ExtractedFile[];
  /**
   * Lenguajes soportados detectados por extensión entre los archivos extraídos.
   * Sirve para verificar la presencia de código analizable (Requisito 1.7); la
   * detección de prioridad completa es responsabilidad del análisis estático
   * (Task 8.1).
   */
  analyzableLanguages: SupportedLanguage[];
}

/**
 * Causa concreta por la que la ingesta rechaza una entrada. Permite a las capas
 * superiores distinguir el motivo sin inspeccionar mensajes de texto.
 *
 * - `ZIP_INVALIDO`: el archivo no es un ZIP válido o no puede extraerse
 *   (Requisito 1.6).
 * - `SIN_CODIGO_ANALIZABLE`: se extrajo correctamente pero no contiene código en
 *   ninguno de los lenguajes soportados (Requisito 1.7).
 * - `URL_GITHUB_INVALIDA`: la `URL_GitHub` está mal formada o no corresponde a un
 *   repositorio de GitHub; no se inicia el análisis (Requisito 15.5).
 * - `REPO_INACCESIBLE`: el repositorio referenciado no existe, es privado o no es
 *   accesible; no se inicia el análisis (Requisito 15.6).
 * - `FALLO_DESCARGA`: la descarga falló por un error de red o de transporte; el
 *   usuario puede reintentar y no se inicia el análisis (Requisito 15.7).
 */
export type IngestionErrorCode =
  | 'ZIP_INVALIDO'
  | 'SIN_CODIGO_ANALIZABLE'
  | 'URL_GITHUB_INVALIDA'
  | 'REPO_INACCESIBLE'
  | 'FALLO_DESCARGA';

/**
 * Error de ingesta. Ante un rechazo, la ingesta descarta cualquier contenido
 * parcialmente extraído sin persistirlo y devuelve este error indicando la causa
 * (Requisitos 1.6, 1.7). Se modela como clase para poder devolverse o lanzarse y
 * comprobarse por `instanceof` / `code`.
 */
export class IngestionError extends Error {
  readonly code: IngestionErrorCode;
  /**
   * Indica si la operación puede reintentarse sin cambiar la entrada. Es `true`
   * para fallos transitorios de red/transporte al descargar desde `URL_GitHub`
   * (Requisito 15.7), que permiten al usuario reintentar la carga; `false` para
   * rechazos definitivos (ZIP inválido, sin código analizable, URL mal formada,
   * repo inaccesible), que requieren corregir la entrada.
   */
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(code: IngestionErrorCode, message: string, cause?: unknown, retryable = false) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}

/**
 * Contrato del Módulo de Ingesta (sección "Modulo_Ingesta" del diseño).
 *
 * `fetchFromGitHub` pertenece a la Task 6.2 y aquí se declara solo como parte del
 * contrato; su implementación de descarga queda fuera del alcance de la Task 6.1.
 */
export interface IngestionModule {
  /**
   * Extrae el ZIP al almacenamiento transitorio del job sin persistir, sin
   * imponer límites de tamaño ni de número de archivos (Requisitos 1.1, 1.4).
   * Verifica que exista código analizable; ante ZIP inválido/no extraíble o sin
   * código analizable, descarta los parciales y devuelve la causa (Requisitos
   * 1.6, 1.7).
   */
  extract(zip: UploadedZip): Promise<ExtractedRepo | IngestionError>;

  /**
   * Descarga el ZIP de un repositorio de GitHub público vía URL/API, sin
   * clonación Git ni credenciales, y converge en `extract`/`discard`
   * (Requisitos 15.1, 15.2). Implementado en la Task 6.2.
   */
  fetchFromGitHub(url: string): Promise<UploadedZip | IngestionError>;

  /**
   * Descarta el código extraído del almacenamiento transitorio, dejando el
   * espacio del job vacío (Requisitos 1.5, 15.4).
   */
  discard(repo: ExtractedRepo): Promise<void>;
}
