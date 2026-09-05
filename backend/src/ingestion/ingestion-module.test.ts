import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import type {
  JobId,
  StorageEntry,
  TransientStorage,
} from '../storage/index.js';
import { TransientIngestionModule } from './ingestion-module.js';
import { IngestionError } from './types.js';
import type { ZipDownloader, ZipDownloadResult } from './zip-downloader.js';

/**
 * Almacenamiento transitorio en memoria que implementa el mismo puerto
 * `TransientStorage` que el adaptador de sistema de archivos (Task 5.1). Permite
 * ejercitar la ingesta con lógica real de escritura/listado/descarte sin tocar el
 * disco. No es un mock de la lógica bajo prueba: solo sustituye el puerto de I/O.
 */
class InMemoryTransientStorage implements TransientStorage {
  private readonly spaces = new Map<JobId, Map<string, Uint8Array>>();

  async createJobSpace(jobId: JobId): Promise<string> {
    this.spaces.set(jobId, new Map());
    return `mem://${jobId}`;
  }

  async writeFile(jobId: JobId, relativePath: string, content: Uint8Array | string): Promise<void> {
    const space = this.spaces.get(jobId) ?? new Map<string, Uint8Array>();
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    space.set(relativePath, bytes);
    this.spaces.set(jobId, space);
  }

  async list(jobId: JobId): Promise<StorageEntry[]> {
    const space = this.spaces.get(jobId);
    if (!space) {
      return [];
    }
    return [...space.keys()].map((path) => ({ path, kind: 'file' as const }));
  }

  async discard(jobId: JobId): Promise<void> {
    this.spaces.delete(jobId);
  }
}

/**
 * Construye un buffer ZIP mínimo pero válido a partir de un mapa de rutas ->
 * contenido, usando DEFLATE (método 8). Genera cabeceras locales, directorio
 * central y EOCD conforme al formato ZIP, de modo que el lector de ingesta pueda
 * interpretarlo sin dependencias externas.
 */
function buildZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let count = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const content = Buffer.from(text, 'utf8');
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method DEFLATE
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    const localRecord = Buffer.concat([local, nameBuf, compressed]);
    localParts.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // method DEFLATE
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(Buffer.concat([central, nameBuf]));

    offset += localRecord.length;
    count += 1;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

