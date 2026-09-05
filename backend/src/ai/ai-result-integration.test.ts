import { describe, it, expect } from 'vitest';
import { integrateAIFindings } from './index.js';
import type { AIFindings, AIUnavailable } from './index.js';
import type { AnalysisResult, KeyComponent } from '../domain/index.js';

/**
 * Pruebas de ejemplo/unit de la integración IA + degradación elegante (Task 10.2).
 *
 * Cubren:
 * - Requisitos 3.2, 3.5, 14.4: con IA aplicada, el resultado es un superconjunto
 *   del estático y `analysisMode = "ESTATICO_MAS_IA"`.
 * - Requisitos 3.4, 3.6, 14.5: con IA no disponible/fallida/no permitida, se
 *   mantiene `SOLO_ESTATICO` con aviso de que la inferencia no se completó.
 */

/** Construye un `AnalysisResult` estático base bien formado para las pruebas. */
function staticResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: 'result-1',
    jobId: 'job-1',
    primaryLanguage: 'TYPESCRIPT',
    secondaryLanguages: ['JAVASCRIPT'],
    analysisMode: 'SOLO_ESTATICO',
    functionalSummary: { summary: '', confidencePct: 0, determined: false },
    keyComponents: [
      { path: 'src/index.ts', category: 'punto_de_entrada', inferred: false },
    ],
    architecture: { type: null, confidencePct: 0, determined: false, evidence: '' },
    additionalFindings: {
      vulnerabilities: { status: 'SIN_HALLAZGOS', items: [] },
      outdatedDependencies: { status: 'SIN_HALLAZGOS', items: [] },
      apiEndpoints: { status: 'SIN_HALLAZGOS', items: [] },
    },
    configReadNotes: ['nota de config'],
    notices: ['aviso estático previo'],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const UNAVAILABLE: AIUnavailable = {
  kind: 'AI_UNAVAILABLE',
  reason: 'PROVEEDOR_FALLO',
  notice: 'El proveedor de IA falló: el análisis se produjo solo con el análisis estático.',
};

describe('integrateAIFindings - degradación elegante (Requisitos 3.4, 3.6, 14.5)', () => {
  it('mantiene SOLO_ESTATICO y añade el aviso cuando la IA no está disponible', () => {
    const base = staticResult();
    const result = integrateAIFindings(base, UNAVAILABLE);

    expect(result.analysisMode).toBe('SOLO_ESTATICO');
    expect(result.notices).toContain(UNAVAILABLE.notice);
    // Preserva los avisos previos.
    expect(result.notices).toContain('aviso estático previo');
  });

  it('no muta el resultado estático de entrada al degradar', () => {
    const base = staticResult();
    const snapshot = JSON.parse(JSON.stringify(base));
    integrateAIFindings(base, UNAVAILABLE);
    expect(base).toEqual(snapshot);
  });

  it('no duplica el aviso si ya está presente', () => {
    const base = staticResult({ notices: [UNAVAILABLE.notice] });
    const result = integrateAIFindings(base, UNAVAILABLE);
    const occurrences = result.notices.filter((n) => n === UNAVAILABLE.notice).length;
    expect(occurrences).toBe(1);
  });

  it('degrada para cualquier motivo de indisponibilidad (privacidad, proveedor ausente)', () => {
    const reasons: AIUnavailable[] = [
      { kind: 'AI_UNAVAILABLE', reason: 'PRIVACIDAD_DESHABILITADA', notice: 'privacidad off' },
      { kind: 'AI_UNAVAILABLE', reason: 'PROVEEDOR_NO_CONFIGURADO', notice: 'sin proveedor' },
    ];
    for (const unavailable of reasons) {
      const result = integrateAIFindings(staticResult(), unavailable);
      expect(result.analysisMode).toBe('SOLO_ESTATICO');
      expect(result.notices).toContain(unavailable.notice);
    }
  });
});

