/**
 * Detección de código analizable durante la ingesta (Task 6.1).
 *
 * "Código analizable" son los archivos escritos en los lenguajes soportados por
 * el sistema: Java, TypeScript, JavaScript y Python (Requisito 1.7 en conjunto
 * con 5.1). La ingesta usa esta detección ligera, basada en extensión de
 * archivo, únicamente para decidir si el repositorio contiene algo analizable y
 * debe aceptarse. La detección de lenguaje principal/secundarios y su prioridad
 * es responsabilidad del análisis estático (Task 8.1), no de la ingesta.
 */

import type { SupportedLanguage } from '../domain/index.js';

/**
 * Mapa de extensión de archivo (en minúsculas, con punto) al lenguaje soportado
 * correspondiente. Se restringe estrictamente a los cuatro lenguajes soportados;
 * cualquier otra extensión se ignora (Requisito 5.1).
 */
const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, SupportedLanguage> = new Map([
  ['.java', 'JAVA'],
  ['.ts', 'TYPESCRIPT'],
  ['.tsx', 'TYPESCRIPT'],
  ['.js', 'JAVASCRIPT'],
  ['.jsx', 'JAVASCRIPT'],
  ['.mjs', 'JAVASCRIPT'],
  ['.cjs', 'JAVASCRIPT'],
  ['.py', 'PYTHON'],
]);

/**
 * Devuelve el lenguaje soportado de una ruta según su extensión, o `null` si su
 * extensión no corresponde a ningún lenguaje soportado. La comparación es
 * insensible a mayúsculas y se basa en el último segmento de la ruta.
 */
export function languageForPath(path: string): SupportedLanguage | null {
  const lastSlash = path.lastIndexOf('/');
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    // Sin extensión, o archivos ocultos sin extensión (p. ej. ".gitignore").
    return null;
  }
  const ext = name.slice(dot).toLowerCase();
  return EXTENSION_TO_LANGUAGE.get(ext) ?? null;
}

/**
 * Detecta el conjunto de lenguajes soportados presentes entre las rutas dadas,
 * preservando el orden de prioridad fijo `Java > TypeScript > JavaScript >
 * Python` (Requisito 5.2). El resultado no contiene duplicados y solo incluye
 * lenguajes soportados.
 */
export function detectAnalyzableLanguages(paths: readonly string[]): SupportedLanguage[] {
  const present = new Set<SupportedLanguage>();
  for (const path of paths) {
    const lang = languageForPath(path);
    if (lang !== null) {
      present.add(lang);
    }
  }
  const priorityOrder: SupportedLanguage[] = ['JAVA', 'TYPESCRIPT', 'JAVASCRIPT', 'PYTHON'];
  return priorityOrder.filter((lang) => present.has(lang));
}

/**
 * Indica si el conjunto de rutas contiene al menos un archivo de un lenguaje
 * soportado, es decir, si el repositorio tiene código analizable (Requisito 1.7).
 */
export function hasAnalyzableCode(paths: readonly string[]): boolean {
  return paths.some((path) => languageForPath(path) !== null);
}
