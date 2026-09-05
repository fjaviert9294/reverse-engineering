/**
 * Exportación a Markdown del `Resultado_Analisis` (Task 11.1).
 *
 * `exportMarkdown(result)` genera un documento Markdown válido que incluye
 * **todos** los elementos del `AnalysisResult` (Requisito 11.1) y lo deja
 * disponible con metadatos de descarga (Requisito 11.2). El renderizado es puro y
 * no muta la entrada: ante un fallo de generación se devuelve un `ExportError`
 * conservando el resultado intacto (Requisito 11.4). Ante un resultado vacío o
 * inexistente, se abstiene de generar y devuelve un `ExportError` con motivo
 * `RESULTADO_VACIO` (Requisito 11.3).
 *
 * Elementos incluidos en el Markdown (todos los campos de `AnalysisResult`):
 * modo de análisis, lenguaje principal y secundarios, explicación funcional (con
 * confianza), componentes clave (ruta/categoría/confianza), arquitectura
 * (tipo/confianza/determinada/evidencia), hallazgos adicionales (vulnerabilidades,
 * dependencias desactualizadas, endpoints de API — cada categoría con su estado
 * `CON_HALLAZGOS`/`SIN_HALLAZGOS`/`NO_ANALIZABLE`), notas de lectura de
 * configuración, avisos, e identificadores/fecha como metadatos.
 *
 * IMPORTANTE (Requisito 2.2): esta función solo renderiza resultados y metadatos
 * ya presentes en `AnalysisResult`; nunca lee ni transporta código fuente.
 */

import type {
  AdditionalFindings,
  AnalysisResult,
  ApiEndpoint,
  ArchitectureInference,
  ArchitectureType,
  ComponentCategory,
  FindingCategory,
  FindingCategoryStatus,
  FunctionalSummary,
  KeyComponent,
  OutdatedDep,
  SupportedLanguage,
  Vulnerability,
} from '../domain/index.js';
import type { ExportError, ExportModule, MarkdownDocument } from './types.js';

/** Nombre de archivo por defecto cuando no se dispone de identificador utilizable. */
export const DEFAULT_EXPORT_FILENAME = 'repo-analysis.md';

/** Mensaje devuelto cuando el resultado está vacío o no existe (Requisito 11.3). */
export const EMPTY_RESULT_MESSAGE =
  'No hay un resultado de análisis disponible para exportar.';

/** Mensaje devuelto cuando la generación del documento falla (Requisito 11.4). */
export const GENERATION_FAILURE_MESSAGE =
  'No se pudo generar el documento Markdown. El resultado del análisis se conserva sin cambios.';

/** Etiquetas legibles (en español) de las categorías de componentes. */
const COMPONENT_CATEGORY_LABELS: Record<ComponentCategory, string> = {
  modulo: 'Módulo',
  servicio: 'Servicio',
  controlador: 'Controlador',
  modelo: 'Modelo',
  punto_de_entrada: 'Punto de entrada',
  configuracion: 'Configuración',
};

/** Etiquetas legibles (en español) de los tipos de arquitectura. */
const ARCHITECTURE_TYPE_LABELS: Record<ArchitectureType, string> = {
  monolito: 'Monolito',
  microservicios: 'Microservicios',
  mvc: 'MVC',
  hexagonal: 'Hexagonal',
  por_capas: 'Por capas',
  otro: 'Otro',
};

/** Etiquetas legibles (en español) de los lenguajes soportados. */
const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  JAVA: 'Java',
  TYPESCRIPT: 'TypeScript',
  JAVASCRIPT: 'JavaScript',
  PYTHON: 'Python',
};

/** Etiquetas legibles (en español) del estado de una categoría de hallazgos. */
const FINDING_STATUS_LABELS: Record<FindingCategoryStatus, string> = {
  CON_HALLAZGOS: 'Con hallazgos',
  SIN_HALLAZGOS: 'Sin hallazgos',
  NO_ANALIZABLE: 'No analizable',
};

/** Etiquetas legibles (en español) del modo de análisis. */
const ANALYSIS_MODE_LABELS: Record<AnalysisResult['analysisMode'], string> = {
  SOLO_ESTATICO: 'Solo estático',
  ESTATICO_MAS_IA: 'Estático + IA',
};

/**
 * Determina si un `AnalysisResult` debe considerarse "vacío o inexistente" a
 * efectos de la exportación (Requisito 11.3).
 *
 * Se considera vacío cuando el valor es `null`/`undefined`, no es un objeto, o
 * carece de los identificadores mínimos (`id`/`jobId`) que definen un resultado
 * real. Un resultado bien formado con listas vacías NO se considera vacío: es un
 * resultado válido "sin hallazgos" y debe exportarse.
 */
function isEmptyResult(result: AnalysisResult | null | undefined): boolean {
  if (result === null || result === undefined || typeof result !== 'object') {
    return true;
  }
  const hasId = typeof result.id === 'string' && result.id.trim().length > 0;
  const hasJobId = typeof result.jobId === 'string' && result.jobId.trim().length > 0;
  return !hasId && !hasJobId;
}

