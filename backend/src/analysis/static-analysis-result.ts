/**
 * Ensamblado del `AnalysisResult` del Módulo de Análisis Estático (Task 8.18).
 *
 * Compone las salidas de las tareas previas del análisis estático en un único
 * `AnalysisResult` bien formado:
 *
 * - perfil de lenguajes (Task 8.1) -> `primaryLanguage`, `secondaryLanguages`;
 * - lectura de configuración (Task 8.4) -> `configReadNotes`;
 * - resumen funcional heurístico (Task 8.7) -> `functionalSummary`;
 * - componentes clave (Task 8.11) -> `keyComponents`;
 * - inferencia de arquitectura (Task 8.13) -> `architecture`;
 * - hallazgos adicionales (Task 8.15) -> `additionalFindings`.
 *
 * El resultado del análisis estático fija siempre `analysisMode = "SOLO_ESTATICO"`:
 * el análisis estático es la fuente siempre disponible y no aplica inferencia por
 * IA. El enriquecimiento por IA y el cambio a `ESTATICO_MAS_IA` es
 * responsabilidad de una etapa posterior (Task 10.2), que toma este resultado
 * como base (Requisitos 3.1, 3.5).
 *
 * Trazabilidad de requisitos:
 * - 3.1: el Módulo de Análisis Estático analiza el repositorio mediante
 *   heurísticas y reglas estáticas y produce un Resultado de Análisis.
 * - 3.5: `analysisMode` refleja el modo efectivamente aplicado; aquí, al no
 *   aplicarse IA, es `SOLO_ESTATICO`.
 *
 * IMPORTANTE (Requisito 2.2): el `AnalysisResult` ensamblado solo agrega
 * resultados y metadatos ya producidos por las tareas previas (perfiles, notas,
 * ubicaciones, clasificaciones, hallazgos). No lee ni transporta contenido del
 * código fuente. `id`, `jobId` y `createdAt` son metadatos de identidad/tiempo.
 */

import type {
  AnalysisResult,
  AdditionalFindings,
  ArchitectureInference,
  FunctionalSummary,
} from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';
import { detectLanguages } from './language-detection.js';
import { readConfigFiles, type ConfigContentReader } from './config-reader.js';
import { generateFunctionalSummary } from './functional-summary.js';
import { identifyComponents } from './component-identification.js';
import { inferArchitecture } from './architecture-inference.js';
import { findAdditional, type FindingsDetectors, DEFAULT_DETECTORS } from './additional-findings.js';
import type { LanguageProfile, ConfigReadResult } from './types.js';
import type { ComponentIdentificationResult } from './component-identification.js';

/**
 * Piezas ya computadas del análisis estático que el ensamblado compone en un
 * `AnalysisResult`. Cada campo corresponde a la salida de una tarea previa
 * (8.1–8.15); el ensamblado no recalcula nada, solo agrega.
 */
export interface StaticAnalysisParts {
  /** Perfil de lenguajes detectado (Task 8.1). */
  languageProfile: LanguageProfile;
  /** Resultado de la lectura de configuración de dependencias (Task 8.4). */
  configRead: ConfigReadResult;
  /** Resumen funcional heurístico (Task 8.7). */
  functionalSummary: FunctionalSummary;
  /** Identificación de componentes clave (Task 8.11). */
  components: ComponentIdentificationResult;
  /** Inferencia de arquitectura (Task 8.13). */
  architecture: ArchitectureInference;
  /** Hallazgos adicionales por categoría (Task 8.15). */
  additionalFindings: AdditionalFindings;
}

/**
 * Metadatos de identidad y tiempo del resultado. Se inyectan para mantener el
 * ensamblado puro y determinista (no genera identificadores ni consulta el reloj
 * por su cuenta), en línea con el resto de módulos del análisis, que operan sobre
 * metadatos provistos y no producen efectos secundarios.
 *
 * - `id`: identificador del `AnalysisResult`.
 * - `jobId`: job propietario del análisis.
 * - `createdAt`: marca de tiempo de creación en formato ISO-8601.
 */
export interface AnalysisResultIdentity {
  id: string;
  jobId: string;
  createdAt: string;
}

