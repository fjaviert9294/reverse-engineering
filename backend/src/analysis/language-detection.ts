/**
 * Detección de lenguajes y prioridad del Módulo de Análisis Estático (Task 8.1).
 *
 * Clasifica los archivos del repositorio extraído por extensión en los cuatro
 * lenguajes soportados {Java, TypeScript, JavaScript, Python}, ignorando el
 * resto, y produce un `LanguageProfile` que designa el lenguaje principal según
 * el orden fijo `Java > TypeScript > JavaScript > Python` y lista los secundarios
 * en ese mismo orden. Cuando no hay ninguno de los cuatro, finaliza con la
 * indicación de "sin lenguajes soportados".
 *
 * Trazabilidad de requisitos:
 * - 5.1: se clasifican por extensión los archivos en los cuatro lenguajes
 *   soportados; los archivos de otros lenguajes se ignoran.
 * - 5.2: el lenguaje principal es el primero presente según el orden de
 *   prioridad; los demás soportados se listan como secundarios en ese orden.
 * - 5.8: si no hay ninguno de los cuatro lenguajes, se finaliza con la indicación
 *   de que el repositorio no contiene lenguajes soportados.
 *
 * La clasificación por extensión reutiliza `detectAnalyzableLanguages` del módulo
 * de ingesta, que ya restringe al conjunto soportado y preserva el orden de
 * prioridad; así se evita duplicar el mapa de extensiones y se mantiene una única
 * fuente de verdad para la asociación extensión → lenguaje (Requisito 5.1).
 */

import type { SupportedLanguage } from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';
import { detectAnalyzableLanguages } from '../ingestion/index.js';
import type { LanguageProfile } from './types.js';

/**
 * Mensaje de indicación de "sin lenguajes soportados" (Requisito 5.8). Se expone
 * como constante para reutilizarlo en mensajes y pruebas sin duplicar texto.
 */
export const NO_SUPPORTED_LANGUAGES_NOTICE =
  'El repositorio no contiene código en ninguno de los lenguajes soportados (Java, TypeScript, JavaScript o Python).';

/**
 * Deriva el `LanguageProfile` a partir del conjunto ordenado de lenguajes
 * soportados presentes. `presentInPriorityOrder` debe venir ya en el orden de
 * prioridad `Java > TypeScript > JavaScript > Python` y sin duplicados.
 *
 * El primer elemento es el lenguaje principal (Requisito 5.2) y el resto son los
 * secundarios en el mismo orden. Si el conjunto está vacío, el perfil indica que
 * no hay lenguajes soportados (Requisito 5.8).
 */
function buildProfile(presentInPriorityOrder: readonly SupportedLanguage[]): LanguageProfile {
  if (presentInPriorityOrder.length === 0) {
    return {
      primaryLanguage: null,
      secondaryLanguages: [],
      hasSupportedLanguages: false,
      notice: NO_SUPPORTED_LANGUAGES_NOTICE,
    };
  }

  const [primaryLanguage, ...secondaryLanguages] = presentInPriorityOrder;
  return {
    primaryLanguage,
    secondaryLanguages,
    hasSupportedLanguages: true,
  };
}

/**
 * Detecta el perfil de lenguajes de un repositorio extraído (Requisitos 5.1, 5.2,
 * 5.8). Clasifica por extensión los archivos del repositorio, ignora los que no
 * pertenecen a un lenguaje soportado y designa principal/secundarios según la
 * prioridad fija.
 */
export function detectLanguages(repo: ExtractedRepo): LanguageProfile {
  const paths = repo.files.map((file) => file.path);
  const present = detectAnalyzableLanguages(paths);
  return buildProfile(present);
}

/**
 * Variante que opera directamente sobre un conjunto de rutas. Útil para clientes
 * que solo disponen de rutas (por ejemplo, pruebas) y como base de
 * `detectLanguages`. Aplica exactamente las mismas reglas de clasificación y
 * prioridad (Requisitos 5.1, 5.2, 5.8).
 */
export function detectLanguagesFromPaths(paths: readonly string[]): LanguageProfile {
  const present = detectAnalyzableLanguages(paths);
  return buildProfile(present);
}
