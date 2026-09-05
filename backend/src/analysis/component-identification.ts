/**
 * Identificación de componentes clave del Módulo de Análisis Estático (Task 8.11).
 *
 * A partir únicamente de los metadatos del repositorio extraído (rutas y
 * tamaños, nunca el contenido del código fuente), clasifica cada archivo
 * relevante en exactamente una `ComponentCategory`
 * {modulo | servicio | controlador | modelo | punto_de_entrada | configuracion}
 * mediante heurísticas y reglas por ruta/nombre (sin IA). Produce una lista de
 * `KeyComponent`, y cuando la categoría se determina por inferencia asocia un
 * `Nivel_Confianza` en [0.00, 1.00].
 *
 * Trazabilidad de requisitos:
 * - 7.1: cada componente incluye su ruta/ubicación (no vacía) y su categoría,
 *   clasificada en exactamente una de las seis categorías del dominio.
 * - 7.2: cuando la categoría se determina por inferencia (`inferred=true`), se
 *   asocia un `Nivel_Confianza` (`confidence`) en el rango [0.00, 1.00].
 * - 7.4: si no se identifica ningún componente, se devuelve una lista vacía y una
 *   indicación explícita de que no se identificaron componentes clave, sin
 *   interrumpir el análisis.
 *
 * IMPORTANTE (Requisito 2.2): la heurística solo consulta metadatos del
 * repositorio (rutas de archivo). No lee ni transporta contenido del código
 * fuente; `KeyComponent` registra únicamente la ubicación y la clasificación.
 *
 * NATURALEZA HEURÍSTICA (Requisito 7.2): las categorías inferidas por reglas
 * estructurales nunca alcanzan certeza absoluta; su `confidence` se acota por
 * debajo de 1.00. Solo los archivos de configuración reconocidos de forma
 * exacta se consideran no inferidos (identificación directa por nombre), por lo
 * que carecen de `confidence`.
 */

import type { ComponentCategory, KeyComponent } from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';

/**
 * Indicación de que no se identificaron componentes clave (Requisito 7.4). Se
 * expone como constante para reutilizarla en mensajes y pruebas sin duplicar
 * texto. Acompaña a la lista vacía sin interrumpir el análisis.
 */
export const NO_KEY_COMPONENTS_NOTICE =
  'El análisis estático no identificó componentes clave en el repositorio; el análisis continúa con las demás fuentes.';

/**
 * Confianza máxima de una categoría inferida. Se mantiene por debajo de 1.00
 * porque la clasificación por ruta/nombre es una inferencia, no una certeza
 * (Requisito 7.2).
 */
const INFERRED_MAX_CONFIDENCE = 0.95;

/**
 * Resultado de la identificación de componentes clave (Requisitos 7.1, 7.2, 7.4).
 *
 * - `components` contiene los componentes identificados, cada uno bien formado
 *   (ruta no vacía, categoría del conjunto y `confidence` en [0.00, 1.00] cuando
 *   es inferido).
 * - `notice` está presente únicamente cuando `components` está vacía, con la
 *   indicación exigida por 7.4; alimenta `AnalysisResult.notices`.
 */
export interface ComponentIdentificationResult {
  components: KeyComponent[];
  notice?: string;
}

/** Nombres de archivo de configuración reconocidos de forma exacta (7.1: configuracion). */
const CONFIG_FILENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'tsconfig.json',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env',
  'application.properties',
  'application.yml',
  'application.yaml',
]);

/** Nombres de archivo que sugieren un punto de entrada (7.1: punto_de_entrada). */
const ENTRY_POINT_FILENAMES: ReadonlySet<string> = new Set([
  'index.ts',
  'index.js',
  'index.mjs',
  'index.cjs',
  'main.ts',
  'main.js',
  'server.ts',
  'server.js',
  'app.ts',
  'app.js',
  'main.py',
  '__main__.py',
  'app.py',
  'manage.py',
  'wsgi.py',
  'asgi.py',
  'main.java',
  'application.java',
]);

/**
 * Regla de clasificación por ruta: si el patrón coincide con la ruta (en
 * minúsculas), el archivo se atribuye a `category` con la `confidence` indicada.
 * Las reglas se evalúan en orden; gana la primera que coincide, salvo las
 * clasificaciones directas por nombre (configuración y punto de entrada), que
 * tienen prioridad.
 */
interface CategoryRule {
  pattern: RegExp;
  category: ComponentCategory;
  confidence: number;
}

/**
 * Reglas heurísticas de categoría por segmento de ruta. El orden refleja la
 * especificidad: controladores/servicios/modelos antes que "módulo" genérico.
 */
