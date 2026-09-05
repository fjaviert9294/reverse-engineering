import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';

import { createApplication } from './composition.js';

const servers: Array<ReturnType<typeof createApplication>['server']> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function loginWithEnvironment(nodeEnv: string): Promise<Response> {
  const app = createApplication({
    env: { NODE_ENV: nodeEnv },
  });
  servers.push(app.server);
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;

  return fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'demo1234' }),
  });
}

describe('usuario demo en el composition root', () => {
  it('permite autenticarse en desarrollo', async () => {
    const response = await loginWithEnvironment('development');

    expect(response.status).toBe(200);
  });

  it('no permite autenticarse fuera de desarrollo', async () => {
    const response = await loginWithEnvironment('production');

    expect(response.status).toBe(401);
  });
});
