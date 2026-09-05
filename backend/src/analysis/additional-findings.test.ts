import { describe, it, expect } from 'vitest';
import type { ExtractedRepo } from '../ingestion/index.js';
import type { ConfigReadResult } from './types.js';
import {
  findAdditional,
  defaultVulnerabilityDetector,
  defaultOutdatedDependencyDetector,
  defaultApiEndpointDetector,
  type FindingsDetectors,
} from './additional-findings.js';

/**
 * Pruebas de ejemplo/unit de los hallazgos adicionales del análisis estático
 * (Task 8.15).
 *
 * Cubren:
 * - Requisito 9.1: vulnerabilidades con ubicación y severidad.
 * - Requisito 9.2: dependencias desactualizadas con nombre, versión detectada y
 *   versión más reciente.
 * - Requisito 9.3: endpoints con ruta y método.
 * - Requisito 9.4: ausencia de hallazgos -> `SIN_HALLAZGOS` por categoría.
 * - Requisito 9.5: categoría no analizable -> `NO_ANALIZABLE`, preservando las
 *   demás categorías.
 */

function repoFromPaths(paths: string[]): ExtractedRepo {
  return {
    jobId: 'job-test',
    files: paths.map((path) => ({ path, size: 1 })),
    analyzableLanguages: [],
  };
}

const emptyConfig: ConfigReadResult = { files: [], notes: [] };

describe('findAdditional - vulnerabilidades (Requisito 9.1)', () => {
  it('detecta material sensible expuesto con ubicación y severidad', () => {
    const repo = repoFromPaths(['src/index.ts', '.env', 'certs/server.key']);
    const { vulnerabilities } = findAdditional(repo, emptyConfig);

    expect(vulnerabilities.status).toBe('CON_HALLAZGOS');
    expect(vulnerabilities.items.length).toBe(2);
    for (const v of vulnerabilities.items) {
      expect(v.location.length).toBeGreaterThan(0);
      expect(v.severity.length).toBeGreaterThan(0);
    }
    expect(vulnerabilities.items.map((v) => v.location)).toContain('.env');
    expect(vulnerabilities.items.map((v) => v.location)).toContain('certs/server.key');
  });
});

describe('findAdditional - dependencias desactualizadas (Requisito 9.2)', () => {
  it('detecta una dependencia por debajo de la última versión conocida', () => {
    const config: ConfigReadResult = {
      files: [
        {
          kind: 'package.json',
          language: 'TYPESCRIPT',
          path: 'package.json',
          data: { dependencies: { lodash: '4.17.20' }, devDependencies: { vitest: '3.0.5' } },
        },
      ],
      notes: [],
    };
    const { outdatedDependencies } = findAdditional(repoFromPaths([]), config);

    expect(outdatedDependencies.status).toBe('CON_HALLAZGOS');
    expect(outdatedDependencies.items).toEqual([
      { name: 'lodash', detectedVersion: '4.17.20', latestVersion: '4.17.21' },
    ]);
  });

  it('reconoce fijaciones exactas en requirements.txt', () => {
    const config: ConfigReadResult = {
      files: [
        {
          kind: 'requirements.txt',
          language: 'PYTHON',
          path: 'requirements.txt',
          data: { dependencies: ['axios==1.0.0', '# comentario'] },
        },
      ],
      notes: [],
    };
    const { outdatedDependencies } = findAdditional(repoFromPaths([]), config);
    expect(outdatedDependencies.items).toEqual([
      { name: 'axios', detectedVersion: '1.0.0', latestVersion: '1.7.9' },
    ]);
  });

  it('no marca desactualizada una dependencia ya en la última versión', () => {
    const config: ConfigReadResult = {
      files: [
        {
          kind: 'package.json',
          language: 'TYPESCRIPT',
          path: 'package.json',
          data: { dependencies: { lodash: '4.17.21' } },
        },
      ],
      notes: [],
    };
    const { outdatedDependencies } = findAdditional(repoFromPaths([]), config);
    expect(outdatedDependencies.status).toBe('SIN_HALLAZGOS');
    expect(outdatedDependencies.items).toEqual([]);
  });
});