/**
 * Escapa el contenido para su inserción segura dentro de una celda de tabla
 * Markdown, evitando que las barras verticales rompan la estructura de la tabla.
 */
function escapeTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Devuelve el valor si es una cadena no vacía; en caso contrario, un guión. */
function orDash(value: string | undefined | null): string {
  if (typeof value !== 'string') {
    return '—';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '—';
}

/** Renderiza el bloque de metadatos e identidad del resultado. */
function renderHeader(result: AnalysisResult): string[] {
  return [
    '# Análisis del repositorio',
    '',
    '## Metadatos',
    '',
    `- **Identificador del resultado:** ${orDash(result.id)}`,
    `- **Identificador del job:** ${orDash(result.jobId)}`,
    `- **Modo de análisis:** ${ANALYSIS_MODE_LABELS[result.analysisMode] ?? orDash(result.analysisMode)}`,
    `- **Fecha de creación:** ${orDash(result.createdAt)}`,
  ];
}

/** Renderiza el perfil de lenguajes (principal y secundarios) (Requisito 5.2). */
function renderLanguages(result: AnalysisResult): string[] {
  const primary =
    result.primaryLanguage === null
      ? 'No se detectaron lenguajes soportados'
      : (LANGUAGE_LABELS[result.primaryLanguage] ?? result.primaryLanguage);

  const secondary =
    result.secondaryLanguages.length === 0
      ? 'Ninguno'
      : result.secondaryLanguages
          .map((language) => LANGUAGE_LABELS[language] ?? language)
          .join(', ');

  return [
    '## Lenguajes',
    '',
    `- **Lenguaje principal:** ${primary}`,
    `- **Lenguajes secundarios:** ${secondary}`,
  ];
}

/** Renderiza la explicación funcional con su nivel de confianza (Requisito 6). */
function renderFunctionalSummary(summary: FunctionalSummary): string[] {
  const lines = ['## Explicación funcional', ''];
  if (summary.determined) {
    lines.push(summary.summary.trim().length > 0 ? summary.summary : '—');
  } else {
    lines.push('La explicación funcional no pudo determinarse.');
  }
  lines.push('');
  lines.push(`- **Determinada:** ${summary.determined ? 'Sí' : 'No'}`);
  lines.push(`- **Nivel de confianza:** ${summary.confidencePct}%`);
  return lines;
}

/** Renderiza los componentes clave como tabla ruta/categoría/confianza (Requisito 7). */
function renderKeyComponents(components: KeyComponent[]): string[] {
  const lines = ['## Componentes clave', ''];
  if (components.length === 0) {
    lines.push('No se identificaron componentes clave.');
    return lines;
  }

  lines.push('| Ruta | Categoría | Inferida | Confianza |');
  lines.push('| --- | --- | --- | --- |');
  for (const component of components) {
    const category =
      COMPONENT_CATEGORY_LABELS[component.category] ?? String(component.category);
    const confidence =
      typeof component.confidence === 'number'
        ? component.confidence.toFixed(2)
        : '—';
    lines.push(
      `| ${escapeTableCell(orDash(component.path))} | ${escapeTableCell(category)} | ${
        component.inferred ? 'Sí' : 'No'
      } | ${confidence} |`,
    );
  }
  return lines;
}

/** Renderiza la inferencia de arquitectura (tipo/confianza/determinada/evidencia) (Requisito 8). */
function renderArchitecture(architecture: ArchitectureInference): string[] {
  const type =
    architecture.type === null
      ? 'No determinada'
      : (ARCHITECTURE_TYPE_LABELS[architecture.type] ?? architecture.type);

  const lines = [
    '## Arquitectura inferida',
    '',
    `- **Tipo:** ${type}`,
    `- **Determinada:** ${architecture.determined ? 'Sí' : 'No'}`,
    `- **Nivel de confianza:** ${architecture.confidencePct}%`,
    `- **Evidencia:** ${orDash(architecture.evidence)}`,
  ];
  return lines;
}

/** Renderiza una categoría de hallazgos con su estado y sus elementos. */
function renderFindingCategory<T>(
  title: string,
  category: FindingCategory<T>,
  headers: string[],
  toRow: (item: T) => string[],
): string[] {
  const lines = [
    `### ${title}`,
    '',
    `- **Estado:** ${FINDING_STATUS_LABELS[category.status] ?? String(category.status)}`,
    '',
  ];

  if (category.status === 'NO_ANALIZABLE') {
    lines.push('Esta categoría no pudo analizarse.');
    return lines;
  }

  if (category.items.length === 0) {
    lines.push('No se encontraron hallazgos en esta categoría.');
    return lines;
  }

  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const item of category.items) {
    lines.push(`| ${toRow(item).map(escapeTableCell).join(' | ')} |`);
  }
  return lines;
}

