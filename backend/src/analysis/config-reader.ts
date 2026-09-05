/**
 * Lectura de archivos de configuración por lenguaje del Módulo de Análisis
 * Estático (Task 8.4).
 *
 * A partir del perfil de lenguajes detectado (Task 8.1) y de los archivos del
 * repositorio extraído, localiza y lee el archivo de configuración de
 * dependencias esperado de cada lenguaje soportado presente y registra notas de
 * las situaciones excepcionales.
 *
 * Mapa lenguaje -> archivo(s) de configuración (Requisitos 5.3, 5.4, 5.5):
 * | Lenguaje presente        | Archivos que se leen                 | Requisito |
 * | ------------------------ | ------------------------------------ | --------- |
 * | JavaScript / TypeScript  | `package.json`                       | 5.3       |
 * | Java                     | `pom.xml` o `build.gradle`           | 5.4       |
 * | Python                   | `requirements.txt` o `pyproject.toml`| 5.5       |
 *
 * Comportamiento robusto (nunca lanza excepción):
 * - Si un lenguaje soportado está presente pero no se encuentra ninguno de sus
 *   archivos de configuración esperados, el análisis continúa solo con el código
 *   y se registra una nota de que la configuración de dependencias de ese
 *   lenguaje no está disponible (Requisito 5.6).
 * - Si un archivo de configuración existe pero está corrupto o mal formado y no
 *   puede interpretarse, se omite sin lanzar excepción, el análisis continúa con
 *   las demás fuentes y se registra una nota de que ese archivo no pudo procesarse
 *   (Requisito 5.7).
 *
 * IMPORTANTE (Requisito 2.2): esta lectura opera sobre archivos de configuración
 * de dependencias (descriptores del proyecto), no sobre el código fuente. El
 * resultado (`ConfigReadResult`) contiene datos interpretados y notas, nunca
 * código fuente del repositorio.
 */

import type { SupportedLanguage } from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';
import type {
  ConfigFileKind,
  ConfigReadResult,
  LanguageProfile,
  ParsedConfigFile,
} from './types.js';

/**
 * Puerto de lectura del contenido de un archivo de configuración dentro del
 * espacio transitorio del job. Se mantiene agnóstico a la tecnología de
 * almacenamiento (decisión abierta del diseño): recibe la ruta relativa del
 * archivo tal como aparece en `ExtractedRepo.files` y devuelve su contenido de
 * texto, o `null` si el contenido no puede obtenerse (p. ej. error de lectura),
 * en cuyo caso se trata como archivo no procesable (Requisito 5.7).
 *
 * Debe ser tolerante a fallos: no debe lanzar; ante cualquier problema de I/O ha
 * de devolver `null` para que la lectura de configuración registre la nota
 * correspondiente y continúe.
 */
export type ConfigContentReader = (relativePath: string) => Promise<string | null>;

/** Metadatos de un archivo de configuración candidato para un lenguaje. */
interface ConfigCandidate {
  kind: ConfigFileKind;
  filename: string;
}

/**
 * Archivos de configuración esperados por lenguaje, en orden de preferencia. El
 * orden importa para Java y Python, donde hay más de un archivo válido: se
 * intentan en el orden listado y basta con encontrar uno para considerar
 * disponible la configuración del lenguaje.
 */
const CONFIG_FILES_BY_LANGUAGE: Readonly<Record<SupportedLanguage, readonly ConfigCandidate[]>> = {
  JAVASCRIPT: [{ kind: 'package.json', filename: 'package.json' }],
  TYPESCRIPT: [{ kind: 'package.json', filename: 'package.json' }],
  JAVA: [
    { kind: 'pom.xml', filename: 'pom.xml' },
    { kind: 'build.gradle', filename: 'build.gradle' },
  ],
  PYTHON: [
    { kind: 'requirements.txt', filename: 'requirements.txt' },
    { kind: 'pyproject.toml', filename: 'pyproject.toml' },
  ],
};

/**
 * Etiqueta legible del lenguaje para las notas dirigidas al usuario. Se mantiene
 * en español, coherente con el resto de mensajes del sistema (Requisito 10.5).
 */
const LANGUAGE_LABEL: Readonly<Record<SupportedLanguage, string>> = {
  JAVA: 'Java',
  TYPESCRIPT: 'TypeScript',
  JAVASCRIPT: 'JavaScript',
  PYTHON: 'Python',
};

/** Devuelve el último segmento (nombre de archivo) de una ruta con separador `/`. */
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Localiza en el repositorio la primera ruta cuyo nombre de archivo coincide con
 * `filename` (comparación exacta, sensible a mayúsculas como en los ecosistemas
 * correspondientes). Puede encontrarse en la raíz o en un subdirectorio; se
 * devuelve la primera coincidencia según el orden de `repo.files`.
 */
function findConfigPath(repo: ExtractedRepo, filename: string): string | null {
  for (const file of repo.files) {
    if (basename(file.path) === filename) {
      return file.path;
    }
  }
  return null;
}

