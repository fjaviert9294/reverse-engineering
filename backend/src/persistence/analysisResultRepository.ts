/**
 * `AnalysisResultRepository` (Task 3.2).
 *
 * Responsabilidad: leer y escribir en PostgreSQL exclusivamente el
 * `Resultado_Analisis`. El resultado se reparte en varias tablas
 * (`analysis_result`, `functional_summary`, `key_component`,
 * `architecture_inference`, `vulnerability`, `outdated_dependency`,
 * `api_endpoint`), por lo que `save` persiste todo dentro de una única
 * transacción y `findById` reensambla el `AnalysisResult` completo.
 *
 * Requisitos cubiertos:
 * - 2.1: `save` almacena el resultado (objetivo <= 5 s).
 * - 2.3: `findById` recupera el resultado por identificador (objetivo <= 3 s).
 * - 2.4: ante fallo de guardado, ROLLBACK atómico conserva los datos previos y
 *   se devuelve `PersistenceError` (persistencia no completada).
 * - 2.5: `findById` devuelve `null` cuando el identificador no existe.
 * - 2.2: no se persiste ni se recupera contenido del código fuente; solo
 *   resultados y metadatos (garantizado por el esquema y por este mapeo).
 */

import type { PgClient, Queryable, QueryRow } from './db.js';
import { PersistenceError } from './errors.js';
import type {
  AdditionalFindings,
  AnalysisMode,
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

export interface AnalysisResultRepository {
  /** Persiste el resultado de análisis (Requisitos 2.1, 2.4). */
  save(result: AnalysisResult): Promise<void>;
  /** Recupera el resultado por identificador, o `null` si no existe (Requisitos 2.3, 2.5). */
  findById(id: string): Promise<AnalysisResult | null>;
}

// ---------------------------------------------------------------------------
// Filas intermedias (mapeo tabla -> memoria)
// ---------------------------------------------------------------------------

interface ResultRow extends QueryRow {
  id: string;
  job_id: string;
  primary_language: SupportedLanguage | null;
  secondary_languages: unknown;
  analysis_mode: AnalysisMode;
  config_read_notes: unknown;
  notices: unknown;
  vulnerabilities_status: FindingCategoryStatus;
  outdated_dependencies_status: FindingCategoryStatus;
  api_endpoints_status: FindingCategoryStatus;
  created_at: string | Date;
}

/** Normaliza un valor `jsonb`/`text[]` a `string[]`. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === 'string' && value.length > 0) {
    // Algunos drivers devuelven jsonb ya parseado; otros como texto.
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Normaliza una marca temporal a cadena ISO. */
function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class SqlAnalysisResultRepository implements AnalysisResultRepository {
  constructor(private readonly db: PgClient) {}

  /**
   * Persiste el resultado completo dentro de una transacción. Cualquier fallo
   * (de cualquier tabla) provoca ROLLBACK, dejando los datos previos sin cambios
   * y devolviendo `PersistenceError` (Requisitos 2.1, 2.4).
   */
  async save(result: AnalysisResult): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await this.insertResult(tx, result);
        await this.insertFunctionalSummary(tx, result.id, result.functionalSummary);
        await this.insertKeyComponents(tx, result.id, result.keyComponents);
        await this.insertArchitecture(tx, result.id, result.architecture);
        await this.insertFindings(tx, result.id, result.additionalFindings);
      });
    } catch (err) {
      if (err instanceof PersistenceError) {
        throw err;
      }
      throw new PersistenceError(undefined, err);
    }
  }

  private async insertResult(tx: Queryable, result: AnalysisResult): Promise<void> {
    await tx.query(
      `INSERT INTO analysis_result (
         id, job_id, primary_language, secondary_languages, analysis_mode,
         config_read_notes, notices,
         vulnerabilities_status, outdated_dependencies_status, api_endpoints_status,
         created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
      [
        result.id,
        result.jobId,
        result.primaryLanguage,
        JSON.stringify(result.secondaryLanguages),
        result.analysisMode,
        JSON.stringify(result.configReadNotes),
        JSON.stringify(result.notices),
        result.additionalFindings.vulnerabilities.status,
        result.additionalFindings.outdatedDependencies.status,
        result.additionalFindings.apiEndpoints.status,
        result.createdAt,
      ],
    );
  }

  private async insertFunctionalSummary(
    tx: Queryable,
    resultId: string,
    fs: FunctionalSummary,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO functional_summary (result_id, summary, confidence_pct, determined)
       VALUES ($1, $2, $3, $4)`,
      [resultId, fs.summary, fs.confidencePct, fs.determined],
    );
  }

  private async insertKeyComponents(
    tx: Queryable,
    resultId: string,
    components: KeyComponent[],
  ): Promise<void> {
    for (const c of components) {
      await tx.query(
        `INSERT INTO key_component (result_id, path, category, confidence, inferred)
         VALUES ($1, $2, $3, $4, $5)`,
        [resultId, c.path, c.category, c.confidence ?? null, c.inferred],
      );
    }
  }

  private async insertArchitecture(
    tx: Queryable,
    resultId: string,
    arch: ArchitectureInference,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO architecture_inference (result_id, type, confidence_pct, evidence, determined)
       VALUES ($1, $2, $3, $4, $5)`,
      [resultId, arch.type, arch.confidencePct, arch.evidence, arch.determined],
    );
  }

  private async insertFindings(
    tx: Queryable,
    resultId: string,
    findings: AdditionalFindings,
  ): Promise<void> {
    for (const v of findings.vulnerabilities.items) {
      await tx.query(
        `INSERT INTO vulnerability (result_id, location, severity) VALUES ($1, $2, $3)`,
        [resultId, v.location, v.severity],
      );
    }
    for (const d of findings.outdatedDependencies.items) {
      await tx.query(
        `INSERT INTO outdated_dependency (result_id, name, detected_version, latest_version)
         VALUES ($1, $2, $3, $4)`,
        [resultId, d.name, d.detectedVersion, d.latestVersion],
      );
    }
    for (const e of findings.apiEndpoints.items) {
      await tx.query(
        `INSERT INTO api_endpoint (result_id, path, method) VALUES ($1, $2, $3)`,
        [resultId, e.path, e.method],
      );
    }
  }

  /**
   * Recupera y reensambla el `AnalysisResult`. Devuelve `null` cuando el
   * identificador no existe (Requisitos 2.3, 2.5).
   */
  async findById(id: string): Promise<AnalysisResult | null> {
    const resultRes = await this.db.query<ResultRow>(
      `SELECT id, job_id, primary_language, secondary_languages, analysis_mode,
              config_read_notes, notices,
              vulnerabilities_status, outdated_dependencies_status, api_endpoints_status,
              created_at
         FROM analysis_result
        WHERE id = $1`,
      [id],
    );

    const row = resultRes.rows[0];
    if (!row) {
      return null;
    }

    const [functionalSummary, keyComponents, architecture, findings] = await Promise.all([
      this.loadFunctionalSummary(id),
      this.loadKeyComponents(id),
      this.loadArchitecture(id),
      this.loadFindings(id, {
        vulnerabilities: row.vulnerabilities_status,
        outdatedDependencies: row.outdated_dependencies_status,
        apiEndpoints: row.api_endpoints_status,
      }),
    ]);

    return {
      id: row.id,
      jobId: row.job_id,
      primaryLanguage: row.primary_language,
      secondaryLanguages: toStringArray(row.secondary_languages) as SupportedLanguage[],
      analysisMode: row.analysis_mode,
      functionalSummary,
      keyComponents,
      architecture,
      additionalFindings: findings,
      configReadNotes: toStringArray(row.config_read_notes),
      notices: toStringArray(row.notices),
      createdAt: toIso(row.created_at),
    };
  }

  private async loadFunctionalSummary(resultId: string): Promise<FunctionalSummary> {
    const res = await this.db.query<{
      summary: string;
      confidence_pct: number;
      determined: boolean;
    }>(
      `SELECT summary, confidence_pct, determined FROM functional_summary WHERE result_id = $1`,
      [resultId],
    );
    const r = res.rows[0];
    if (!r) {
      // Consistencia: un resultado siempre tiene resumen funcional (1:1).
      return { summary: '', confidencePct: 0, determined: false };
    }
    return {
      summary: r.summary,
      confidencePct: Number(r.confidence_pct),
      determined: r.determined,
    };
  }

  private async loadKeyComponents(resultId: string): Promise<KeyComponent[]> {
    const res = await this.db.query<{
      path: string;
      category: ComponentCategory;
      confidence: number | string | null;
      inferred: boolean;
    }>(
      `SELECT path, category, confidence, inferred
         FROM key_component
        WHERE result_id = $1
        ORDER BY path`,
      [resultId],
    );
    return res.rows.map((r) => {
      const component: KeyComponent = {
        path: r.path,
        category: r.category,
        inferred: r.inferred,
      };
      if (r.confidence !== null && r.confidence !== undefined) {
        component.confidence = Number(r.confidence);
      }
      return component;
    });
  }

  private async loadArchitecture(resultId: string): Promise<ArchitectureInference> {
    const res = await this.db.query<{
      type: ArchitectureType | null;
      confidence_pct: number;
      evidence: string;
      determined: boolean;
    }>(
      `SELECT type, confidence_pct, evidence, determined
         FROM architecture_inference
        WHERE result_id = $1`,
      [resultId],
    );
    const r = res.rows[0];
    if (!r) {
      return { type: null, confidencePct: 0, determined: false, evidence: '' };
    }
    return {
      type: r.type,
      confidencePct: Number(r.confidence_pct),
      evidence: r.evidence,
      determined: r.determined,
    };
  }

  private async loadFindings(
    resultId: string,
    statuses: {
      vulnerabilities: FindingCategoryStatus;
      outdatedDependencies: FindingCategoryStatus;
      apiEndpoints: FindingCategoryStatus;
    },
  ): Promise<AdditionalFindings> {
    const [vulnRes, depRes, endpointRes] = await Promise.all([
      this.db.query<{ location: string; severity: string }>(
        `SELECT location, severity FROM vulnerability WHERE result_id = $1 ORDER BY id`,
        [resultId],
      ),
      this.db.query<{ name: string; detected_version: string; latest_version: string }>(
        `SELECT name, detected_version, latest_version
           FROM outdated_dependency WHERE result_id = $1 ORDER BY id`,
        [resultId],
      ),
      this.db.query<{ path: string; method: string }>(
        `SELECT path, method FROM api_endpoint WHERE result_id = $1 ORDER BY id`,
        [resultId],
      ),
    ]);

    const vulnerabilities: FindingCategory<Vulnerability> = {
      status: statuses.vulnerabilities,
      items: vulnRes.rows.map((r) => ({ location: r.location, severity: r.severity })),
    };
    const outdatedDependencies: FindingCategory<OutdatedDep> = {
      status: statuses.outdatedDependencies,
      items: depRes.rows.map((r) => ({
        name: r.name,
        detectedVersion: r.detected_version,
        latestVersion: r.latest_version,
      })),
    };
    const apiEndpoints: FindingCategory<ApiEndpoint> = {
      status: statuses.apiEndpoints,
      items: endpointRes.rows.map((r) => ({ path: r.path, method: r.method })),
    };

    return { vulnerabilities, outdatedDependencies, apiEndpoints };
  }
}