/** Renderiza los hallazgos adicionales agrupados por sus tres categorías (Requisito 9). */
function renderAdditionalFindings(findings: AdditionalFindings): string[] {
  const lines = ['## Hallazgos adicionales', ''];

  lines.push(
    ...renderFindingCategory<Vulnerability>(
      'Vulnerabilidades',
      findings.vulnerabilities,
      ['Ubicación', 'Severidad'],
      (item) => [orDash(item.location), orDash(item.severity)],
    ),
  );
  lines.push('');

  lines.push(
    ...renderFindingCategory<OutdatedDep>(
      'Dependencias desactualizadas',
      findings.outdatedDependencies,
      ['Nombre', 'Versión detectada', 'Versión más reciente'],
      (item) => [orDash(item.name), orDash(item.detectedVersion), orDash(item.latestVersion)],
    ),
  );
  lines.push('');

  lines.push(
    ...renderFindingCategory<ApiEndpoint>(
      'Endpoints de API',
      findings.apiEndpoints,
      ['Ruta', 'Método'],
      (item) => [orDash(item.path), orDash(item.method)],
    ),
  );

  return lines;
}

/** Renderiza las notas de lectura de configuración (Requisitos 5.6, 5.7). */
function renderConfigNotes(notes: string[]): string[] {
  const lines = ['## Notas de configuración', ''];
  if (notes.length === 0) {
    lines.push('Sin notas de configuración.');
    return lines;
  }
  for (const note of notes) {
    lines.push(`- ${orDash(note)}`);
  }
  return lines;
}

/** Renderiza los avisos de degradación al usuario (Requisitos 3.6, 4.6, 9.5). */
function renderNotices(notices: string[]): string[] {
  const lines = ['## Avisos', ''];
  if (notices.length === 0) {
    lines.push('Sin avisos.');
    return lines;
  }
  for (const notice of notices) {
    lines.push(`- ${orDash(notice)}`);
  }
  return lines;
}

/**
 * Compone el documento Markdown completo a partir del `AnalysisResult`. Es puro y
 * no muta la entrada. Puede lanzar si algún campo obligatorio tiene una forma
 * inesperada; el llamante (`exportMarkdown`) captura la excepción y la traduce a
 * un `ExportError` con motivo `FALLO_GENERACION` (Requisito 11.4).
 */
function renderMarkdown(result: AnalysisResult): string {
  const sections: string[][] = [
    renderHeader(result),
    renderLanguages(result),
    renderFunctionalSummary(result.functionalSummary),
    renderKeyComponents(result.keyComponents),
    renderArchitecture(result.architecture),
    renderAdditionalFindings(result.additionalFindings),
    renderConfigNotes(result.configReadNotes),
    renderNotices(result.notices),
  ];

  // Une las secciones con una línea en blanco entre ellas y garantiza salto final.
  return `${sections.map((section) => section.join('\n')).join('\n\n')}\n`;
}

/** Deriva un nombre de archivo estable a partir del identificador del resultado. */
function buildFilename(result: AnalysisResult): string {
  const base =
    typeof result.id === 'string' && result.id.trim().length > 0
      ? result.id.trim()
      : typeof result.jobId === 'string' && result.jobId.trim().length > 0
        ? result.jobId.trim()
        : '';
  const slug = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? `repo-analysis-${slug}.md` : DEFAULT_EXPORT_FILENAME;
}

/**
 * Genera el documento Markdown del `Resultado_Analisis` (Requisitos 11.1–11.4).
 *
 * @param result Resultado del análisis a exportar.
 * @returns Un `MarkdownDocument` en caso de éxito, o un `ExportError` cuando el
 *   resultado está vacío/inexistente (`RESULTADO_VACIO`) o cuando la generación
 *   falla (`FALLO_GENERACION`), sin alterar en ningún caso la entrada.
 */
export async function exportMarkdown(
  result: AnalysisResult,
): Promise<MarkdownDocument | ExportError> {
  // Requisito 11.3: resultado vacío/inexistente -> abstenerse + error.
  if (isEmptyResult(result)) {
    const error: ExportError = {
      kind: 'EXPORT_ERROR',
      reason: 'RESULTADO_VACIO',
      message: EMPTY_RESULT_MESSAGE,
    };
    return error;
  }

  try {
    const content = renderMarkdown(result);
    const document: MarkdownDocument = {
      kind: 'MARKDOWN_DOCUMENT',
      content,
      filename: buildFilename(result),
      mediaType: 'text/markdown',
    };
    return document;
  } catch {
    // Requisito 11.4: fallo de generación -> informar sin alterar el resultado.
    // `renderMarkdown` es puro y no muta `result`, por lo que la entrada se
    // conserva intacta.
    const error: ExportError = {
      kind: 'EXPORT_ERROR',
      reason: 'FALLO_GENERACION',
      message: GENERATION_FAILURE_MESSAGE,
    };
    return error;
  }
}

/** Implementación por defecto del contrato `ExportModule` (Task 11.1). */
export const markdownExportModule: ExportModule = {
  exportMarkdown,
};