describe('findAdditional - endpoints de API (Requisito 9.3)', () => {
  it('detecta endpoints por directorio de rutas/controladores con ruta y método', () => {
    const repo = repoFromPaths([
      'src/routes/users.ts',
      'src/controllers/get-orders.ts',
      'src/models/user.ts',
    ]);
    const { apiEndpoints } = findAdditional(repo, emptyConfig);

    expect(apiEndpoints.status).toBe('CON_HALLAZGOS');
    for (const e of apiEndpoints.items) {
      expect(e.path.length).toBeGreaterThan(0);
      expect(e.method.length).toBeGreaterThan(0);
    }
    const orders = apiEndpoints.items.find((e) => e.path === 'src/controllers/get-orders.ts');
    expect(orders?.method).toBe('GET');
    const users = apiEndpoints.items.find((e) => e.path === 'src/routes/users.ts');
    expect(users?.method).toBe('ANY');
  });
});

describe('findAdditional - ausencia de hallazgos (Requisito 9.4)', () => {
  it('marca SIN_HALLAZGOS cada categoría cuando no hay evidencia', () => {
    const repo = repoFromPaths(['README.md', 'src/lib/util.ts']);
    const findings = findAdditional(repo, emptyConfig);

    expect(findings.vulnerabilities.status).toBe('SIN_HALLAZGOS');
    expect(findings.vulnerabilities.items).toEqual([]);
    expect(findings.outdatedDependencies.status).toBe('SIN_HALLAZGOS');
    expect(findings.outdatedDependencies.items).toEqual([]);
    expect(findings.apiEndpoints.status).toBe('SIN_HALLAZGOS');
    expect(findings.apiEndpoints.items).toEqual([]);
  });
});

describe('findAdditional - aislamiento de fallos (Requisito 9.5)', () => {
  it('marca NO_ANALIZABLE la categoría que falla y preserva las demás', () => {
    const detectors: FindingsDetectors = {
      vulnerabilities: () => {
        throw new Error('fuente de vulnerabilidades no disponible');
      },
      outdatedDependencies: defaultOutdatedDependencyDetector,
      apiEndpoints: defaultApiEndpointDetector,
    };
    const repo = repoFromPaths(['src/routes/users.ts']);
    const config: ConfigReadResult = {
      files: [
        {
          kind: 'package.json',
          language: 'TYPESCRIPT',
          path: 'package.json',
          data: { dependencies: { lodash: '1.0.0' } },
        },
      ],
      notes: [],
    };

    const findings = findAdditional(repo, config, detectors);

    // La categoría que falla queda NO_ANALIZABLE con lista vacía.
    expect(findings.vulnerabilities.status).toBe('NO_ANALIZABLE');
    expect(findings.vulnerabilities.items).toEqual([]);

    // Las demás categorías conservan sus resultados intactos.
    expect(findings.outdatedDependencies.status).toBe('CON_HALLAZGOS');
    expect(findings.outdatedDependencies.items).toEqual([
      { name: 'lodash', detectedVersion: '1.0.0', latestVersion: '4.17.21' },
    ]);
    expect(findings.apiEndpoints.status).toBe('CON_HALLAZGOS');
    expect(findings.apiEndpoints.items.length).toBeGreaterThan(0);
  });

  it('trata como NO_ANALIZABLE un detector que no devuelve un arreglo', () => {
    const detectors: FindingsDetectors = {
      vulnerabilities: defaultVulnerabilityDetector,
      outdatedDependencies: (() => undefined) as unknown as FindingsDetectors['outdatedDependencies'],
      apiEndpoints: defaultApiEndpointDetector,
    };
    const findings = findAdditional(repoFromPaths([]), emptyConfig, detectors);
    expect(findings.outdatedDependencies.status).toBe('NO_ANALIZABLE');
    expect(findings.outdatedDependencies.items).toEqual([]);
  });
});
