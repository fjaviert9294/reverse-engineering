import { describe, it, expect } from 'vitest';
import type { ExtractedRepo } from '../ingestion/index.js';
import {
  generateFunctionalSummary,
  FUNCTIONAL_SUMMARY_MIN_LENGTH,
  FUNCTIONAL_SUMMARY_MAX_LENGTH,
  FUNCTIONAL_SUMMARY_UNDETERMINED_NOTICE,
} from './functional-summary.js';

/**
 * Pruebas de ejemplo de la explicación funcional heurística (Task 8.7).
 *
 * Cubren:
 * - Requisito 6.1: cuando se determina, el resumen tiene entre 50 y 2000
 *   caracteres.
 * - Requisito 6.2: `confidencePct` está en [0, 100] y, por ser heurística, es
 *   inferior al 100%.
 * - Requisito 6.3: si no puede inferirse el propósito (sin lenguajes soportados),
 *   `determined=false` y `confidencePct=0` con indicación.
 */

/** Construye un `ExtractedRepo` mínimo a partir de rutas, para las pruebas. */
function repoFromPaths(paths: string[]): ExtractedRepo {
  return {
    jobId: 'job-test',
    files: paths.map((path) => ({ path, size: 1 })),
    analyzableLanguages: [],
  };
}

describe('generateFunctionalSummary - determinada (Requisitos 6.1, 6.2)', () => {
  it('produce un resumen dentro de [50, 2000] con lenguaje soportado', () => {
    const repo = repoFromPaths(['src/index.ts', 'package.json']);
    const result = generateFunctionalSummary(repo);

    expect(result.determined).toBe(true);
    expect(result.summary.length).toBeGreaterThanOrEqual(FUNCTIONAL_SUMMARY_MIN_LENGTH);
    expect(result.summary.length).toBeLessThanOrEqual(FUNCTIONAL_SUMMARY_MAX_LENGTH);
  });

  it('asigna confianza en [0, 100] e inferior al 100% por ser heurística', () => {
    const repo = repoFromPaths([
      'src/controllers/user.controller.ts',
      'src/services/user.service.ts',
      'src/models/user.model.ts',
      'package.json',
      'src/index.ts',
      'Dockerfile',
      'src/user.test.ts',
    ]);
    const result = generateFunctionalSummary(repo);

    expect(result.confidencePct).toBeGreaterThanOrEqual(0);
    expect(result.confidencePct).toBeLessThan(100);
  });

  it('más evidencia estructural incrementa la confianza', () => {
    const sparse = generateFunctionalSummary(repoFromPaths(['src/util.py']));
    const rich = generateFunctionalSummary(
      repoFromPaths([
        'src/controllers/a.py',
        'src/services/b.py',
        'src/models/c.py',
        'requirements.txt',
        'main.py',
        'Dockerfile',
        'tests/test_a.py',
      ]),
    );

    expect(rich.confidencePct).toBeGreaterThan(sparse.confidencePct);
  });

  it('describe el lenguaje principal en español', () => {
    const repo = repoFromPaths(['src/App.java', 'pom.xml']);
    const result = generateFunctionalSummary(repo);

    expect(result.summary).toContain('Java');
  });

  it('el resumen determinado nunca excede el máximo aunque haya muchos archivos', () => {
    const manyPaths = Array.from({ length: 500 }, (_, i) => `src/module${i}/service.ts`);
    const result = generateFunctionalSummary(repoFromPaths(['package.json', ...manyPaths]));

    expect(result.determined).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(FUNCTIONAL_SUMMARY_MAX_LENGTH);
    expect(result.summary.length).toBeGreaterThanOrEqual(FUNCTIONAL_SUMMARY_MIN_LENGTH);
  });
});

describe('generateFunctionalSummary - no determinada (Requisito 6.3)', () => {
  it('sin lenguajes soportados marca determined=false y confianza 0', () => {
    const repo = repoFromPaths(['README.md', 'docs/guide.txt', 'assets/logo.png']);
    const result = generateFunctionalSummary(repo);

    expect(result.determined).toBe(false);
    expect(result.confidencePct).toBe(0);
    expect(result.summary).toBe(FUNCTIONAL_SUMMARY_UNDETERMINED_NOTICE);
  });

  it('repositorio vacío no puede determinar el propósito', () => {
    const result = generateFunctionalSummary(repoFromPaths([]));

    expect(result.determined).toBe(false);
    expect(result.confidencePct).toBe(0);
  });
});

describe('generateFunctionalSummary - determinismo', () => {
  it('produce el mismo resultado para la misma entrada', () => {
    const paths = ['src/index.ts', 'src/services/a.ts', 'package.json'];
    const a = generateFunctionalSummary(repoFromPaths(paths));
    const b = generateFunctionalSummary(repoFromPaths(paths));

    expect(a).toEqual(b);
  });
});
