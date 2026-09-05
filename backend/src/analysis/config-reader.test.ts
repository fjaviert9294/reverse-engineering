import { describe, it, expect } from 'vitest';
import type { ExtractedRepo } from '../ingestion/index.js';
import { detectLanguagesFromPaths } from './language-detection.js';
import { readConfigFiles, type ConfigContentReader } from './config-reader.js';
import type { LanguageProfile } from './types.js';

/**
 * Pruebas de ejemplo de la lectura de archivos de configuración por lenguaje
 * (Task 8.4).
 *
 * Cubren la lectura del archivo esperado según el lenguaje presente (Requisitos
 * 5.3, 5.4, 5.5), la continuación con nota ante ausencia del archivo esperado
 * (Requisito 5.6) y ante archivo corrupto/mal formado (Requisito 5.7), sin lanzar
 * excepción en ningún caso.
 */

/** Construye un `ExtractedRepo` mínimo a partir de rutas. */
function repoFromPaths(paths: string[]): ExtractedRepo {
  return {
    jobId: 'job-test',
    files: paths.map((path) => ({ path, size: 1 })),
    analyzableLanguages: [],
  };
}

/**
 * Construye un lector de contenido a partir de un mapa ruta -> contenido. Las
 * rutas ausentes devuelven `null`, simulando un fallo de lectura (Requisito 5.7).
 */
function readerFrom(contents: Record<string, string>): ConfigContentReader {
  return async (relativePath: string) => {
    return Object.prototype.hasOwnProperty.call(contents, relativePath)
      ? contents[relativePath]
      : null;
  };
}

/** Perfil de lenguajes derivado de las rutas, para acompañar al repositorio. */
function profileFrom(paths: string[]): LanguageProfile {
  return detectLanguagesFromPaths(paths);
}

describe('readConfigFiles - lectura por lenguaje presente (Requisitos 5.3, 5.4, 5.5)', () => {
  it('lee package.json para JavaScript/TypeScript (5.3)', async () => {
    const paths = ['src/index.ts', 'package.json'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'package.json': JSON.stringify({ name: 'demo', dependencies: { left: '^1.0.0' } }),
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.notes).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      kind: 'package.json',
      language: 'TYPESCRIPT',
      path: 'package.json',
    });
    expect(result.files[0].data).toMatchObject({ name: 'demo' });
  });

  it('lee pom.xml para Java (5.4)', async () => {
    const paths = ['src/Main.java', 'pom.xml'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>',
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.notes).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ kind: 'pom.xml', language: 'JAVA', path: 'pom.xml' });
  });

  it('lee build.gradle para Java cuando no hay pom.xml (5.4)', async () => {
    const paths = ['src/Main.java', 'build.gradle'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({ 'build.gradle': "plugins { id 'java' }" });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.notes).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ kind: 'build.gradle', language: 'JAVA' });
  });

  it('prefiere pom.xml sobre build.gradle cuando ambos existen (5.4)', async () => {
    const paths = ['src/Main.java', 'pom.xml', 'build.gradle'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'pom.xml': '<project></project>',
      'build.gradle': "plugins { id 'java' }",
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].kind).toBe('pom.xml');
  });

  it('lee requirements.txt para Python (5.5)', async () => {
    const paths = ['app.py', 'requirements.txt'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'requirements.txt': '# comentario\nflask==2.0.0\n\nrequests>=2.0\n',
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.notes).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ kind: 'requirements.txt', language: 'PYTHON' });
    expect(result.files[0].data).toEqual({ dependencies: ['flask==2.0.0', 'requests>=2.0'] });
  });

  it('lee pyproject.toml para Python cuando no hay requirements.txt (5.5)', async () => {
    const paths = ['app.py', 'pyproject.toml'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'pyproject.toml': '[project]\nname = "demo"\n',
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.notes).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ kind: 'pyproject.toml', language: 'PYTHON' });
  });

  it('localiza archivos de configuración en subdirectorios', async () => {
    const paths = ['backend/src/index.ts', 'backend/package.json'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({ 'backend/package.json': JSON.stringify({ name: 'nested' }) });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('backend/package.json');
  });

  it('lee la configuración de varios lenguajes presentes', async () => {
    const paths = ['Main.java', 'index.ts', 'app.py', 'pom.xml', 'package.json', 'requirements.txt'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'pom.xml': '<project></project>',
      'package.json': JSON.stringify({ name: 'multi' }),
      'requirements.txt': 'flask',
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.notes).toEqual([]);
    const kinds = result.files.map((f) => f.kind).sort();
    expect(kinds).toEqual(['package.json', 'pom.xml', 'requirements.txt']);
  });
});