const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    pattern: /(^|\/)(controllers?|controladores?|routes?|routers?|endpoints?|handlers?|resources?)(\/|$)/,
    category: 'controlador',
    confidence: 0.8,
  },
  {
    pattern: /(^|\/)(services?|servicios?|usecases?|use-cases?|application)(\/|$)/,
    category: 'servicio',
    confidence: 0.8,
  },
  {
    pattern: /(^|\/)(models?|modelos?|entities?|entity|domain|dominio|schemas?|dtos?)(\/|$)/,
    category: 'modelo',
    confidence: 0.75,
  },
  {
    pattern: /(^|\/)(repositories?|repository|repositorios?|dao|persistence|persistencia)(\/|$)/,
    category: 'servicio',
    confidence: 0.65,
  },
  {
    pattern: /(^|\/)(modules?|modulos?)(\/|$)/,
    category: 'modulo',
    confidence: 0.7,
  },
  {
    // Sufijos habituales en el nombre de archivo (p. ej. UserController.java).
    pattern: /(controller|controlador)\.[cm]?[jt]sx?$|(controller|controlador)\.py$|(controller|controlador)\.java$/,
    category: 'controlador',
    confidence: 0.7,
  },
  {
    pattern: /(service|servicio)\.[cm]?[jt]sx?$|(service|servicio)\.py$|(service|servicio)\.java$/,
    category: 'servicio',
    confidence: 0.7,
  },
];

/** Devuelve el último segmento (nombre de archivo) de una ruta con separador `/`. */
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Clasifica un único archivo en un `KeyComponent`, o devuelve `null` si la ruta
 * no aporta señales suficientes para atribuirle una categoría.
 *
 * Reglas de precedencia:
 * 1. Configuración reconocida por nombre exacto -> `configuracion`, identificada
 *    de forma directa (`inferred=false`, sin `confidence`).
 * 2. Punto de entrada reconocido por nombre exacto -> `punto_de_entrada`,
 *    inferido con confianza alta.
 * 3. Reglas heurísticas por ruta/nombre -> categoría inferida con su confianza.
 */
function classifyFile(path: string): KeyComponent | null {
  // Ruta no vacía es requisito (7.1); se descartan entradas sin ruta útil.
  if (path.trim().length === 0) {
    return null;
  }

  const name = basename(path);
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();

  // 1) Configuración: identificación directa por nombre exacto (no inferida).
  if (CONFIG_FILENAMES.has(lowerName)) {
    return { path, category: 'configuracion', inferred: false };
  }

  // 2) Punto de entrada: identificación directa por nombre exacto. Aun así se
  //    trata como inferido (la semántica de "entrada" es heurística, no un hecho
  //    declarado), con confianza alta acotada por debajo de 1.00 (7.2).
  if (ENTRY_POINT_FILENAMES.has(lowerName)) {
    return {
      path,
      category: 'punto_de_entrada',
      confidence: INFERRED_MAX_CONFIDENCE,
      inferred: true,
    };
  }

  // 3) Reglas heurísticas por ruta/nombre; gana la primera coincidencia.
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(lowerPath)) {
      return {
        path,
        category: rule.category,
        confidence: clampConfidence(rule.confidence),
        inferred: true,
      };
    }
  }

  return null;
}

/** Acota un valor de confianza al rango [0.00, 1.00] exigido por 7.2. */
function clampConfidence(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Identifica los componentes clave de un repositorio extraído (Requisitos 7.1,
 * 7.2, 7.4).
 *
 * - Recorre las rutas de los archivos y clasifica cada una en exactamente una
 *   categoría cuando hay señales suficientes; los archivos sin señales se
 *   ignoran (no todo archivo es un componente clave).
 * - Cada componente producido tiene `path` no vacío y una `category` del
 *   conjunto; los inferidos llevan `confidence` en [0.00, 1.00] (7.1, 7.2).
 * - Si no se identifica ningún componente, devuelve `components: []` junto a una
 *   indicación explicativa en `notice`, sin interrumpir el análisis (7.4).
 *
 * La función es determinista y no lanza; opera solo sobre metadatos del
 * repositorio (rutas), sin leer el código fuente (Requisito 2.2). El orden de
 * los componentes preserva el orden de aparición de los archivos, con
 * deduplicación por ruta.
 */
export function identifyComponents(repo: ExtractedRepo): ComponentIdentificationResult {
  const components: KeyComponent[] = [];
  const seenPaths = new Set<string>();

  for (const file of repo.files) {
    const path = file.path;
    if (seenPaths.has(path)) {
      continue;
    }

    const component = classifyFile(path);
    if (component !== null) {
      seenPaths.add(path);
      components.push(component);
    }
  }

  if (components.length === 0) {
    return { components, notice: NO_KEY_COMPONENTS_NOTICE };
  }

  return { components };
}

/**
 * Variante que opera directamente sobre un conjunto de rutas. Útil para clientes
 * que solo disponen de rutas (por ejemplo, pruebas). Aplica exactamente las
 * mismas reglas de clasificación y el mismo tratamiento del caso vacío
 * (Requisitos 7.1, 7.2, 7.4).
 */
export function identifyComponentsFromPaths(
  paths: readonly string[],
): ComponentIdentificationResult {
  const files = paths.map((path) => ({ path, size: 0 }));
  return identifyComponents({ jobId: 'paths-only', files, analyzableLanguages: [] });
}
