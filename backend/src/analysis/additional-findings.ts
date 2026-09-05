/**
 * Hallazgos adicionales del Módulo de Análisis Estático (Task 8.15).
 *
 * Produce `AdditionalFindings` con tres categorías independientes:
 * - **Vulnerabilidades**: cada hallazgo incluye ubicación y severidad (Requisito 9.1).
 * - **Dependencias desactualizadas**: nombre, versión detectada y versión más
 *   reciente conocida (Requisito 9.2).
 * - **Endpoints de API**: ruta y método (Requisito 9.3).
 *
 * Cada categoría lleva su propio `FindingCategory.status`
 * {`CON_HALLAZGOS` | `SIN_HALLAZGOS` | `NO_ANALIZABLE`} para distinguir la
 * ausencia de hallazgos (Requisito 9.4) de la imposibilidad de analizar la
 * categoría (Requisito 9.5). Las tres categorías se computan de forma **aislada**:
 * si la heurística de una lanza o no puede completarse, esa categoría se marca
 * `NO_ANALIZABLE` y las demás conservan sus resultados intactos (Requisito 9.5).
 *
 * DECISIÓN ABIERTA (diseño, "Decisiones abiertas" #4): la fuente concreta de las
 * heurísticas (índice de versiones para dependencias, base de vulnerabilidades,
 * detección de endpoints por framework) no está fijada. Por eso las heurísticas
 * se implementan **detrás de abstracciones** (`VulnerabilityDetector`,
 * `OutdatedDependencyDetector`, `ApiEndpointDetector`): este módulo fija la
 * *forma del resultado* y el *comportamiento* (aislamiento de fallos, estados por
 * categoría), no la fuente concreta. Se proveen adaptadores por defecto que
 * operan solo sobre metadatos disponibles (rutas y configuración ya
 * interpretada), sin comprometer una fuente externa concreta.
 *
 * IMPORTANTE (Requisito 2.2): las heurísticas por defecto solo consultan
 * metadatos del repositorio (rutas de archivo) y la configuración de dependencias
 * ya interpretada por la lectura de configuración (Task 8.4). No leen ni
 * transportan contenido del código fuente; `AdditionalFindings` es un
 * resultado/metadato persistible.
 */

import type {
  AdditionalFindings,
  ApiEndpoint,
  FindingCategory,
  OutdatedDep,
  Vulnerability,
} from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';
import type { ConfigReadResult, ParsedConfigFile } from './types.js';

// ---------------------------------------------------------------------------
// Abstracciones de detección (decisión abierta: la fuente concreta no se fija)
// ---------------------------------------------------------------------------

/**
 * Contexto de entrada compartido por los detectores. Agrupa los metadatos del
 * repositorio extraído y la configuración de dependencias ya interpretada, de
 * modo que cada detector reciba lo mismo y permanezca desacoplado de cómo se
 * obtuvieron.
 */
export interface FindingsContext {
  /** Repositorio extraído (metadatos de archivos; sin código). */
  repo: ExtractedRepo;
  /** Resultado de la lectura de configuración de dependencias (Task 8.4). */
  config: ConfigReadResult;
}

/**
 * Puerto de detección de vulnerabilidades (Requisito 9.1). La fuente concreta
 * (base de datos de vulnerabilidades, escáner, etc.) es una decisión abierta: el
 * puerto solo se compromete a devolver hallazgos con ubicación y severidad.
 *
 * Puede lanzar o rechazar si la categoría no puede analizarse; el orquestador de
 * hallazgos captura ese fallo y marca la categoría `NO_ANALIZABLE` sin afectar a
 * las demás (Requisito 9.5).
 */
export type VulnerabilityDetector = (ctx: FindingsContext) => Vulnerability[];

/**
 * Puerto de detección de dependencias desactualizadas (Requisito 9.2). La fuente
 * de la "versión más reciente conocida" es una decisión abierta; el puerto solo
 * se compromete a devolver hallazgos con nombre, versión detectada y versión más
 * reciente.
 */
export type OutdatedDependencyDetector = (ctx: FindingsContext) => OutdatedDep[];

/**
 * Puerto de detección de endpoints de API (Requisito 9.3). El mecanismo concreto
 * (patrones por framework, análisis de rutas) es una decisión abierta; el puerto
 * solo se compromete a devolver endpoints con ruta y método.
 */
export type ApiEndpointDetector = (ctx: FindingsContext) => ApiEndpoint[];