describe('readConfigFiles - ausencia del archivo esperado (Requisito 5.6)', () => {
  it('continúa y registra nota cuando falta package.json', async () => {
    const paths = ['src/index.ts'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({});

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('TypeScript');
    expect(result.notes[0]).toContain('package.json');
  });

  it('registra una nota por cada lenguaje presente sin su configuración', async () => {
    const paths = ['Main.java', 'app.py'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({});

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(2);
    expect(result.notes.some((n) => n.includes('Java'))).toBe(true);
    expect(result.notes.some((n) => n.includes('Python'))).toBe(true);
  });

  it('la nota de Java menciona ambos archivos esperados', async () => {
    const paths = ['Main.java'];
    const repo = repoFromPaths(paths);

    const result = await readConfigFiles(repo, profileFrom(paths), readerFrom({}));

    expect(result.notes[0]).toContain('pom.xml');
    expect(result.notes[0]).toContain('build.gradle');
  });
});

describe('readConfigFiles - archivo corrupto/mal formado (Requisito 5.7)', () => {
  it('omite package.json con JSON inválido y registra nota, sin lanzar', async () => {
    const paths = ['index.js', 'package.json'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({ 'package.json': '{ "name": "demo", ' });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('package.json');
    expect(result.notes[0]).toContain('corrupto o mal formado');
  });

  it('omite package.json cuya raíz no es un objeto', async () => {
    const paths = ['index.js', 'package.json'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({ 'package.json': '[1, 2, 3]' });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(1);
  });

  it('omite pom.xml sin elemento raíz project', async () => {
    const paths = ['Main.java', 'pom.xml'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({ 'pom.xml': 'no es xml valido' });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('pom.xml');
  });

  it('omite pyproject.toml sin estructura TOML', async () => {
    const paths = ['app.py', 'pyproject.toml'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({ 'pyproject.toml': 'texto plano sin estructura' });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('pyproject.toml');
  });

  it('registra nota cuando el contenido no puede leerse (reader devuelve null)', async () => {
    const paths = ['index.ts', 'package.json'];
    const repo = repoFromPaths(paths);
    // El archivo existe en el repo pero el reader no tiene su contenido -> null.
    const reader = readerFrom({});

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    // Falta contenido -> no procesable; la nota debe indicar que no pudo leerse
    // el contenido (distinto de "ausente"), y no debe lanzar.
    expect(result.files).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('no se pudo leer su contenido');
  });

  it('preserva la lectura de otros lenguajes cuando uno está corrupto', async () => {
    const paths = ['Main.java', 'app.py', 'pom.xml', 'requirements.txt'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({
      'pom.xml': 'corrupto',
      'requirements.txt': 'flask==2.0.0',
    });

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].kind).toBe('requirements.txt');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('pom.xml');
  });
});

describe('readConfigFiles - sin lenguajes soportados', () => {
  it('devuelve resultado vacío sin notas cuando no hay lenguajes soportados', async () => {
    const paths = ['README.md', 'main.go'];
    const repo = repoFromPaths(paths);
    const reader = readerFrom({});

    const result = await readConfigFiles(repo, profileFrom(paths), reader);

    expect(result.files).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});
