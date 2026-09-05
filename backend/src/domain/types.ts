/**
 * Tipos e interfaces del dominio de Repo-Analyzer (Task 2.1).
 *
 * Este módulo define el contrato de datos del sistema: estados de job, etapas de
 * análisis, métodos de entrada, lenguajes soportados, categorías de componentes y
 * tipos de arquitectura, junto con las estructuras persistibles del resultado del
 * análisis y los metadatos operativos.
 *
 * INVARIANTE CENTRAL (Requisito 2.2): ningún tipo persistible contiene contenido
 * del código fuente del repositorio. El modelo entero se limita a *resultados* y
 * *metadatos*. En particular, la única referencia al origen del código es la URL
 * de un repositorio de GitHub (`sourceUrl`), que es un metadato de origen y NO
 * código fuente (Requisitos 1.2, 15.1).
 *
 * Los tipos se derivan directamente del contrato conceptual de la sección
 * "Data Models" del documento de diseño; no se introducen decisiones nuevas.
 */

// ---------------------------------------------------------------------------
// Enumeraciones / uniones de dominio
// ---------------------------------------------------------------------------

/**
 * Estado del ciclo de vida de un job de análisis. Nunca contiene código
 * (Requisito 12.x, modelo de datos del diseño).
 */
export type JobStatus = 'EN_COLA' | 'EN_PROGRESO' | 'COMPLETADO' | 'FALLIDO';

/** Etapa actual del pipeline de análisis (progreso en tiempo real). */
export type AnalysisStage =
  | 'INGESTA'
  | 'ANALISIS_ESTATICO'
  | 'INFERENCIA_IA'
  | 'PERSISTENCIA'
  | 'FINALIZADO';

/**
 * Método de entrada del repositorio. Solo se admiten el ZIP subido y la URL de
 * un repositorio de GitHub público (Requisitos 1.2, 15.1).
 */
export type InputSource = 'ZIP' | 'GITHUB_URL';

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

/** Tipo de arquitectura inferida; exactamente uno o nulo si no se determina (Requisito 8.1). */
export type ArchitectureType =
  | 'monolito'
  | 'microservicios'
  | 'mvc'
  | 'hexagonal'
  | 'por_capas'
  | 'otro';

/**
 * Modo de análisis efectivamente aplicado. Es `ESTATICO_MAS_IA` si y solo si la
 * inferencia por IA se aplicó realmente; en otro caso, `SOLO_ESTATICO`
 * (Requisitos 3.4, 3.5).
 */
export type AnalysisMode = 'SOLO_ESTATICO' | 'ESTATICO_MAS_IA';

/**
 * Estado de una categoría de hallazgos. Distingue explícitamente la ausencia de
 * hallazgos (`SIN_HALLAZGOS`, Requisito 9.4) de la imposibilidad de analizar la
 * categoría (`NO_ANALIZABLE`, Requisito 9.5).
 */
export type FindingCategoryStatus = 'CON_HALLAZGOS' | 'SIN_HALLAZGOS' | 'NO_ANALIZABLE';

// ---------------------------------------------------------------------------
// Job de análisis (metadatos operativos, nunca código)
// ---------------------------------------------------------------------------

/**
 * Job de análisis: estado y progreso. Solo contiene metadatos operativos.
 * `sourceUrl` es un metadato de origen (URL de GitHub) y NUNCA código fuente
 * (Requisitos 1.2, 15.1, 2.2).
 */