/**
 * Conjunto de detectores inyectables. Permite sustituir cualquiera de las tres
 * heurísticas sin tocar el ensamblado ni el aislamiento de fallos. Si no se
 * inyecta, `findAdditional` usa los adaptadores por defecto de este módulo.
 */
export interface FindingsDetectors {
  vulnerabilities: VulnerabilityDetector;
  outdatedDependencies: OutdatedDependencyDetector;
  apiEndpoints: ApiEndpointDetector;
}

// ---------------------------------------------------------------------------
// Ensamblado con aislamiento de fallos por categoría (Requisitos 9.4, 9.5)
// ---------------------------------------------------------------------------

/**
 * Ejecuta un detector de una categoría de forma aislada y lo envuelve en un
 * `FindingCategory<T>` con el estado correcto:
 *
 * - Si el detector produce al menos un hallazgo -> `CON_HALLAZGOS` (Requisito 9.1–9.3).
 * - Si el detector completa sin hallazgos -> `SIN_HALLAZGOS` (Requisito 9.4).
 * - Si el detector lanza (la categoría no pudo analizarse) -> `NO_ANALIZABLE`
 *   con lista vacía, sin propagar el fallo a las demás categorías (Requisito 9.5).
 *
 * El aislamiento se garantiza aquí: cualquier excepción del detector se captura y
 * se convierte en `NO_ANALIZABLE`, de modo que el fallo de una categoría nunca
 * altera los elementos ni el estado de las otras.
 */
function runCategory<T>(detect: () => T[]): FindingCategory<T> {
  try {
    const items = detect();
    // Un detector que devuelve `null`/`undefined` se trata como no analizable
    // para no producir un resultado mal formado.
    if (!Array.isArray(items)) {
      return { status: 'NO_ANALIZABLE', items: [] };
    }
    if (items.length === 0) {
      return { status: 'SIN_HALLAZGOS', items: [] };
    }
    return { status: 'CON_HALLAZGOS', items };
  } catch {
    return { status: 'NO_ANALIZABLE', items: [] };
  }
}

/**
 * Produce los hallazgos adicionales del análisis estático (Requisitos 9.1–9.5).
 *
 * Cada categoría se calcula de forma independiente mediante su detector y se
 * envuelve con su estado propio. El fallo de una categoría (detector que lanza o
 * no puede completarse) la marca `NO_ANALIZABLE` sin afectar a las demás
 * (Requisito 9.5). La función es determinista respecto a sus detectores y nunca
 * lanza.
 *
 * @param repo Repositorio extraído (metadatos de archivos; sin código).
 * @param config Configuración de dependencias ya interpretada (Task 8.4).
 * @param detectors Detectores a usar; por defecto, los adaptadores heurísticos de
 *   este módulo. La inyección mantiene abierta la decisión de la fuente concreta.
 */
export function findAdditional(
  repo: ExtractedRepo,
  config: ConfigReadResult,
  detectors: FindingsDetectors = DEFAULT_DETECTORS,
): AdditionalFindings {
  const ctx: FindingsContext = { repo, config };

  return {
    vulnerabilities: runCategory<Vulnerability>(() => detectors.vulnerabilities(ctx)),
    outdatedDependencies: runCategory<OutdatedDep>(() => detectors.outdatedDependencies(ctx)),
    apiEndpoints: runCategory<ApiEndpoint>(() => detectors.apiEndpoints(ctx)),
  };
}

// ---------------------------------------------------------------------------
// Adaptadores por defecto (heurísticas conservadoras sobre metadatos)
// ---------------------------------------------------------------------------

/** Devuelve el último segmento (nombre de archivo) de una ruta con separador `/`. */
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Adaptador por defecto de vulnerabilidades (Requisito 9.1).
 *
 * La fuente concreta es una decisión abierta; este adaptador aplica una
 * heurística conservadora basada únicamente en metadatos (rutas): señala como
 * hallazgo la presencia de archivos que denotan secretos o material sensible
 * expuestos en el repositorio (p. ej. `.env`, claves privadas). Cada hallazgo
 * incluye su ubicación (la ruta) y una severidad. No inspecciona contenido del
 * código (Requisito 2.2).
 *
 * Cuando no hay evidencia, devuelve una lista vacía, que el ensamblado traduce a
 * `SIN_HALLAZGOS` (Requisito 9.4).
 */
