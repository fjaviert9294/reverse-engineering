import { describe, it, expect } from 'vitest';
import type { ExtractedRepo } from '../ingestion/index.js';
import type { AnalysisResult } from '../domain/index.js';
import { detectLanguages, NO_SUPPORTED_LANGUAGES_NOTICE } from './language-detection.js';
import { identifyComponents, NO_KEY_COMPONENTS_NOTICE } from './component-identification.js';
import { generateFunctionalSummary } from './functional-summary.js';
import { inferArchitecture } from './architecture-inference.js';
import { findAdditional } from './additional-findings.js';
import { readConfigFiles, type ConfigContentReader } from './config-reader.js';
import {
  assembleStaticAnalysisResult,
  runStaticAnalysis,
  type StaticAnalysisParts,
  type AnalysisResultIdentity,
} from './static-analysis-result.js';

/**
 * Pruebas de ejemplo del ensamblado del `AnalysisResult` del análisis estático
 * (Task 8.18).
 *
 * Cubren:
 * - Requisito 3.1/3.5: el ensamblado produce un `AnalysisResult` bien formado con
 *   `analysisMode = "SOLO_ESTATICO"` a partir de las salidas de las tareas previas.
 * - Requisito 5.8: la indicación de "sin lenguajes soportados" se refleja en `notices`.
 * - Requisito 7.4: la indicación de "sin componentes clave" se refleja en `notices`.
 * - Requisitos 5.6/5.7: las notas de configuración se propagan a `configReadNotes`.
 */

/** Construye un `ExtractedRepo` mínimo a partir de rutas. */
function repoFromPaths(paths: string[]): ExtractedRepo {
  return {
    jobId: 'job-test',
    files: paths.map((path) => ({ path, size: 1 })),
    analyzableLanguages: [],
  };
}

/** Lector de contenido a partir de un mapa ruta -> contenido; ausentes -> null. */
function readerFrom(contents: Record<string, string>): ConfigContentReader {
  return async (relativePath: string) =>
    Object.prototype.hasOwnProperty.call(contents, relativePath) ? contents[relativePath] : null;
}

const IDENTITY: AnalysisResultIdentity = {
  id: 'result-1',
  jobId: 'job-test',
  createdAt: '2024-01-01T00:00:00.000Z',
};

/** Compone las piezas de análisis estático de un repositorio (sin configuración). */
function partsFrom(repo: ExtractedRepo): StaticAnalysisParts {
  const languageProfile = detectLanguages(repo);
  const components = identifyComponents(repo);
  const configRead = { files: [], notes: [] };
  return {
    languageProfile,
    configRead,
    functionalSummary: generateFunctionalSummary(repo),
    components,
    architecture: inferArchitecture(repo, components.components),
    additionalFindings: findAdditional(repo, configRead),
  };
}

describe('assembleStaticAnalysisResult - resultado bien formado (Requisitos 3.1, 3.5)', () => {
  it('compone todas las piezas y fija analysisMode = SOLO_ESTATICO', () => {
    const repo = repoFromPaths([
      'src/index.ts',
      'src/controllers/user.controller.ts',
      'src/models/user.ts',
      'package.json',
    ]);
    const parts = partsFrom(repo);

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    expect(result.analysisMode).toBe('SOLO_ESTATICO');
    expect(result.id).toBe(IDENTITY.id);
    expect(result.jobId).toBe(IDENTITY.jobId);
    expect(result.createdAt).toBe(IDENTITY.createdAt);
    expect(result.primaryLanguage).toBe(parts.languageProfile.primaryLanguage);
    expect(result.secondaryLanguages).toEqual(parts.languageProfile.secondaryLanguages);
    expect(result.functionalSummary).toBe(parts.functionalSummary);
    expect(result.keyComponents).toEqual(parts.components.components);
    expect(result.architecture).toBe(parts.architecture);
    expect(result.additionalFindings).toBe(parts.additionalFindings);
    expect(result.configReadNotes).toEqual([]);
  });

  it('no comparte referencia mutable con las salidas originales (copias defensivas)', () => {
    const repo = repoFromPaths(['src/index.ts', 'src/models/a.ts']);
    const parts = partsFrom(repo);

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    expect(result.secondaryLanguages).not.toBe(parts.languageProfile.secondaryLanguages);
    expect(result.keyComponents).not.toBe(parts.components.components);
    expect(result.configReadNotes).not.toBe(parts.configRead.notes);
  });

  it('propaga las notas de configuración a configReadNotes (Requisitos 5.6, 5.7)', () => {
    const repo = repoFromPaths(['src/index.ts']);
    const parts = partsFrom(repo);
    parts.configRead = {
      files: [],
      notes: ['No se encontró el archivo de configuración de dependencias de TypeScript.'],
    };

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    expect(result.configReadNotes).toEqual(parts.configRead.notes);
  });
});