export interface AnalysisJob {
  id: string;
  userId: string;
  status: JobStatus;
  /** Progreso en el rango [0, 100] (Requisito 12.1). */
  progress: number;
  stage: AnalysisStage;
  /** Opción del usuario para este análisis (uso de IA). */
  useAIRequested: boolean;
  /** Origen de la entrada: ZIP subido o URL de GitHub (Requisitos 1.2, 15.1). */
  inputSource: InputSource;
  /** Solo para `GITHUB_URL`; metadato de origen, NUNCA código fuente (Requisito 15.1). */
  sourceUrl?: string;
  /** Módulo afectado ante fallo, para aislamiento de errores (Requisito 14.6). */
  errorModule?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Error acotado a un módulo del pipeline. Ante el fallo de un módulo, el sistema
 * detiene únicamente ese módulo, preserva los resultados de los ya completados e
 * identifica el módulo afectado (Requisito 14.6). `module` es el identificador
 * del módulo (p. ej. `INGESTA`, `ANALISIS_ESTATICO`, `INFERENCIA_IA`,
 * `PERSISTENCIA`); `message` es una descripción del error (nunca código fuente).
 */
export interface ModuleError {
  module: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Resultado del análisis (única entidad persistida junto a jobs/usuarios/preferencias)
// ---------------------------------------------------------------------------

/**
 * Explicación funcional del repositorio (heurística o enriquecida por IA).
 * Cuando el propósito se determina, `summary` tiene entre 50 y 2000 caracteres
 * (Requisito 6.1). Si no se determina, `determined=false` y `confidencePct=0`
 * (Requisito 6.3). `confidencePct` está en [0, 100] (Requisito 6.2).
 */
export interface FunctionalSummary {
  summary: string;
  confidencePct: number;
  determined: boolean;
}

/**
 * Componente clave identificado. `path` es la ruta/ubicación (no vacía) y
 * `category` es exactamente una categoría. Cuando la categoría se determina por
 * inferencia (`inferred=true`), `confidence` está en [0.00, 1.00] (Requisitos
 * 7.1, 7.2). No contiene contenido del código, solo su ubicación.
 */
export interface KeyComponent {
  path: string;
  category: ComponentCategory;
  /** Nivel de confianza en [0.00, 1.00] cuando la categoría es inferida (Requisito 7.2). */
  confidence?: number;
  inferred: boolean;
}

/**
 * Arquitectura inferida del repositorio. `type` es nulo cuando no se determina
 * (Requisito 8.5); `confidencePct` está en [0, 100] (Requisito 8.2); cuando
 * `type` es `'otro'`, `evidence` describe la evidencia estructural y es no vacía
 * (Requisito 8.4).
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

/**
 * Dependencia desactualizada: nombre, versión detectada y versión más reciente
 * conocida (Requisito 9.2).
 */
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

/**
 * Categoría de hallazgos genérica. `status` distingue "con hallazgos", "sin
 * hallazgos" y "no analizable" (Requisitos 9.4, 9.5). `items` contiene los
 * hallazgos concretos de tipo `T`.
 */
export interface FindingCategory<T> {
  status: FindingCategoryStatus;
  items: T[];
}

/**
 * Hallazgos adicionales agrupados por categoría, cada una con su estado propio
 * para preservar las demás ante el fallo de una (Requisitos 9.1–9.5).
 */
export interface AdditionalFindings {
  vulnerabilities: FindingCategory<Vulnerability>;
  outdatedDependencies: FindingCategory<OutdatedDep>;
  apiEndpoints: FindingCategory<ApiEndpoint>;
}

/**
 * Resultado del análisis: lo único que se persiste junto a jobs, usuarios y
 * preferencias. No contiene contenido del código fuente, solo resultados y
 * metadatos (Requisito 2.2). `analysisMode` refleja el modo efectivamente usado
 * (Requisito 3.5).
 */
export interface AnalysisResult {
  id: string;
  jobId: string;
  /** Lenguaje principal según prioridad, o nulo si no hay soportados (Requisito 5.2). */
  primaryLanguage: SupportedLanguage | null;
  /** Lenguajes secundarios en orden de prioridad (Requisito 5.2). */
  secondaryLanguages: SupportedLanguage[];
  analysisMode: AnalysisMode;
  functionalSummary: FunctionalSummary;
  keyComponents: KeyComponent[];
  architecture: ArchitectureInference;
  additionalFindings: AdditionalFindings;
  /** Indicaciones de configuración no disponible/no procesable (Requisitos 5.6, 5.7). */
  configReadNotes: string[];
  /** Avisos de degradación al usuario (Requisitos 3.6, 4.6, 9.5). */
  notices: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Autenticación (metadatos de sesión, nunca código)
// ---------------------------------------------------------------------------

/**
 * Sesión autenticada de un usuario (Requisitos 13.1, 13.2). Contiene únicamente
 * metadatos de autenticación; no incluye credenciales en claro ni código fuente.
 */
export interface Session {
  token: string;
  userId: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Usuario almacenado del sistema, correspondiente a la tabla `USUARIO`
 * (Requisitos 13.x). Contiene únicamente metadatos de autenticación y el hash de
 * la contraseña; NUNCA la contraseña en claro ni código fuente.
 *
 * `failedAttempts` cuenta los fallos de autenticación consecutivos; se reinicia a
 * cero tras un login válido (Requisito 13.4). `lockedUntil`, cuando no es nulo,
 * indica el instante (ISO-8601) hasta el que la cuenta está bloqueada tras 5
 * fallos consecutivos (Requisito 13.4).
 */
export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: string | null;
}

/**
 * Error de autenticación genérico (Requisito 13.3). El mensaje es siempre el
 * mismo con independencia de si el fallo se debió a un usuario inexistente, a una
 * contraseña incorrecta o a una cuenta bloqueada, de modo que no se revela qué
 * campo fue incorrecto. `code` permite a las capas superiores distinguir el
 * bloqueo (para informar la expiración del bloqueo) sin filtrar la causa exacta
 * de un fallo de credenciales.
 */
export interface AuthError {
  error: true;
  code: 'CREDENCIALES_INVALIDAS' | 'CUENTA_BLOQUEADA' | 'AUTENTICACION_EXPIRADA';
  message: string;
}
