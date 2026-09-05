/**
 * Lector de archivos ZIP sin dependencias externas (Task 6.1).
 *
 * El diseño deja abierto el mecanismo concreto de extracción (Open Question) y no
 * fija una tecnología. Para no introducir dependencias, este lector interpreta el
 * formato ZIP con las utilidades nativas de Node.js (`node:zlib` para DEFLATE),
 * cubriendo los dos métodos de compresión habituales en la práctica: almacenado
 * (método 0) e "inflado"/DEFLATE (método 8).
 *
 * No impone límites de tamaño ni de número de entradas (Requisitos 1.4, 15.3): el
 * único límite es la memoria disponible del proceso.
 *
 * Estrategia de parseo:
 * 1. Localizar el registro "End Of Central Directory" (EOCD) desde el final.
 * 2. Recorrer el directorio central, que enumera todas las entradas del archivo.
 * 3. Para cada entrada, leer su cabecera local y descomprimir su contenido.
 *
 * Si el buffer no contiene un EOCD válido, no es un ZIP extraíble y se señala con
 * `ZipParseError` para que la ingesta lo rechace (Requisito 1.6).
 */

import { inflateRawSync } from 'node:zlib';

/** Firma del registro End Of Central Directory (EOCD): 'PK\x05\x06'. */
const EOCD_SIGNATURE = 0x06054b50;
/** Firma del localizador ZIP64 EOCD: 'PK\x06\x07'. */
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
/** Firma de una entrada del directorio central: 'PK\x01\x02'. */
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
/** Firma de una cabecera de archivo local: 'PK\x03\x04'. */
const LOCAL_FILE_SIGNATURE = 0x04034b50;

/** Tamaño mínimo (sin comentario) del registro EOCD. */
const EOCD_MIN_SIZE = 22;
/** Tamaño de una cabecera de archivo local fija (sin nombre/extra). */
const LOCAL_HEADER_FIXED_SIZE = 30;

/** Método de compresión: sin compresión (almacenado). */
const METHOD_STORE = 0;
/** Método de compresión: DEFLATE. */
const METHOD_DEFLATE = 8;

/**
 * Error de parseo del archivo ZIP. Indica que el buffer no es un ZIP válido o no
 * puede extraerse con los métodos soportados; la ingesta lo traduce a un rechazo
 * con causa (Requisito 1.6).
 */
export class ZipParseError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ZipParseError';
    this.cause = cause;
  }
}

/** Una entrada de archivo extraída del ZIP (ruta normalizada + contenido). */
export interface ZipEntry {
  /** Ruta relativa normalizada (separador `/`, sin `..` de escape). */
  path: string;
  /** Contenido descomprimido del archivo. */
  content: Buffer;
}

/**
 * Normaliza la ruta de una entrada del ZIP a una ruta relativa segura con
 * separador `/`. Se rechazan rutas que intenten escapar (segmentos `..`) para
 * evitar fugas fuera del espacio del job al escribir (defensa "zip slip").
 * Devuelve `null` para entradas que deben ignorarse (p. ej. directorios).
 */
export function normalizeEntryPath(rawName: string): string | null {
  // Los ZIP usan siempre `/` como separador.
  const withForwardSlashes = rawName.replace(/\\/g, '/');
  // Las entradas de directorio terminan en `/`: no aportan contenido de archivo.
  if (withForwardSlashes.endsWith('/')) {
    return null;
  }
  const segments = withForwardSlashes.split('/').filter((seg) => seg.length > 0 && seg !== '.');
  if (segments.length === 0) {
    return null;
  }
  if (segments.some((seg) => seg === '..')) {
    throw new ZipParseError(`La entrada del ZIP intenta escapar del espacio: "${rawName}".`);
  }
  return segments.join('/');
}

/**
 * Localiza el offset del registro EOCD buscándolo desde el final del buffer. El
 * EOCD puede llevar un comentario final de longitud variable, por lo que se
 * explora hacia atrás hasta encontrar la firma. Devuelve el offset o lanza
 * `ZipParseError` si no se encuentra.
 */