describe('assembleStaticAnalysisResult - avisos (Requisitos 5.8, 7.4)', () => {
  it('incluye la indicación de "sin lenguajes soportados" en notices (5.8)', () => {
    const repo = repoFromPaths(['README.md', 'docs/guide.md']);
    const parts = partsFrom(repo);

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    expect(result.primaryLanguage).toBeNull();
    expect(result.secondaryLanguages).toEqual([]);
    expect(result.notices).toContain(NO_SUPPORTED_LANGUAGES_NOTICE);
  });

  it('incluye la indicación de "sin componentes clave" en notices (7.4)', () => {
    // Un archivo de código sin señales de componente no produce componentes.
    const repo = repoFromPaths(['src/util.ts']);
    const parts = partsFrom(repo);

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    expect(result.keyComponents).toEqual([]);
    expect(result.notices).toContain(NO_KEY_COMPONENTS_NOTICE);
  });

  it('no incluye avisos cuando hay lenguajes y componentes (notices vacío)', () => {
    const repo = repoFromPaths(['src/controllers/user.controller.ts', 'package.json']);
    const parts = partsFrom(repo);

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    expect(result.notices).toEqual([]);
  });

  it('no duplica ni incluye avisos vacíos', () => {
    const repo = repoFromPaths(['README.md']);
    const parts = partsFrom(repo);

    const result = assembleStaticAnalysisResult(parts, IDENTITY);

    const unique = new Set(result.notices);
    expect(unique.size).toBe(result.notices.length);
    expect(result.notices.every((n) => n.trim().length > 0)).toBe(true);
  });
});

describe('runStaticAnalysis - pipeline completo (Requisitos 3.1, 3.5)', () => {
  it('ejecuta el análisis estático completo y ensambla un AnalysisResult válido', async () => {
    const repo = repoFromPaths([
      'src/index.ts',
      'src/controllers/user.controller.ts',
      'src/services/user.service.ts',
      'src/models/user.ts',
      'package.json',
    ]);
    const reader = readerFrom({
      'package.json': JSON.stringify({ name: 'demo', dependencies: { express: '4.0.0' } }),
    });

    const result: AnalysisResult = await runStaticAnalysis(repo, reader, IDENTITY);

    expect(result.analysisMode).toBe('SOLO_ESTATICO');
    expect(result.primaryLanguage).toBe('TYPESCRIPT');
    expect(result.keyComponents.length).toBeGreaterThan(0);
    expect(result.functionalSummary.determined).toBe(true);
    // Coincide con lo que produciría el ensamblado directo de las piezas.
    const expectedConfig = await readConfigFiles(repo, detectLanguages(repo), reader);
    expect(result.configReadNotes).toEqual(expectedConfig.notes);
  });

  it('produce un resultado válido incluso sin lenguajes soportados (Requisito 5.8)', async () => {
    const repo = repoFromPaths(['README.md']);
    const reader = readerFrom({});

    const result = await runStaticAnalysis(repo, reader, IDENTITY);

    expect(result.analysisMode).toBe('SOLO_ESTATICO');
    expect(result.primaryLanguage).toBeNull();
    expect(result.functionalSummary.determined).toBe(false);
    expect(result.notices).toContain(NO_SUPPORTED_LANGUAGES_NOTICE);
  });
});