/** CRC-32 (polinomio estándar de ZIP) para poblar las cabeceras del ZIP de prueba. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe('TransientIngestionModule.extract (Task 6.1)', () => {
  it('extrae un ZIP válido al almacenamiento transitorio y detecta lenguajes (Req 1.1, 1.7)', async () => {
    const storage = new InMemoryTransientStorage();
    const module = new TransientIngestionModule(storage);
    const zip = buildZip({
      'src/app.ts': 'export const x = 1;',
      'src/util.js': 'module.exports = {};',
      'README.md': '# hola',
    });

    const result = await module.extract({ jobId: 'job-1', content: zip });

    expect(result).not.toBeInstanceOf(IngestionError);
    if (result instanceof IngestionError) return;
    expect(result.jobId).toBe('job-1');
    expect(result.files.map((f) => f.path).sort()).toEqual(
      ['README.md', 'src/app.ts', 'src/util.js'],
    );
    // Prioridad Java > TS > JS > Python.
    expect(result.analyzableLanguages).toEqual(['TYPESCRIPT', 'JAVASCRIPT']);

    const stored = await storage.list('job-1');
    expect(stored.map((e) => e.path).sort()).toEqual(
      ['README.md', 'src/app.ts', 'src/util.js'],
    );
  });

  it('acepta ZIP con muchos archivos sin imponer límites (Req 1.4)', async () => {
    const storage = new InMemoryTransientStorage();
    const module = new TransientIngestionModule(storage);
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      files[`pkg/mod_${i}.py`] = `x = ${i}\n`;
    }
    const zip = buildZip(files);

    const result = await module.extract({ jobId: 'job-big', content: zip });

    expect(result).not.toBeInstanceOf(IngestionError);
    if (result instanceof IngestionError) return;
    expect(result.files).toHaveLength(500);
    expect(result.analyzableLanguages).toEqual(['PYTHON']);
  });

  it('rechaza un ZIP inválido/no extraíble con causa y sin dejar artefactos (Req 1.6)', async () => {
    const storage = new InMemoryTransientStorage();
    const module = new TransientIngestionModule(storage);
    const notAZip = Buffer.from('esto no es un zip en absoluto');

    const result = await module.extract({ jobId: 'job-bad', content: notAZip });

    expect(result).toBeInstanceOf(IngestionError);
    if (!(result instanceof IngestionError)) return;
    expect(result.code).toBe('ZIP_INVALIDO');
    expect(result.message.length).toBeGreaterThan(0);
    // No debe permanecer ningún artefacto (Property 3).
    expect(await storage.list('job-bad')).toEqual([]);
  });

  it('rechaza y descarta un ZIP sin código analizable (Req 1.7)', async () => {
    const storage = new InMemoryTransientStorage();
    const module = new TransientIngestionModule(storage);
    const zip = buildZip({
      'README.md': '# solo docs',
      'data/config.yaml': 'key: value',
      'notes.txt': 'sin codigo',
    });

    const result = await module.extract({ jobId: 'job-nocode', content: zip });

    expect(result).toBeInstanceOf(IngestionError);
    if (!(result instanceof IngestionError)) return;
    expect(result.code).toBe('SIN_CODIGO_ANALIZABLE');
    // El contenido parcialmente extraído se descarta (Req 1.7).
    expect(await storage.list('job-nocode')).toEqual([]);
  });

  it('discard deja el espacio del job vacío (Req 1.5, 15.4)', async () => {
    const storage = new InMemoryTransientStorage();
    const module = new TransientIngestionModule(storage);
    const zip = buildZip({ 'Main.java': 'class Main {}' });

    const result = await module.extract({ jobId: 'job-discard', content: zip });
    expect(result).not.toBeInstanceOf(IngestionError);
    if (result instanceof IngestionError) return;

    await module.discard(result);

    expect(await storage.list('job-discard')).toEqual([]);
  });

});

/**
 * Descargador de ZIP en memoria que implementa el puerto `ZipDownloader`. Permite
 * ejercitar `fetchFromGitHub` con lógica real de decisión (validación de URL,
 * elección de rama candidata, mapeo de errores) sin salir a la red. Registra las
 * URL solicitadas para verificar que no se envían credenciales ni se hace git.
 */
class StubZipDownloader implements ZipDownloader {
  readonly requested: string[] = [];

  constructor(
    private readonly responder: (url: string) => ZipDownloadResult,
  ) {}

  async download(url: string): Promise<ZipDownloadResult> {
    this.requested.push(url);
    return this.responder(url);
  }
}

