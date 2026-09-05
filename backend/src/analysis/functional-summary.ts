/**
 * Explicación funcional heurística del Módulo de Análisis Estático (Task 8.7).
 *
 * Produce un `FunctionalSummary` que describe el propósito principal y las
 * funcionalidades del repositorio a partir únicamente de señales estructurales
 * (rutas, tamaños y lenguajes detectados), sin usar IA y sin leer el contenido
 * del código fuente.
 *
 * Trazabilidad de requisitos:
 * - 6.1: cuando el propósito se determina, se produce una explicación funcional
 *   con una extensión de entre 50 y 2000 caracteres.
 * - 6.2: como se trata de una inferencia heurística (nunca 100% de certeza), se
 *   asocia y expone un `Nivel_Confianza` en la escala [0, 100].
 * - 6.3: si el análisis no puede inferir el propósito del repositorio, se indica
 *   que la explicación funcional no pudo determinarse y se asocia una confianza
 *   de 0% (`determined=false`, `confidencePct=0`).
 *
 * IMPORTANTE (Requisito 2.2): la heurística solo consulta metadatos del
 * repositorio extraído (rutas y tamaños de archivos y el perfil de lenguajes); no
 * lee ni transporta contenido del código fuente. El `FunctionalSummary`
 * resultante es un resultado/metadato persistible.
 *
 * NATURALEZA HEURÍSTICA (Requisito 6.2): al inferirse por reglas estructurales, la
 * confianza nunca alcanza el 100%; se acota a un máximo por debajo de 100 para
 * reflejar que la explicación es una inferencia y no una certeza. La eventual
 * inferencia por IA (Modulo_Inferencia_IA) puede enriquecer o sustituir este
 * resumen en tareas posteriores.
 */

import type { FunctionalSummary, SupportedLanguage } from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';
import { detectLanguages } from './language-detection.js';
import type { LanguageProfile } from './types.js';

/** Longitud mínima de la explicación funcional cuando se determina (Requisito 6.1). */
export const FUNCTIONAL_SUMMARY_MIN_LENGTH = 50;
/** Longitud máxima de la explicación funcional cuando se determina (Requisito 6.1). */
export const FUNCTIONAL_SUMMARY_MAX_LENGTH = 2000;

/**
 * Confianza máxima que puede asignar la heurística. Se mantiene por debajo de 100
 * porque el resumen es una inferencia estructural, no una certeza (Requisito 6.2).
 */
const HEURISTIC_MAX_CONFIDENCE = 85;
/** Confianza base cuando se ha determinado un propósito con señales mínimas. */
const HEURISTIC_BASE_CONFIDENCE = 40;

/**
 * Mensaje que indica que la explicación funcional no pudo determinarse
 * (Requisito 6.3). Se expone como constante para reutilizarlo en mensajes y
 * pruebas sin duplicar texto. Tiene al menos 50 caracteres, pero cuando la
 * explicación no se determina el `summary` no está sujeto al rango [50, 2000]
 * (ese rango aplica solo al caso determinado, Requisito 6.1).
 */
export const FUNCTIONAL_SUMMARY_UNDETERMINED_NOTICE =
  'No se pudo determinar la explicación funcional del repositorio a partir del análisis estático: no se encontró evidencia estructural suficiente para inferir su propósito.';

/** Etiqueta legible del lenguaje, en español, coherente con el resto del sistema. */
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
 * Señales estructurales detectadas en el repositorio, usadas tanto para redactar
 * la explicación como para modular el `Nivel_Confianza`.
 */
interface StructuralSignals {
  /** Nombres de archivo de configuración de dependencias presentes. */
  configFiles: string[];
  /** Rutas que parecen puntos de entrada del proyecto. */
  entryPoints: string[];
  /** Indicios de exposición de una API/servicio web. */
  hasWebApi: boolean;
  /** Indicios de una organización por capas/roles (controladores, servicios, modelos). */
  layerHints: string[];
  /** Indicios de la presencia de pruebas automatizadas. */
  hasTests: boolean;
  /** Indicios de contenedorización/orquestación (Docker, compose). */
  hasContainerization: boolean;
  /** Número de archivos de código de lenguajes soportados. */
  sourceFileCount: number;
}

const CONFIG_FILENAMES = new Set([
  'package.json',
  'pom.xml',
  'build.gradle',
  'requirements.txt',
  'pyproject.toml',
]);

const ENTRY_POINT_FILENAMES = new Set([
  'index.ts',
  'index.js',
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
  'main.java',
  'application.java',
]);

