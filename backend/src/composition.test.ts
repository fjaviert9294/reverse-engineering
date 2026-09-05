/**
 * Pruebas de wiring de extremo a extremo del composition root (Task 18.1).
 *
 * Verifican que TODOS los componentes quedan cableados en una única unidad
 * ejecutable accesible por su punto de entrada (Requisitos 14.1, 14.2) y que:
 * - una solicitud al punto de entrada recibe una respuesta satisfactoria (14.2);
 * - el pipeline asíncrono completo (login -> crear análisis -> progreso ->
 *   resultado) funciona con los módulos reales cableados;
 * - con la inferencia por IA deshabilitada, el análisis continúa y el resultado
 *   se produce en modo solo estático con aviso (Requisito 14.5);
 * - el fallo de un módulo se aísla: se identifica el módulo afectado y el resto
 *   del sistema (API/consulta) sigue operativo (Requisito 14.6).
 *
 * Las pruebas levantan el servidor HTTP real en un puerto efímero y lo consultan
 * con `fetch`, ejercitando el punto de entrada tal y como lo haría un cliente.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { randomBytes, scryptSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createApplication, type CompositionOverrides } from './composition.js';
import { FsTransientStorage } from './storage/index.js';
import { loadConfig } from './config.js';
import type { StoredUser } from './domain/index.js';
import {
  IngestionError,
  type ExtractedRepo,
  type IngestionModule,
  type UploadedZip,
} from './ingestion/index.js';

// ---------------------------------------------------------------------------
// Utilidades de prueba
// ---------------------------------------------------------------------------

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

/** Construye un ZIP DEFLATE válido a partir de un mapa ruta -> contenido. */
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
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([local, nameBuf, compressed]);
    localParts.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
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

/** Genera un hash de contraseña con el formato `salt:derivedKeyHex` (scrypt). */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

const TEST_USER: StoredUser = {
  id: 'user-1',
  username: 'analista',
  passwordHash: hashPassword('secreta'),
  failedAttempts: 0,
  lockedUntil: null,
};

/** Módulo de ingesta que siempre falla, para probar el aislamiento de fallos. */
function createFailingIngestionModule(): IngestionModule {
  return {
    async extract(_zip: UploadedZip): Promise<IngestionError> {
      return new IngestionError('ZIP_INVALIDO', 'Fallo inyectado de ingesta.');
    },
    async fetchFromGitHub(_url: string): Promise<IngestionError> {
      return new IngestionError('FALLO_DESCARGA', 'Fallo inyectado de descarga.');
    },
    async discard(_repo: ExtractedRepo): Promise<void> {
      // nada que descartar
    },
  };
}

/** Estado de una app levantada para una prueba, con su limpieza. */
interface RunningApp {
  server: Server;
  baseUrl: string;
  cleanup: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    if (c) {
      await c();
    }
  }
});

/**
 * Levanta la aplicación cableada en un puerto efímero con un almacenamiento
 * transitorio aislado en un directorio temporal propio. Registra la limpieza.
 */