describe('integrateAIFindings - enriquecimiento por IA (Requisitos 3.2, 3.5, 14.4)', () => {
  it('fija analysisMode = ESTATICO_MAS_IA cuando la IA se aplica', () => {
    const findings: AIFindings = { kind: 'AI_FINDINGS' };
    const result = integrateAIFindings(staticResult(), findings);
    expect(result.analysisMode).toBe('ESTATICO_MAS_IA');
  });

  it('preserva todos los componentes estáticos (superconjunto) y añade los de IA', () => {
    const base = staticResult();
    const findings: AIFindings = {
      kind: 'AI_FINDINGS',
      componentCategories: [
        { path: 'src/service.ts', category: 'servicio', confidence: 0.9 },
      ],
    };
    const result = integrateAIFindings(base, findings);

    const paths = result.keyComponents.map((c) => c.path);
    // Todos los estáticos siguen presentes.
    for (const staticComponent of base.keyComponents) {
      expect(paths).toContain(staticComponent.path);
    }
    // El de IA se añadió, marcado como inferido.
    const added = result.keyComponents.find((c) => c.path === 'src/service.ts');
    expect(added).toEqual<KeyComponent>({
      path: 'src/service.ts',
      category: 'servicio',
      inferred: true,
      confidence: 0.9,
    });
  });

  it('no sobreescribe un componente estático existente con la categoría de IA', () => {
    const base = staticResult();
    const findings: AIFindings = {
      kind: 'AI_FINDINGS',
      componentCategories: [
        { path: 'src/index.ts', category: 'servicio', confidence: 0.5 },
      ],
    };
    const result = integrateAIFindings(base, findings);
    const entry = result.keyComponents.find((c) => c.path === 'src/index.ts');
    // Se conserva la clasificación estática original.
    expect(entry).toEqual<KeyComponent>({
      path: 'src/index.ts',
      category: 'punto_de_entrada',
      inferred: false,
    });
    // Y no se ha duplicado la ruta.
    expect(result.keyComponents.filter((c) => c.path === 'src/index.ts')).toHaveLength(1);
  });

  it('refina el resumen funcional solo cuando el estático no lo determinó', () => {
    const aiSummary = {
      summary: 'Aplicación de ejemplo que expone una API para gestionar tareas de usuario.',
      confidencePct: 85,
      determined: true,
    };
    const findings: AIFindings = { kind: 'AI_FINDINGS', functionalSummary: aiSummary };

    const undetermined = integrateAIFindings(staticResult(), findings);
    expect(undetermined.functionalSummary).toEqual(aiSummary);

    const determinedBase = staticResult({
      functionalSummary: { summary: 'Resumen estático ya determinado.', confidencePct: 100, determined: true },
    });
    const determined = integrateAIFindings(determinedBase, findings);
    expect(determined.functionalSummary).toEqual(determinedBase.functionalSummary);
  });

  it('refina la arquitectura solo cuando el estático no la determinó', () => {
    const aiArch = { type: 'mvc' as const, confidencePct: 75, determined: true, evidence: 'estructura MVC' };
    const findings: AIFindings = { kind: 'AI_FINDINGS', architecture: aiArch };

    const undetermined = integrateAIFindings(staticResult(), findings);
    expect(undetermined.architecture).toEqual(aiArch);

    const determinedBase = staticResult({
      architecture: { type: 'monolito', confidencePct: 90, determined: true, evidence: 'un solo despliegue' },
    });
    const determined = integrateAIFindings(determinedBase, findings);
    expect(determined.architecture).toEqual(determinedBase.architecture);
  });

  it('preserva hallazgos adicionales, notas de config y perfil de lenguajes intactos', () => {
    const base = staticResult();
    const findings: AIFindings = { kind: 'AI_FINDINGS' };
    const result = integrateAIFindings(base, findings);

    expect(result.additionalFindings).toEqual(base.additionalFindings);
    expect(result.configReadNotes).toEqual(base.configReadNotes);
    expect(result.primaryLanguage).toEqual(base.primaryLanguage);
    expect(result.secondaryLanguages).toEqual(base.secondaryLanguages);
    expect(result.notices).toEqual(base.notices);
  });

  it('no muta el resultado estático de entrada al enriquecer', () => {
    const base = staticResult();
    const snapshot = JSON.parse(JSON.stringify(base));
    integrateAIFindings(base, {
      kind: 'AI_FINDINGS',
      componentCategories: [{ path: 'src/x.ts', category: 'modulo' }],
    });
    expect(base).toEqual(snapshot);
  });
});
