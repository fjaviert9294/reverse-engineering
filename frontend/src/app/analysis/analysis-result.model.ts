/**
 * Modelo de datos del `Resultado_Analisis` para la Interfaz Web (Task 17.4).
 *
 * Refleja el contrato `AnalysisResult` del backend (`backend/src/domain/types.ts`)
 * que expone `GET /analyses/{id}`. Solo contiene resultados y metadatos: nunca
 * incluye contenido del código fuente (Requisito 2.2). Estos tipos permiten al
 * dashboard renderizar cada sección de forma tipada.
 */

/**
 * Lenguajes soportados por el análisis estático, en el orden de prioridad fijo
 * `Java > TypeScript > JavaScript > Python` (Requisitos 5.1, 5.2).
 */
export type SupportedLanguage = 'JAVA' | 'TYPESCRIPT' | 'JAVASCRIPT' | 'PYTHON';

/** Categoría de un componente clave; exactamente una por componente (Requisito 7.1). */
export type ComponentCategory =
  | 'modulo'
  | 'servicio'
  | 'controlador'
  | 'modelo'
  | 'punto_de_entrada'
  | 'configuracion';

/** Tipo de arquitectura inferida; o nulo si no se determina (Requisito 8.1). */
export type ArchitectureType =
  | 'monolito'
  | 'microservicios'
  | 'mvc'
  | 'hexagonal'
  | 'por_capas'
  | 'otro';

/** Modo de análisis efectivamente aplicado (Requisitos 3.4, 3.5). */
export type AnalysisMode = 'SOLO_ESTATICO' | 'ESTATICO_MAS_IA';

/**
 * Estado de una categoría de hallazgos. Distingue explícitamente la ausencia de
 * hallazgos (`SIN_HALLAZGOS`, Requisito 9.4) de la imposibilidad de analizar la
 * categoría (`NO_ANALIZABLE`, Requisito 9.5).
 */
export type FindingCategoryStatus = 'CON_HALLAZGOS' | 'SIN_HALLAZGOS' | 'NO_ANALIZABLE';

/**
 * Explicación funcional del repositorio (Requisitos 6.1, 6.2, 6.3).
 * `confidencePct` está en [0, 100]; si no se determina, `determined=false`.
 */
export interface FunctionalSummary {
  summary: string;
  confidencePct: number;
  determined: boolean;
}

/**
 * Componente clave identificado. `path` es la ubicación (no vacía) y `category`
 * es exactamente una categoría. Cuando es inferido, `confidence` está en
 * [0.00, 1.00] (Requisitos 7.1, 7.2).
 */
export interface KeyComponent {
  path: string;
  category: ComponentCategory;
  confidence?: number;
  inferred: boolean;
}

/**
 * Arquitectura inferida. `type` es nulo si no se determina (Requisito 8.5);
 * `confidencePct` está en [0, 100] (Requisito 8.2); `evidence` describe la
 * evidencia estructural (obligatoria y no vacía cuando `type` es `'otro'`,
 * Requisito 8.4).
 */
export interface ArchitectureInference {
  type: ArchitectureType | null;
  confidencePct: number;
  determined: boolean;
  evidence: string;
}

/** Vulnerabilidad detectada: ubicación y severidad (Requisito 9.1). */
export interface Vulnerability {
  location: string;
  severity: string;
}

/** Dependencia desactualizada: nombre, versión detectada y más reciente (Requisito 9.2). */
export interface OutdatedDep {
  name: string;
  detectedVersion: string;
  latestVersion: string;
}

/** Endpoint de API detectado: ruta y método (Requisito 9.3). */
export interface ApiEndpoint {
  path: string;
  method: string;
}

/** Categoría de hallazgos genérica con su estado propio (Requisitos 9.4, 9.5). */
export interface FindingCategory<T> {
  status: FindingCategoryStatus;
  items: T[];
}

/** Hallazgos adicionales agrupados por los tres tipos (Requisitos 9.1–9.5, 10.2). */
export interface AdditionalFindings {
  vulnerabilities: FindingCategory<Vulnerability>;
  outdatedDependencies: FindingCategory<OutdatedDep>;
  apiEndpoints: FindingCategory<ApiEndpoint>;
}

/**
 * Resultado del análisis persistido, tal como lo devuelve `GET /analyses/{id}`.
 * No contiene contenido del código fuente, solo resultados y metadatos
 * (Requisito 2.2).
 */
export interface AnalysisResult {
  id: string;
  jobId: string;
  primaryLanguage: SupportedLanguage | null;
  secondaryLanguages: SupportedLanguage[];
  analysisMode: AnalysisMode;
  functionalSummary: FunctionalSummary;
  keyComponents: KeyComponent[];
  architecture: ArchitectureInference;
  additionalFindings: AdditionalFindings;
  configReadNotes: string[];
  notices: string[];
  createdAt: string;
}
