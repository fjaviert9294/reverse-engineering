import { describe, it, expect } from 'vitest';
import type { ExtractedRepo } from '../ingestion/index.js';
import type { ArchitectureType, KeyComponent } from '../domain/index.js';
import {
  inferArchitecture,
  ARCHITECTURE_UNDETERMINED_NOTICE,
} from './architecture-inference.js';

/**
 * Pruebas de ejemplo de la inferencia de arquitectura heurística (Task 8.13).
 *
 * Cubren:
 * - Requisito 8.1: `type` pertenece al conjunto nombrado u `otro` (o es nulo si
 *   no se determina).
 * - Requisito 8.2: `confidencePct` está en [0, 100] y, por ser heurística, es
 *   inferior al 100%.
 * - Requisito 8.4: cuando `type` es `otro`, `evidence` es no vacía.
 * - Requisito 8.5: sin evidencia estructural, `type=null`, `determined=false`,
 *   `confidencePct=0` con indicación de "no determinada".
 */

/** Conjunto de tipos de arquitectura válidos (Requisito 8.1). */
const VALID_TYPES: ReadonlySet<ArchitectureType> = new Set<ArchitectureType>([
  'monolito',
  'microservicios',
  'mvc',
  'hexagonal',
  'por_capas',
  'otro',
]);

/** Construye un `ExtractedRepo` mínimo a partir de rutas, para las pruebas. */
function repoFromPaths(paths: string[]): ExtractedRepo {
  return {
    jobId: 'job-test',
    files: paths.map((path) => ({ path, size: 1 })),
    analyzableLanguages: [],
  };
}

describe('inferArchitecture - invariantes generales (Requisitos 8.1, 8.2)', () => {
  it('type pertenece al conjunto válido o es nulo, y confidencePct está en [0, 100]', () => {
    const repos = [
      repoFromPaths([]),
      repoFromPaths(['README.md']),
      repoFromPaths(['src/controllers/a.ts', 'src/models/b.ts', 'src/views/c.ts']),
      repoFromPaths(['services/auth/index.ts', 'services/billing/index.ts', 'docker-compose.yml']),
      repoFromPaths(['src/ports/repo.ts', 'src/adapters/db.ts', 'src/domain/user.ts']),
      repoFromPaths(['src/services/a.ts', 'src/repositories/b.ts', 'src/presentation/c.ts']),
    ];

    for (const repo of repos) {
      const result = inferArchitecture(repo);
      if (result.type !== null) {
        expect(VALID_TYPES.has(result.type)).toBe(true);
      }
      expect(result.confidencePct).toBeGreaterThanOrEqual(0);
      expect(result.confidencePct).toBeLessThan(100);
    }
  });
});

describe('inferArchitecture - clasificación por patrón (Requisito 8.1)', () => {
  it('detecta MVC con controladores, modelos y vistas', () => {
    const repo = repoFromPaths([
      'app/controllers/users.rb',
      'app/models/user.rb',
      'app/views/index.html',
    ]);
    const result = inferArchitecture(repo);

    expect(result.type).toBe('mvc');
    expect(result.determined).toBe(true);
  });

  it('detecta hexagonal con puertos y adaptadores', () => {
    const repo = repoFromPaths([
      'src/domain/user.ts',
      'src/ports/user-repository.ts',
      'src/adapters/postgres-user-repository.ts',
    ]);
    const result = inferArchitecture(repo);

    expect(result.type).toBe('hexagonal');
    expect(result.determined).toBe(true);
  });

  it('detecta microservicios con múltiples servicios y orquestación', () => {
    const repo = repoFromPaths([
      'services/auth/index.ts',
      'services/billing/index.ts',
      'docker-compose.yml',
    ]);
    const result = inferArchitecture(repo);

    expect(result.type).toBe('microservicios');
    expect(result.determined).toBe(true);
  });

  it('detecta arquitectura por capas con tres o más capas', () => {
    const repo = repoFromPaths([
      'src/services/user.ts',
      'src/repositories/user.ts',
      'src/presentation/user.ts',
    ]);
    const result = inferArchitecture(repo);

    expect(result.type).toBe('por_capas');
    expect(result.determined).toBe(true);
  });

  it('detecta monolito como unidad única con contenedor', () => {
    const repo = repoFromPaths(['src/app.ts', 'src/services/user.ts', 'Dockerfile']);
    const result = inferArchitecture(repo);

    expect(result.type).toBe('monolito');
    expect(result.determined).toBe(true);
  });
});

describe('inferArchitecture - categoría "otro" (Requisito 8.4)', () => {
  it('clasifica como otro con evidencia no vacía cuando no encaja en patrones nombrados', () => {
    // Un único indicio de puertos, sin adaptadores ni dominio: hay evidencia,
    // pero no configura un patrón nombrado -> "otro".
    const repo = repoFromPaths(['src/ports/queue.ts']);
    const result = inferArchitecture(repo);

    expect(result.type).toBe('otro');
    expect(result.determined).toBe(true);
    expect(result.evidence.trim().length).toBeGreaterThan(0);
  });

  it('la evidencia de "otro" siempre es no vacía', () => {
    const repo = repoFromPaths(['src/vistas/home.html']);
    const result = inferArchitecture(repo);

    if (result.type === 'otro') {
      expect(result.evidence.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('inferArchitecture - no determinada (Requisito 8.5)', () => {
  it('sin archivos indica que la arquitectura no pudo determinarse', () => {
    const result = inferArchitecture(repoFromPaths([]));

    expect(result.type).toBeNull();
    expect(result.determined).toBe(false);
    expect(result.confidencePct).toBe(0);
    expect(result.evidence).toBe(ARCHITECTURE_UNDETERMINED_NOTICE);
  });

  it('sin evidencia estructural relevante no determina la arquitectura', () => {
    const result = inferArchitecture(repoFromPaths(['README.md', 'docs/guide.txt', 'LICENSE']));

    expect(result.type).toBeNull();
    expect(result.determined).toBe(false);
    expect(result.confidencePct).toBe(0);
  });
});

describe('inferArchitecture - componentes clave como señal', () => {
  it('usa las categorías de los componentes para reforzar MVC', () => {
    const components: KeyComponent[] = [
      { path: 'a', category: 'controlador', inferred: true, confidence: 0.8 },
      { path: 'b', category: 'modelo', inferred: true, confidence: 0.8 },
    ];
    // Vistas por ruta; controlador/modelo por componentes.
    const repo = repoFromPaths(['templates/index.html']);
    const result = inferArchitecture(repo, components);

    expect(result.type).toBe('mvc');
  });
});

describe('inferArchitecture - determinismo', () => {
  it('produce el mismo resultado para la misma entrada', () => {
    const paths = ['src/services/a.ts', 'src/repositories/b.ts', 'src/controllers/c.ts'];
    const a = inferArchitecture(repoFromPaths(paths));
    const b = inferArchitecture(repoFromPaths(paths));

    expect(a).toEqual(b);
  });
});