export const defaultVulnerabilityDetector: VulnerabilityDetector = ({ repo }) => {
  const findings: Vulnerability[] = [];
  const seen = new Set<string>();

  for (const file of repo.files) {
    const name = basename(file.path).toLowerCase();
    let severity: string | null = null;

    if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) {
      // Un archivo de entorno versionado puede filtrar credenciales.
      severity = 'alta';
    } else if (
      name.endsWith('.pem') ||
      name.endsWith('.key') ||
      name === 'id_rsa' ||
      name === 'id_dsa' ||
      name.endsWith('.pfx') ||
      name.endsWith('.p12')
    ) {
      // Material criptográfico privado expuesto en el repositorio.
      severity = 'critica';
    }

    if (severity !== null && !seen.has(file.path)) {
      seen.add(file.path);
      findings.push({ location: file.path, severity });
    }
  }

  return findings;
};

/**
 * Índice mínimo de "última versión conocida" por nombre de dependencia. La fuente
 * concreta (índice de paquetes remoto, réplica local, etc.) es una decisión
 * abierta; este mapa embebido actúa como adaptador por defecto para permitir la
 * detección sin comprometer una fuente externa. Puede sustituirse inyectando otro
 * `OutdatedDependencyDetector`.
 */
const KNOWN_LATEST_VERSIONS: Readonly<Record<string, string>> = {
  lodash: '4.17.21',
  express: '4.21.2',
  react: '19.1.0',
  axios: '1.7.9',
  typescript: '5.7.3',
  vitest: '3.0.5',
};

/**
 * Extrae pares `nombre -> versión detectada` de un `package.json` ya
 * interpretado. Combina `dependencies` y `devDependencies`; ignora entradas cuya
 * versión no sea una cadena. No lee código fuente (Requisito 2.2).
 */
function extractPackageJsonDeps(data: unknown): Map<string, string> {
  const deps = new Map<string, string>();
  if (data === null || typeof data !== 'object') {
    return deps;
  }
  const record = data as Record<string, unknown>;
  for (const key of ['dependencies', 'devDependencies']) {
    const section = record[key];
    if (section === null || typeof section !== 'object' || Array.isArray(section)) {
      continue;
    }
    for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
      if (typeof version === 'string' && version.trim().length > 0 && !deps.has(name)) {
        deps.set(name, version.trim());
      }
    }
  }
  return deps;
}

/**
 * Extrae pares `nombre -> versión detectada` de un `requirements.txt` ya
 * interpretado como `{ dependencies: string[] }`. Reconoce el operador `==`
 * (fijación exacta), única forma en la que la "versión detectada" es inequívoca.
 */
function extractRequirementsDeps(data: unknown): Map<string, string> {
  const deps = new Map<string, string>();
  if (data === null || typeof data !== 'object') {
    return deps;
  }
  const lines = (data as { dependencies?: unknown }).dependencies;
  if (!Array.isArray(lines)) {
    return deps;
  }
  for (const line of lines) {
    if (typeof line !== 'string') {
      continue;
    }
    const match = /^([A-Za-z0-9._-]+)\s*==\s*([0-9][0-9A-Za-z.+-]*)/.exec(line.trim());
    if (match && !deps.has(match[1])) {
      deps.set(match[1], match[2]);
    }
  }
  return deps;
}

/**
 * Normaliza una versión detectada a su forma numérica comparable, retirando
 * prefijos de rango habituales (`^`, `~`, `>=`, `=`, `v`). Devuelve `null` si no
 * puede reducirse a una versión semántica comparable.
 */
function normalizeVersion(raw: string): string | null {
  const cleaned = raw.replace(/^[\s^~>=<v]+/, '').trim();
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(cleaned);
  if (!match) {
    return null;
  }
  return match[0];
}

/**
 * Compara dos versiones semánticas simples (`a.b.c`). Devuelve un número negativo
 * si `a < b`, positivo si `a > b`, y 0 si son equivalentes.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Adaptador por defecto de dependencias desactualizadas (Requisito 9.2).
 *
 * Recorre los archivos de configuración ya interpretados (`package.json`,
 * `requirements.txt`) y, para cada dependencia cuya versión detectada sea
 * comparable y menor que la "última versión conocida" del índice embebido, emite
 * un hallazgo con nombre, versión detectada y versión más reciente. La fuente de
 * la última versión es una decisión abierta (aquí un índice embebido). No lee
 * código fuente (Requisito 2.2).
 */