/** Extrae señales estructurales de las rutas del repositorio (sin leer contenido). */
function collectSignals(repo: ExtractedRepo): StructuralSignals {
  const configFiles: string[] = [];
  const entryPoints: string[] = [];
  const layerHints = new Set<string>();
  let hasWebApi = false;
  let hasTests = false;
  let hasContainerization = false;

  for (const file of repo.files) {
    const path = file.path;
    const lowerPath = path.toLowerCase();
    const name = basename(path);
    const lowerName = name.toLowerCase();

    if (CONFIG_FILENAMES.has(name) && !configFiles.includes(name)) {
      configFiles.push(name);
    }
    if (ENTRY_POINT_FILENAMES.has(lowerName)) {
      entryPoints.push(path);
    }

    if (/(^|\/)(controllers?|routes?|api|endpoints?|handlers?|resources?)(\/|$)/.test(lowerPath)) {
      hasWebApi = true;
      layerHints.add('controladores/endpoints');
    }
    if (/(^|\/)(services?|usecases?|use-cases?|application)(\/|$)/.test(lowerPath)) {
      layerHints.add('servicios');
    }
    if (/(^|\/)(models?|entities?|entity|domain|schemas?)(\/|$)/.test(lowerPath)) {
      layerHints.add('modelos/dominio');
    }
    if (/(^|\/)(repositories?|repository|dao|persistence)(\/|$)/.test(lowerPath)) {
      layerHints.add('persistencia');
    }
    if (/(^|\/)(components?|views?|pages?|ui)(\/|$)/.test(lowerPath)) {
      layerHints.add('interfaz de usuario');
    }
    if (
      /(^|\/)(tests?|__tests__|spec)(\/|$)/.test(lowerPath) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(lowerName) ||
      /(^|_)test_.*\.py$/.test(lowerName) ||
      /_test\.py$/.test(lowerName)
    ) {
      hasTests = true;
    }
    if (
      lowerName === 'dockerfile' ||
      lowerName === 'docker-compose.yml' ||
      lowerName === 'docker-compose.yaml'
    ) {
      hasContainerization = true;
    }
  }

  return {
    configFiles,
    entryPoints,
    hasWebApi,
    layerHints: [...layerHints],
    hasTests,
    hasContainerization,
    sourceFileCount: repo.files.length,
  };
}