describe('TransientIngestionModule.fetchFromGitHub (Task 6.2)', () => {
  it('descarga el ZIP de un repo público y converge en extract (Req 15.1, 15.2, 15.3)', async () => {
    const storage = new InMemoryTransientStorage();
    const zip = buildZip({ 'src/App.java': 'class App {}' });
    const downloader = new StubZipDownloader((url) =>
      url.includes('/main') ? { ok: true, content: zip } : { ok: false, kind: 'NO_ENCONTRADO', message: 'x' },
    );
    const module = new TransientIngestionModule(storage, downloader);

    const fetched = await module.fetchFromGitHub('https://github.com/owner/repo');

    expect(fetched).not.toBeInstanceOf(IngestionError);
    if (fetched instanceof IngestionError) return;
    expect(Buffer.from(fetched.content).equals(zip)).toBe(true);
    // No se envían credenciales: la URL apunta al endpoint público de codeload.
    expect(downloader.requested.every((u) => u.startsWith('https://codeload.github.com/'))).toBe(true);

    // Converge en el mismo flujo transitorio que el ZIP subido (Req 15.1, 15.4).
    const repo = await module.extract({ ...fetched, jobId: 'gh-1' });
    expect(repo).not.toBeInstanceOf(IngestionError);
    if (repo instanceof IngestionError) return;
    expect(repo.analyzableLanguages).toEqual(['JAVA']);
    expect(await storage.list('gh-1')).toHaveLength(1);
  });

  it('prueba la rama master cuando main no existe (resolución de rama por defecto)', async () => {
    const storage = new InMemoryTransientStorage();
    const zip = buildZip({ 'main.py': 'x = 1' });
    const downloader = new StubZipDownloader((url) =>
      url.includes('/master') ? { ok: true, content: zip } : { ok: false, kind: 'NO_ENCONTRADO', message: 'no main' },
    );
    const module = new TransientIngestionModule(storage, downloader);

    const fetched = await module.fetchFromGitHub('https://github.com/owner/repo');

    expect(fetched).not.toBeInstanceOf(IngestionError);
    expect(downloader.requested.some((u) => u.includes('/master'))).toBe(true);
  });

  it('rechaza una URL mal formada o no-GitHub sin intentar descarga (Req 15.5)', async () => {
    const storage = new InMemoryTransientStorage();
    const downloader = new StubZipDownloader(() => ({ ok: true, content: new Uint8Array() }));
    const module = new TransientIngestionModule(storage, downloader);

    for (const bad of ['no-una-url', 'https://gitlab.com/owner/repo', 'ftp://github.com/owner/repo', 'https://github.com/owner']) {
      const result = await module.fetchFromGitHub(bad);
      expect(result).toBeInstanceOf(IngestionError);
      if (!(result instanceof IngestionError)) return;
      expect(result.code).toBe('URL_GITHUB_INVALIDA');
    }
    // No se debe intentar ninguna descarga si la URL es inválida (no inicia análisis).
    expect(downloader.requested).toEqual([]);
  });

  it('devuelve error claro si el repo es inexistente/privado/inaccesible (Req 15.6)', async () => {
    const storage = new InMemoryTransientStorage();
    const downloader = new StubZipDownloader(() => ({
      ok: false,
      kind: 'NO_ENCONTRADO',
      message: 'HTTP 404',
    }));
    const module = new TransientIngestionModule(storage, downloader);

    const result = await module.fetchFromGitHub('https://github.com/owner/repo');

    expect(result).toBeInstanceOf(IngestionError);
    if (!(result instanceof IngestionError)) return;
    expect(result.code).toBe('REPO_INACCESIBLE');
    expect(result.retryable).toBe(false);
  });

  it('informa fallo de red y permite reintentar (Req 15.7)', async () => {
    const storage = new InMemoryTransientStorage();
    const downloader = new StubZipDownloader(() => ({
      ok: false,
      kind: 'RED',
      message: 'ECONNREFUSED',
    }));
    const module = new TransientIngestionModule(storage, downloader);

    const result = await module.fetchFromGitHub('https://github.com/owner/repo');

    expect(result).toBeInstanceOf(IngestionError);
    if (!(result instanceof IngestionError)) return;
    expect(result.code).toBe('FALLO_DESCARGA');
    expect(result.retryable).toBe(true);
  });

  it('acepta URL con .git y con ref explícita en /tree/{ref}', async () => {
    const storage = new InMemoryTransientStorage();
    const zip = buildZip({ 'a.ts': 'export const a = 1;' });
    const downloader = new StubZipDownloader((url) =>
      url.includes('/develop') ? { ok: true, content: zip } : { ok: false, kind: 'NO_ENCONTRADO', message: 'x' },
    );
    const module = new TransientIngestionModule(storage, downloader);

    const fetched = await module.fetchFromGitHub('https://github.com/owner/repo.git/tree/develop');

    expect(fetched).not.toBeInstanceOf(IngestionError);
    // Con ref explícita solo se intenta esa rama.
    expect(downloader.requested).toHaveLength(1);
    expect(downloader.requested[0]).toContain('/develop');
  });
});
