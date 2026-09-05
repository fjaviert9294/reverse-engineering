/**
 * Tipos del Módulo de Análisis Estático de Repo-Analyzer (Task 8.1).
 *
 * El Módulo de Análisis Estático detecta lenguajes, lee archivos de
 * configuración, identifica componentes clave, infiere arquitectura y produce
 * hallazgos adicionales, todo mediante heurísticas y reglas (sin IA). Es la
 * fuente siempre disponible del análisis.
 *
 * Esta tarea (8.1) cubre únicamente la detección de lenguajes y su prioridad; el
 * resto del contrato (`readConfigFiles`, `identifyComponents`, ...) se declara
 * conceptualmente en el diseño y se implementa en tareas posteriores.
 *
 * IMPORTANTE (Requisito 2.2): estos tipos no transportan contenido del código
 * fuente; el `LanguageProfile` solo describe qué lenguajes soportados están
 * presentes y su prioridad, a partir de los metadatos (rutas) del repositorio
 * extraído.
 */

import type { SupportedLanguage } from '../domain/index.js';

/**
 * Perfil de lenguajes de un repositorio, derivado de la detección por extensión
 * (Requisitos 5.1, 5.2, 5.8).
 *
 * - `primaryLanguage` es el primer lenguaje presente según el orden fijo de
 *   prioridad `Java > TypeScript > JavaScript > Python`, o `null` si el
 *   repositorio no contiene ninguno de los cuatro lenguajes soportados
 *   (Requisitos 5.2, 5.8).
 * - `secondaryLanguages` lista los demás lenguajes soportados presentes en ese
 *   mismo orden de prioridad, sin incluir el principal ni duplicados
 *   (Requisito 5.2).
 * - `hasSupportedLanguages` es `false` cuando no hay lenguajes soportados; en ese
 *   caso `notice` contiene la indicación de "sin lenguajes soportados" que
 *   finaliza el análisis (Requisito 5.8).
 */
export interface LanguageProfile {
  /** Lenguaje principal por prioridad, o `null` si no hay soportados (Requisitos 5.2, 5.8). */
  primaryLanguage: SupportedLanguage | null;
  /** Lenguajes secundarios presentes, en orden de prioridad (Requisito 5.2). */
  secondaryLanguages: SupportedLanguage[];
  /** `true` si hay al menos un lenguaje soportado presente (Requisitos 5.1, 5.8). */
  hasSupportedLanguages: boolean;
  /**
   * Indicación de "sin lenguajes soportados" cuando no hay ninguno de los cuatro
   * lenguajes (Requisito 5.8); ausente cuando sí hay lenguajes soportados.
   */
  notice?: string;
}

// ---------------------------------------------------------------------------
// Lectura de archivos de configuración por lenguaje (Task 8.4)
// ---------------------------------------------------------------------------

/**
 * Tipo de archivo de configuración de dependencias reconocido por lenguaje
 * (Requisitos 5.3, 5.4, 5.5):
 *
 * - `package.json`   -> JavaScript / TypeScript (5.3)
 * - `pom.xml`        -> Java (Maven) (5.4)
 * - `build.gradle`   -> Java (Gradle) (5.4)
 * - `requirements.txt` -> Python (5.5)
 * - `pyproject.toml` -> Python (5.5)
 */
export type ConfigFileKind =
  | 'package.json'
  | 'pom.xml'
  | 'build.gradle'
  | 'requirements.txt'
  | 'pyproject.toml';

/**
 * Archivo de configuración leído e interpretado con éxito. Registra su tipo, la
 * ruta relativa donde se encontró dentro del repositorio extraído, el lenguaje al
 * que pertenece y los datos ya interpretados.
 *
 * IMPORTANTE (Requisito 2.2): `data` contiene la representación *interpretada* del
 * archivo de configuración (dependencias, metadatos del proyecto), no el código
 * fuente del repositorio. El archivo de configuración no es código fuente
 * analizable; es un descriptor de dependencias del proyecto.
 */
export interface ParsedConfigFile {
  /** Tipo de archivo de configuración reconocido (Requisitos 5.3, 5.4, 5.5). */
  kind: ConfigFileKind;
  /** Lenguaje soportado al que corresponde el archivo. */
  language: SupportedLanguage;
  /** Ruta relativa dentro del repositorio extraído donde se localizó el archivo. */
  path: string;
  /**
   * Representación interpretada del archivo. Para `package.json` es el objeto
   * JSON; para `requirements.txt` una lista de líneas de dependencia; para
   * `pom.xml`, `build.gradle` y `pyproject.toml` el texto crudo interpretado como
   * tal (el análisis fino de dependencias es responsabilidad de tareas
   * posteriores de hallazgos). El objetivo de la Task 8.4 es leer sin fallar y
   * registrar notas, no analizar el contenido en profundidad.
   */
  data: unknown;
}

/**
 * Resultado de la lectura de archivos de configuración por lenguaje
 * (Requisitos 5.3–5.7).
 *
 * - `files` contiene los archivos de configuración presentes y correctamente
 *   interpretados (5.3, 5.4, 5.5).
 * - `notes` acumula las indicaciones exigidas por 5.6 (configuración ausente) y
 *   5.7 (configuración corrupta/no procesable); estas notas alimentan
 *   `AnalysisResult.configReadNotes`.
 */
export interface ConfigReadResult {
  files: ParsedConfigFile[];
  notes: string[];
}
