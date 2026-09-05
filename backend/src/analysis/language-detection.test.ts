import { describe, it, expect } from 'vitest';
import type { ExtractedRepo } from '../ingestion/index.js';
import {
  detectLanguages,
  detectLanguagesFromPaths,
  NO_SUPPORTED_LANGUAGES_NOTICE,
} from './language-detection.js';

/**
 * Pruebas de ejemplo de la detección de lenguajes y prioridad (Task 8.1).
 *
 * Cubren la clasificación por extensión restringida a los cuatro lenguajes
 * soportados (Requisito 5.1), la designación determinista de principal/secundarios
 * según el orden fijo `Java > TypeScript > JavaScript > Python` (Requisito 5.2) y
 * la indicación de "sin lenguajes soportados" cuando no hay ninguno (Requisito 5.8).
 */

/** Construye un `ExtractedRepo` mínimo a partir de rutas, para las pruebas. */
function repoFromPaths(paths: string[]): ExtractedRepo {
  return {
    jobId: 'job-test',
    files: paths.map((path) => ({ path, size: 1 })),
    analyzableLanguages: [],
  };
}

describe('detectLanguages - clasificación por extensión (Requisito 5.1)', () => {
  it('clasifica archivos de los cuatro lenguajes soportados', () => {
    const profile = detectLanguagesFromPaths([
      'src/App.java',
      'src/index.ts',
      'web/main.js',
      'scripts/tool.py',
    ]);

    expect(profile.hasSupportedLanguages).toBe(true);
    expect(profile.primaryLanguage).toBe('JAVA');
    expect(profile.secondaryLanguages).toEqual(['TYPESCRIPT', 'JAVASCRIPT', 'PYTHON']);
  });

  it('ignora archivos de lenguajes no soportados', () => {
    const profile = detectLanguagesFromPaths([
      'main.go',
      'lib.rs',
      'index.html',
      'styles.css',
      'README.md',
      'data.json',
    ]);

    expect(profile.hasSupportedLanguages).toBe(false);
    expect(profile.primaryLanguage).toBeNull();
    expect(profile.secondaryLanguages).toEqual([]);
  });

  it('mezcla soportados y no soportados, conservando solo los soportados', () => {
    const profile = detectLanguagesFromPaths([
      'server.py',
      'main.go',
      'index.html',
      'utils.js',
    ]);

    expect(profile.primaryLanguage).toBe('JAVASCRIPT');
    expect(profile.secondaryLanguages).toEqual(['PYTHON']);
  });

  it('reconoce variantes de extensión de TypeScript y JavaScript', () => {
    const profile = detectLanguagesFromPaths([
      'component.tsx',
      'module.mjs',
      'legacy.cjs',
      'view.jsx',
    ]);

    expect(profile.primaryLanguage).toBe('TYPESCRIPT');
    expect(profile.secondaryLanguages).toEqual(['JAVASCRIPT']);
  });
});

describe('detectLanguages - prioridad determinista (Requisito 5.2)', () => {
  it('designa Java como principal cuando está presente junto a otros', () => {
    const profile = detectLanguagesFromPaths(['a.py', 'b.js', 'c.java']);
    expect(profile.primaryLanguage).toBe('JAVA');
    expect(profile.secondaryLanguages).toEqual(['JAVASCRIPT', 'PYTHON']);
  });

  it('designa TypeScript como principal cuando no hay Java', () => {
    const profile = detectLanguagesFromPaths(['a.py', 'b.js', 'c.ts']);
    expect(profile.primaryLanguage).toBe('TYPESCRIPT');
    expect(profile.secondaryLanguages).toEqual(['JAVASCRIPT', 'PYTHON']);
  });

  it('respeta el orden de prioridad independientemente del orden de los archivos', () => {
    const profile = detectLanguagesFromPaths(['z.py', 'y.py', 'x.ts', 'w.java']);
    expect(profile.primaryLanguage).toBe('JAVA');
    expect(profile.secondaryLanguages).toEqual(['TYPESCRIPT', 'PYTHON']);
  });

  it('no incluye duplicados cuando hay varios archivos del mismo lenguaje', () => {
    const profile = detectLanguagesFromPaths(['a.ts', 'b.ts', 'c.ts']);
    expect(profile.primaryLanguage).toBe('TYPESCRIPT');
    expect(profile.secondaryLanguages).toEqual([]);
  });

  it('con un único lenguaje soportado, no hay secundarios', () => {
    const profile = detectLanguagesFromPaths(['only.py']);
    expect(profile.primaryLanguage).toBe('PYTHON');
    expect(profile.secondaryLanguages).toEqual([]);
  });
});

describe('detectLanguages - sin lenguajes soportados (Requisito 5.8)', () => {
  it('indica ausencia de lenguajes soportados para un repositorio vacío', () => {
    const profile = detectLanguagesFromPaths([]);
    expect(profile.hasSupportedLanguages).toBe(false);
    expect(profile.primaryLanguage).toBeNull();
    expect(profile.secondaryLanguages).toEqual([]);
    expect(profile.notice).toBe(NO_SUPPORTED_LANGUAGES_NOTICE);
  });

  it('no incluye la indicación cuando sí hay lenguajes soportados', () => {
    const profile = detectLanguagesFromPaths(['main.ts']);
    expect(profile.notice).toBeUndefined();
  });
});

describe('detectLanguages - sobre ExtractedRepo', () => {
  it('deriva el perfil desde las rutas de los archivos del repositorio', () => {
    const repo = repoFromPaths(['src/Main.java', 'src/util.ts']);
    const profile = detectLanguages(repo);
    expect(profile.primaryLanguage).toBe('JAVA');
    expect(profile.secondaryLanguages).toEqual(['TYPESCRIPT']);
    expect(profile.hasSupportedLanguages).toBe(true);
  });
});
