import { describe, expect, it } from 'vitest';

import { DefaultAuthService } from './auth-service.js';
import { InMemoryUserStore } from './user-store.js';
import {
  createDevelopmentDemoUser,
  DEVELOPMENT_DEMO_PASSWORD,
  DEVELOPMENT_DEMO_USERNAME,
} from './development-demo-user.js';

describe('usuario demo de desarrollo', () => {
  it('genera credenciales válidas para el entorno de desarrollo', async () => {
    const user = createDevelopmentDemoUser();
    const auth = new DefaultAuthService(new InMemoryUserStore([user]));

    const result = await auth.login(DEVELOPMENT_DEMO_USERNAME, DEVELOPMENT_DEMO_PASSWORD);

    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    expect(result.username).toBe(DEVELOPMENT_DEMO_USERNAME);
  });

  it('no guarda la contraseña en claro en el usuario', () => {
    const user = createDevelopmentDemoUser();

    expect(user.passwordHash).not.toBe(DEVELOPMENT_DEMO_PASSWORD);
    expect(user.passwordHash).toContain(':');
  });
});