async function startApp(overrides: Partial<CompositionOverrides> = {}): Promise<RunningApp> {
  const dir = mkdtempSync(join(tmpdir(), 'repo-analyzer-wiring-'));
  const transientStorage = new FsTransientStorage({ baseDir: dir });

  const app = createApplication({
    users: [TEST_USER],
    transientStorage,
    ...overrides,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanup = async (): Promise<void> => {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  };
  cleanups.push(cleanup);

  return { server: app.server, baseUrl, cleanup };
}

/** Inicia sesión y devuelve el token de sesión. */
async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'analista', password: 'secreta' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Sondea el estado del job hasta alcanzar un estado terminal o agotar intentos. */
async function waitForTerminal(
  baseUrl: string,
  token: string,
  jobId: string,
): Promise<{ jobStatus: string; errorModule: string | null; progress: number }> {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${baseUrl}/analyses/${jobId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jobStatus: string;
      errorModule: string | null;
      progress: number;
    };
    if (body.jobStatus === 'COMPLETADO' || body.jobStatus === 'FALLIDO') {
      return body;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('El job no alcanzó un estado terminal a tiempo.');
}

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

describe('wiring del proceso único (Task 18.1)', () => {
  it('responde satisfactoriamente en su punto de entrada (Req 14.2)', async () => {
    const { baseUrl } = await startApp();
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string; status: string };
    expect(body.service).toBe('repo-analyzer');
    expect(body.status).toBe('ok');
  });

  it('ejecuta el pipeline completo de extremo a extremo con los módulos cableados', async () => {
    const { baseUrl } = await startApp();
    const token = await login(baseUrl);

    const zip = buildZip({
      'src/app.ts': 'export const x = 1;',
      'src/service.ts': 'export class UserService {}',
      'package.json': JSON.stringify({ name: 'demo', dependencies: {} }),
    });

    const createRes = await fetch(`${baseUrl}/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zip: zip.toString('base64'), useAI: false }),
    });
    expect(createRes.status).toBe(202);
    const { jobId } = (await createRes.json()) as { jobId: string };
    expect(typeof jobId).toBe('string');

    const terminal = await waitForTerminal(baseUrl, token, jobId);
    expect(terminal.jobStatus).toBe('COMPLETADO');
    expect(terminal.progress).toBe(100);

    const resultRes = await fetch(`${baseUrl}/analyses/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resultRes.status).toBe(200);
    const { result } = (await resultRes.json()) as {
      result: { analysisMode: string; primaryLanguage: string | null };
    };
    expect(result.analysisMode).toBe('SOLO_ESTATICO');
    expect(result.primaryLanguage).toBe('TYPESCRIPT');
  });

  it('con la IA deshabilitada continúa y devuelve solo estático con aviso (Req 14.5)', async () => {
    // Config con el módulo de IA deshabilitado; el resto de módulos habilitados.
    const config = loadConfig({ MODULE_AI_ENABLED: 'false' });
    const { baseUrl } = await startApp({ config });
    const token = await login(baseUrl);

    const zip = buildZip({ 'main.py': 'print("hola")\n' });

    // useAI: true -> el usuario solicita IA, pero el módulo está deshabilitado.
    const createRes = await fetch(`${baseUrl}/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zip: zip.toString('base64'), useAI: true }),
    });
    expect(createRes.status).toBe(202);
    const { jobId } = (await createRes.json()) as { jobId: string };

    const terminal = await waitForTerminal(baseUrl, token, jobId);
    expect(terminal.jobStatus).toBe('COMPLETADO');

    const resultRes = await fetch(`${baseUrl}/analyses/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { result } = (await resultRes.json()) as {
      result: { analysisMode: string; notices: string[] };
    };
    // Degradación elegante: solo estático + aviso de que la IA no se aplicó.
    expect(result.analysisMode).toBe('SOLO_ESTATICO');
    expect(result.notices.length).toBeGreaterThan(0);
    expect(result.notices.join(' ').toLowerCase()).toContain('ia');
  });

  it('aísla el fallo de un módulo e identifica el módulo afectado (Req 14.6)', async () => {
    const { baseUrl } = await startApp({ ingestion: createFailingIngestionModule() });
    const token = await login(baseUrl);

    const zip = buildZip({ 'App.java': 'class App {}' });
    const createRes = await fetch(`${baseUrl}/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zip: zip.toString('base64') }),
    });
    expect(createRes.status).toBe(202);
    const { jobId } = (await createRes.json()) as { jobId: string };

    const terminal = await waitForTerminal(baseUrl, token, jobId);
    expect(terminal.jobStatus).toBe('FALLIDO');
    // El error identifica el módulo afectado (Requisito 14.6).
    expect(terminal.errorModule).toBe('INGESTA');

    // El resto del sistema sigue operativo: la consulta de un resultado
    // inexistente responde 404 (no encontrado), no un fallo del proceso.
    const missing = await fetch(`${baseUrl}/analyses/inexistente`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(missing.status).toBe(404);
  });

  it('deniega rutas protegidas sin sesión válida (Req 13.1)', async () => {
    const { baseUrl } = await startApp();
    const res = await fetch(`${baseUrl}/analyses/whatever/status`);
    expect(res.status).toBe(401);
  });
});
