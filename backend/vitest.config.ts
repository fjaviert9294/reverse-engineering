import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests se coubican con el código fuente usando el sufijo .test.ts
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