/**
 * Interpreta el contenido de un archivo de configuración según su tipo. Devuelve
 * los datos interpretados o `null` si el contenido está corrupto/mal formado y no
 * puede procesarse (Requisito 5.7). Nunca lanza.
 *
 * - `package.json` y `pyproject.toml` (cuando es JSON no aplica): `package.json`
 *   se interpreta como JSON estricto; un JSON inválido es "no procesable".
 * - `requirements.txt`: se interpreta como lista de líneas de dependencia no
 *   vacías (ignorando comentarios y líneas en blanco). Es texto libre, por lo que
 *   solo se considera no procesable si el contenido no es texto.
 * - `pom.xml`, `build.gradle`, `pyproject.toml`: se conservan como texto crudo; se
 *   validan mínimamente para descartar contenido claramente truncado/corrupto.
 */
function parseConfigContent(kind: ConfigFileKind, content: string): unknown | null {
  switch (kind) {
    case 'package.json': {
      try {
        const parsed = JSON.parse(content);
        // Un `package.json` válido es un objeto JSON; un valor escalar o arreglo
        // en la raíz se considera mal formado para este propósito.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }
    case 'requirements.txt': {
      const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
      return { dependencies: lines };
    }
    case 'pom.xml': {
      // Validación mínima de bien-formado: debe contener el elemento raíz
      // `<project` de un POM. Un archivo sin él se considera corrupto/mal formado.
      if (!/<project[\s>]/i.test(content)) {
        return null;
      }
      return { raw: content };
    }
    case 'build.gradle': {
      // Un `build.gradle` es un script Groovy/Kotlin; basta con que sea texto no
      // vacío para conservarlo como crudo.
      if (content.trim().length === 0) {
        return null;
      }
      return { raw: content };
    }
    case 'pyproject.toml': {
      // Validación mínima de TOML: al menos una asignación `clave = valor` o una
      // cabecera de tabla `[seccion]`. Un contenido sin estructura TOML se trata
      // como no procesable.
      if (!/^\s*\[.+\]\s*$/m.test(content) && !/^\s*[^#\s].*=.*/m.test(content)) {
        return null;
      }
      return { raw: content };
    }
    default:
      return null;
  }
}

/**
 * Lee los archivos de configuración de dependencias de cada lenguaje soportado
 * presente en el repositorio (Requisitos 5.3–5.7).
 *
 * Recorre los lenguajes del perfil (principal + secundarios) y, para cada uno,
 * intenta localizar y leer alguno de sus archivos de configuración esperados. La
 * función nunca lanza: ante ausencia (5.6) o corrupción (5.7) registra la nota
 * correspondiente y continúa.
 *
 * @param repo Repositorio extraído (metadatos de archivos; sin código).
 * @param langs Perfil de lenguajes detectado (Task 8.1).
 * @param readContent Puerto para leer el contenido de un archivo por su ruta
 *   relativa; debe devolver `null` ante fallos de lectura, tratados como archivo
 *   no procesable (Requisito 5.7).
 */
export async function readConfigFiles(
  repo: ExtractedRepo,
  langs: LanguageProfile,
  readContent: ConfigContentReader,
): Promise<ConfigReadResult> {
  const files: ParsedConfigFile[] = [];
  const notes: string[] = [];

  // Lenguajes presentes en orden de prioridad (principal + secundarios), sin
  // duplicados. Si no hay lenguajes soportados, no hay configuración que leer.
  const presentLanguages: SupportedLanguage[] = langs.primaryLanguage
    ? [langs.primaryLanguage, ...langs.secondaryLanguages]
    : [];

  for (const language of presentLanguages) {
    const candidates = CONFIG_FILES_BY_LANGUAGE[language];

    // Localizar el primer archivo de configuración esperado que exista.
    let located: { candidate: ConfigCandidate; path: string } | null = null;
    for (const candidate of candidates) {
      const path = findConfigPath(repo, candidate.filename);
      if (path !== null) {
        located = { candidate, path };
        break;
      }
    }

    if (located === null) {
      // Requisito 5.6: lenguaje presente pero sin su archivo de configuración
      // esperado -> continuar solo con el código y registrar la indicación.
      const expected = candidates.map((c) => c.filename).join(' o ');
      notes.push(
        `No se encontró el archivo de configuración de dependencias de ${LANGUAGE_LABEL[language]} (${expected}); el análisis continúa solo con la información del código fuente.`,
      );
      continue;
    }

    // Leer el contenido del archivo localizado. Un fallo de lectura (null) se
    // trata como archivo no procesable (Requisito 5.7).
    const content = await readContent(located.path);
    if (content === null) {
      notes.push(
        `El archivo de configuración "${located.path}" (${LANGUAGE_LABEL[language]}) no pudo procesarse porque no se pudo leer su contenido; el análisis continúa con las demás fuentes.`,
      );
      continue;
    }

    // Interpretar el contenido. Un contenido corrupto/mal formado (null) se omite
    // registrando la nota, sin interrumpir el análisis (Requisito 5.7).
    const data = parseConfigContent(located.candidate.kind, content);
    if (data === null) {
      notes.push(
        `El archivo de configuración "${located.path}" (${LANGUAGE_LABEL[language]}) está corrupto o mal formado y no pudo procesarse; el análisis continúa con las demás fuentes.`,
      );
      continue;
    }

    files.push({
      kind: located.candidate.kind,
      language,
      path: located.path,
      data,
    });
  }

  return { files, notes };
}
