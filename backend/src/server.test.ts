import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { AddressInfo } from 'node:net';
import { createServer } from './server.js';
import { loadConfig } from './config.js';

describe('scaffolding: wiring de pruebas', () => {
  it('el runner de pruebas está operativo (Vitest)', () => {
    expect(1 + 1).toBe(2);
  });

  // Prueba mínima que demuestra que fast-check está cableado (mínimo 100 iteraciones
  // por propiedad según el diseño). No corresponde a ninguna de las 32 propiedades
  // de corrección; solo verifica el wiring de PBT para el andamiaje (Task 1).
  it('fast-check está operativo con >= 100 iteraciones', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 },
    );
  });

  it('loadConfig usa el puerto 3000 por defecto', () => {
    expect(loadConfig({}).port).toBe(3000);
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });
});

describe('smoke: el servidor HTTP responde en su punto de entrada (Req 14.2)', () => {
  it('responde 200 a GET / y GET /health', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;

      const root = await fetch(`http://127.0.0.1:${port}/`);
      expect(root.status).toBe(200);
      const body = (await root.json()) as { service: string; status: string };
      expect(body.service).toBe('repo-analyzer');
      expect(body.status).toBe('ok');

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