function findEocdOffset(buf: Buffer): number {
  if (buf.length < EOCD_MIN_SIZE) {
    throw new ZipParseError('El archivo es demasiado pequeño para ser un ZIP válido.');
  }
  // El comentario del ZIP tiene como máximo 65535 bytes; acotamos la búsqueda.
  const maxCommentLen = 0xffff;
  const minSearch = Math.max(0, buf.length - EOCD_MIN_SIZE - maxCommentLen);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= minSearch; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  throw new ZipParseError('No se encontró el directorio central del ZIP (EOCD ausente).');
}

/**
 * Descomprime el contenido de una entrada según su método de compresión.
 */
function decompress(method: number, raw: Buffer): Buffer {
  if (method === METHOD_STORE) {
    return raw;
  }
  if (method === METHOD_DEFLATE) {
    try {
      return inflateRawSync(raw);
    } catch (cause) {
      throw new ZipParseError('No se pudo descomprimir una entrada DEFLATE del ZIP.', cause);
    }
  }
  throw new ZipParseError(`Método de compresión no soportado en el ZIP: ${method}.`);
}

/**
 * Extrae todas las entradas de archivo de un buffer ZIP. Recorre el directorio
 * central para enumerar cada entrada, resuelve su cabecera local y descomprime su
 * contenido. Las entradas de directorio se omiten (no aportan archivos).
 *
 * Lanza `ZipParseError` si el buffer no es un ZIP extraíble.
 */
export function readZipEntries(buffer: Uint8Array): ZipEntry[] {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocdOffset = findEocdOffset(buf);

  // ZIP64: si el localizador ZIP64 precede al EOCD, el archivo excede los límites
  // de 32 bits. No lo soportamos; señalamos el rechazo en lugar de truncar en
  // silencio (evita análisis sobre contenido incompleto).
  if (eocdOffset >= 20 && buf.readUInt32LE(eocdOffset - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new ZipParseError('Los archivos ZIP64 no están soportados por el lector de ingesta.');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let pointer = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (pointer + 46 > buf.length || buf.readUInt32LE(pointer) !== CENTRAL_DIR_SIGNATURE) {
      throw new ZipParseError('El directorio central del ZIP está corrupto o incompleto.');
    }
    const compressionMethod = buf.readUInt16LE(pointer + 10);
    const compressedSize = buf.readUInt32LE(pointer + 20);
    const fileNameLength = buf.readUInt16LE(pointer + 28);
    const extraFieldLength = buf.readUInt16LE(pointer + 30);
    const commentLength = buf.readUInt16LE(pointer + 32);
    const localHeaderOffset = buf.readUInt32LE(pointer + 42);
    const rawName = buf
      .subarray(pointer + 46, pointer + 46 + fileNameLength)
      .toString('utf8');

    const normalized = normalizeEntryPath(rawName);

    // Avanza el puntero del directorio central a la siguiente entrada.
    pointer += 46 + fileNameLength + extraFieldLength + commentLength;

    if (normalized === null) {
      // Entrada de directorio u otra que no aporta contenido de archivo.
      continue;
    }

    // Lee la cabecera local para conocer el inicio real del contenido comprimido:
    // los tamaños de nombre/extra locales pueden diferir de los del directorio
    // central, así que se releen desde la cabecera local.
    if (
      localHeaderOffset + LOCAL_HEADER_FIXED_SIZE > buf.length ||
      buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE
    ) {
      throw new ZipParseError('Una cabecera de archivo local del ZIP es inválida.');
    }
    const localNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + LOCAL_HEADER_FIXED_SIZE + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) {
      throw new ZipParseError('El contenido comprimido de una entrada excede el tamaño del archivo.');
    }
    const raw = buf.subarray(dataStart, dataEnd);
    const content = decompress(compressionMethod, raw);
    entries.push({ path: normalized, content });
  }

  return entries;
}