/** Une una lista en español con comas y una conjunción final ("a, b y c"). */
function joinSpanish(items: readonly string[]): string {
  if (items.length === 0) {
    return '';
  }
  if (items.length === 1) {
    return items[0];
  }
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Describe el perfil de lenguajes en una frase en español. */
function describeLanguages(profile: LanguageProfile): string {
  const primary = profile.primaryLanguage ? LANGUAGE_LABEL[profile.primaryLanguage] : '';
  const secondaries = profile.secondaryLanguages.map((lang) => LANGUAGE_LABEL[lang]);
  if (secondaries.length === 0) {
    return `El repositorio está escrito principalmente en ${primary}.`;
  }
  return `El repositorio está escrito principalmente en ${primary}, con uso adicional de ${joinSpanish(secondaries)}.`;
}

/**
 * Redacta la explicación funcional a partir del perfil de lenguajes y las señales
 * estructurales. Devuelve un texto que se ajustará al rango [50, 2000] antes de
 * usarse (Requisito 6.1).
 */
function composeSummary(profile: LanguageProfile, signals: StructuralSignals): string {
  const parts: string[] = [];

  parts.push(describeLanguages(profile));

  if (signals.hasWebApi) {
    parts.push(
      'Su estructura sugiere que expone una API o servicio web, con una organización orientada a atender peticiones.',
    );
  }

  if (signals.layerHints.length > 0) {
    parts.push(
      `Se identifican indicios de una organización por responsabilidades (${joinSpanish(signals.layerHints)}), lo que apunta a una separación de capas dentro del proyecto.`,
    );
  }

  if (signals.entryPoints.length > 0) {
    const shown = signals.entryPoints.slice(0, 3);
    parts.push(
      `Cuenta con posibles puntos de entrada como ${joinSpanish(shown)}, que probablemente inician la ejecución de la aplicación.`,
    );
  }

  if (signals.configFiles.length > 0) {
    parts.push(
      `Declara sus dependencias mediante ${joinSpanish(signals.configFiles)}, lo que ayuda a caracterizar su ecosistema tecnológico.`,
    );
  }

  if (signals.hasTests) {
    parts.push('Incluye pruebas automatizadas, lo que indica atención a la verificación del comportamiento.');
  }

  if (signals.hasContainerization) {
    parts.push('Incorpora archivos de contenedorización, lo que sugiere que está preparado para desplegarse en contenedores.');
  }

  parts.push(
    `El análisis abarcó ${signals.sourceFileCount} ${signals.sourceFileCount === 1 ? 'archivo' : 'archivos'} del repositorio.`,
  );

  parts.push(
    'Esta explicación es una inferencia heurística basada en la estructura del repositorio, por lo que su nivel de confianza es inferior al 100%.',
  );

  return parts.join(' ');
}

/**
 * Calcula el `Nivel_Confianza` heurístico en [0, 100] a partir de la cantidad de
 * señales estructurales encontradas (Requisito 6.2). A más evidencia estructural,
 * mayor confianza, siempre por debajo del 100% al tratarse de una inferencia.
 */
function computeConfidence(signals: StructuralSignals): number {
  let confidence = HEURISTIC_BASE_CONFIDENCE;
  if (signals.configFiles.length > 0) confidence += 15;
  if (signals.entryPoints.length > 0) confidence += 10;
  if (signals.hasWebApi) confidence += 8;
  if (signals.layerHints.length > 0) confidence += Math.min(signals.layerHints.length * 4, 12);
  if (signals.hasTests) confidence += 5;
  if (signals.hasContainerization) confidence += 3;
  return Math.min(confidence, HEURISTIC_MAX_CONFIDENCE);
}

/**
 * Ajusta el texto al rango de longitud [50, 2000] exigido para la explicación
 * determinada (Requisito 6.1). Si es demasiado corto, se completa con una
 * aclaración; si excede el máximo, se trunca de forma limpia respetando el límite.
 */
function fitLength(text: string): string {
  let result = text.trim();

  if (result.length > FUNCTIONAL_SUMMARY_MAX_LENGTH) {
    // Truncar sin cortar a mitad de palabra cuando es posible, respetando el máximo.
    const hardLimit = FUNCTIONAL_SUMMARY_MAX_LENGTH;
    const slice = result.slice(0, hardLimit);
    const lastSpace = slice.lastIndexOf(' ');
    result = (lastSpace > FUNCTIONAL_SUMMARY_MIN_LENGTH ? slice.slice(0, lastSpace) : slice).trimEnd();
  }

  if (result.length < FUNCTIONAL_SUMMARY_MIN_LENGTH) {
    const filler =
      ' El repositorio contiene código de lenguajes soportados analizado de forma estática.';
    while (result.length < FUNCTIONAL_SUMMARY_MIN_LENGTH) {
      result = `${result}${filler}`;
      if (result.length > FUNCTIONAL_SUMMARY_MAX_LENGTH) {
        result = result.slice(0, FUNCTIONAL_SUMMARY_MAX_LENGTH).trimEnd();
        break;
      }
    }
  }

  return result;
}

/**
 * Genera la explicación funcional heurística del repositorio (Requisitos 6.1,
 * 6.2, 6.3).
 *
 * - Si el repositorio no contiene lenguajes soportados, no puede inferirse su
 *   propósito: devuelve `determined=false`, `confidencePct=0` y una indicación de
 *   que la explicación no pudo determinarse (Requisito 6.3).
 * - En caso contrario, produce una explicación de entre 50 y 2000 caracteres
 *   (Requisito 6.1) con un `Nivel_Confianza` heurístico en [0, 100] siempre
 *   inferior al 100% (Requisito 6.2).
 *
 * La función es determinista y no lanza; opera solo sobre metadatos del
 * repositorio (rutas, tamaños y lenguajes), sin leer el código fuente
 * (Requisito 2.2).
 */
export function generateFunctionalSummary(repo: ExtractedRepo): FunctionalSummary {
  const profile = detectLanguages(repo);

  // Requisito 6.3: sin lenguajes soportados no hay evidencia para inferir el
  // propósito -> no determinado, confianza 0.
  if (!profile.hasSupportedLanguages) {
    return {
      summary: FUNCTIONAL_SUMMARY_UNDETERMINED_NOTICE,
      confidencePct: 0,
      determined: false,
    };
  }

  const signals = collectSignals(repo);
  const summary = fitLength(composeSummary(profile, signals));
  const confidencePct = computeConfidence(signals);

  return {
    summary,
    confidencePct,
    determined: true,
  };
}