export const defaultOutdatedDependencyDetector: OutdatedDependencyDetector = ({ config }) => {
  const findings: OutdatedDep[] = [];
  const seen = new Set<string>();

  for (const file of config.files) {
    const detected = extractDepsFromConfig(file);
    for (const [name, version] of detected) {
      const latest = KNOWN_LATEST_VERSIONS[name.toLowerCase()];
      if (latest === undefined) {
        continue;
      }
      const normalized = normalizeVersion(version);
      if (normalized === null) {
        continue;
      }
      if (compareVersions(normalized, latest) < 0 && !seen.has(name)) {
        seen.add(name);
        findings.push({ name, detectedVersion: version, latestVersion: latest });
      }
    }
  }

  return findings;
};

/** Selecciona el extractor de dependencias adecuado según el tipo de archivo. */
function extractDepsFromConfig(file: ParsedConfigFile): Map<string, string> {
  switch (file.kind) {
    case 'package.json':
      return extractPackageJsonDeps(file.data);
    case 'requirements.txt':
      return extractRequirementsDeps(file.data);
    default:
      // `pom.xml`, `build.gradle` y `pyproject.toml` se conservan como texto crudo
      // por la lectura de configuración; su análisis fino de versiones queda para
      // una fuente concreta futura (decisión abierta).
      return new Map();
  }
}

/**
 * Métodos HTTP reconocidos al inferir endpoints por patrones de ruta/nombre. Se
 * usa "ANY" cuando el método no puede deducirse de los metadatos disponibles.
 */
const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/**
 * Adaptador por defecto de endpoints de API (Requisito 9.3).
 *
 * El mecanismo concreto (análisis por framework) es una decisión abierta; este
 * adaptador aplica una heurística por metadatos: interpreta como endpoint cada
 * archivo cuya ruta reside bajo directorios de rutas/controladores/endpoints
 * (`routes`, `controllers`, `api`, `endpoints`, `handlers`, `resources`). La ruta
 * del endpoint se deriva de la ubicación del archivo y el método se marca `ANY`
 * cuando no puede deducirse de los metadatos. No lee código fuente (Requisito 2.2).
 *
 * Cuando no hay evidencia, devuelve una lista vacía -> `SIN_HALLAZGOS` (9.4).
 */
export const defaultApiEndpointDetector: ApiEndpointDetector = ({ repo }) => {
  const findings: ApiEndpoint[] = [];
  const seen = new Set<string>();
  const routeDir = /(^|\/)(routes?|routers?|controllers?|controladores?|api|endpoints?|handlers?|resources?)(\/|$)/i;

  for (const file of repo.files) {
    const path = file.path;
    if (!isSourceLikePath(path) || !routeDir.test(path)) {
      continue;
    }
    const method = inferMethodFromName(basename(path));
    const key = `${method} ${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ path, method });
    }
  }

  return findings;
};

/** Indica si una ruta corresponde a un archivo de código de los lenguajes soportados. */
function isSourceLikePath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/i.test(path);
}

/**
 * Deduce el método HTTP a partir del nombre de archivo cuando este lo denota de
 * forma explícita (p. ej. `get-users.ts`, `users.post.ts`); en otro caso devuelve
 * `ANY`, indicando que el método no pudo deducirse de los metadatos.
 */
function inferMethodFromName(filename: string): string {
  const lower = filename.toLowerCase();
  for (const method of HTTP_METHODS) {
    const m = method.toLowerCase();
    if (
      lower.startsWith(`${m}-`) ||
      lower.startsWith(`${m}_`) ||
      lower.startsWith(`${m}.`) ||
      lower.includes(`.${m}.`) ||
      lower.includes(`-${m}.`) ||
      lower.includes(`_${m}.`)
    ) {
      return method;
    }
  }
  return 'ANY';
}

/**
 * Detectores por defecto usados por `findAdditional` cuando no se inyectan otros.
 * Encapsulan las heurísticas conservadoras sobre metadatos, manteniendo abierta
 * la decisión de la fuente concreta (diseño, Decisiones abiertas #4).
 */
export const DEFAULT_DETECTORS: FindingsDetectors = {
  vulnerabilities: defaultVulnerabilityDetector,
  outdatedDependencies: defaultOutdatedDependencyDetector,
  apiEndpoints: defaultApiEndpointDetector,
};