/**
 * Ensambla un `AnalysisResult` bien formado a partir de las piezas del análisis
 * estático ya computadas (Requisitos 3.1, 3.5).
 *
 * Composición:
 * - `primaryLanguage`/`secondaryLanguages` provienen del perfil de lenguajes
 *   (Requisito 5.2).
 * - `functionalSummary`, `keyComponents`, `architecture` y `additionalFindings`
 *   se toman tal cual de sus tareas respectivas.
 * - `configReadNotes` recoge las notas de la lectura de configuración
 *   (Requisitos 5.6, 5.7).
 * - `notices` agrega los avisos disponibles a partir de las salidas del análisis:
 *   la indicación de "sin lenguajes soportados" del perfil (Requisito 5.8) y la
 *   indicación de "sin componentes clave" de la identificación de componentes
 *   (Requisito 7.4), en ese orden, sin duplicados ni cadenas vacías.
 * - `analysisMode` es siempre `"SOLO_ESTATICO"`: no se aplica IA en esta etapa
 *   (Requisito 3.5).
 *
 * La función es pura y determinista respecto a sus entradas; no lanza y no
 * consulta el reloj ni genera identificadores por su cuenta (se inyectan en
 * `identity`).
 */
export function assembleStaticAnalysisResult(
  parts: StaticAnalysisParts,
  identity: AnalysisResultIdentity,
): AnalysisResult {
  const { languageProfile, configRead, functionalSummary, components, architecture, additionalFindings } =
    parts;

  const notices = collectNotices(languageProfile, components);

  return {
    id: identity.id,
    jobId: identity.jobId,
    primaryLanguage: languageProfile.primaryLanguage,
    secondaryLanguages: [...languageProfile.secondaryLanguages],
    analysisMode: 'SOLO_ESTATICO',
    functionalSummary,
    keyComponents: [...components.components],
    architecture,
    additionalFindings,
    configReadNotes: [...configRead.notes],
    notices,
    createdAt: identity.createdAt,
  };
}

/**
 * Reúne los avisos de degradación disponibles a partir de las salidas del
 * análisis estático, preservando el orden y descartando cadenas vacías y
 * duplicados:
 *
 * - la indicación de "sin lenguajes soportados" del perfil de lenguajes cuando no
 *   hay lenguajes soportados (Requisito 5.8);
 * - la indicación de "sin componentes clave" cuando no se identificó ningún
 *   componente (Requisito 7.4).
 */
function collectNotices(
  languageProfile: LanguageProfile,
  components: ComponentIdentificationResult,
): string[] {
  const notices: string[] = [];
  const seen = new Set<string>();

  const push = (notice: string | undefined): void => {
    if (typeof notice !== 'string') {
      return;
    }
    const trimmed = notice.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    notices.push(trimmed);
  };

  push(languageProfile.notice);
  push(components.notice);

  return notices;
}

/**
 * Ejecuta el pipeline completo del análisis estático sobre un repositorio
 * extraído y ensambla el `AnalysisResult` (Requisitos 3.1, 3.5).
 *
 * Encadena las heurísticas de las tareas 8.1–8.15 reutilizando sus funciones tal
 * como están, y delega el ensamblado en `assembleStaticAnalysisResult`. El
 * lector de contenido de configuración y los detectores de hallazgos son puntos
 * de extensión (decisiones abiertas del diseño); por defecto se usan los
 * detectores heurísticos del módulo.
 *
 * `identity` inyecta `id`, `jobId` y `createdAt` para mantener el pipeline
 * determinista y desacoplado de la generación de identificadores y del reloj.
 *
 * @param repo Repositorio extraído (metadatos de archivos; sin código).
 * @param readConfigContent Lector del contenido de archivos de configuración
 *   dentro del espacio transitorio del job (Requisitos 5.3–5.7).
 * @param identity Metadatos de identidad/tiempo del resultado.
 * @param detectors Detectores de hallazgos adicionales; por defecto, los
 *   adaptadores heurísticos del módulo (decisión abierta #4 del diseño).
 */
export async function runStaticAnalysis(
  repo: ExtractedRepo,
  readConfigContent: ConfigContentReader,
  identity: AnalysisResultIdentity,
  detectors: FindingsDetectors = DEFAULT_DETECTORS,
): Promise<AnalysisResult> {
  const languageProfile = detectLanguages(repo);
  const configRead = await readConfigFiles(repo, languageProfile, readConfigContent);
  const functionalSummary = generateFunctionalSummary(repo);
  const components = identifyComponents(repo);
  const architecture = inferArchitecture(repo, components.components);
  const additionalFindings = findAdditional(repo, configRead, detectors);

  return assembleStaticAnalysisResult(
    {
      languageProfile,
      configRead,
      functionalSummary,
      components,
      architecture,
      additionalFindings,
    },
    identity,
  );
}
