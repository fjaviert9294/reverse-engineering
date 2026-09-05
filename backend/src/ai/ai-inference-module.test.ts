import { describe, it, expect, vi } from 'vitest';
import {
  DefaultAIInferenceModule,
  AI_PROVIDER_ENV_VAR,
  type AIProvider,
  type AIFindings,
  type AIInferenceInput,
} from './index.js';

/**
 * Pruebas de ejemplo/unit del cliente del Módulo de Inferencia IA detrás de una
 * abstracción de proveedor (Task 10.1).
 *
 * Cubren:
 * - Requisito 4.1/4.2: el `Parametro_Privacidad` controla el envío de código y su
 *   valor por defecto es deshabilitado (no se envía código sin activación).
 * - Requisito 4.3: con privacidad deshabilitada, no se envía código y la
 *   inferencia se omite sin interrumpir el flujo.
 * - Requisito 4.4: con privacidad habilitada + IA, se envía el código al proveedor.
 * - Requisito 4.5: la configuración del proveedor se lee de una variable de entorno.
 * - Requisito 4.6: proveedor ausente/vacío -> no se envía código, se omite la
 *   inferencia y se emite un aviso de error.
 * - Requisitos 3.6, 14.5: fallo del proveedor -> degradación elegante con aviso.
 */

const SAMPLE_INPUT: AIInferenceInput = {
  jobId: 'job-1',
  primaryLanguage: 'TYPESCRIPT',
  code: [{ path: 'src/index.ts', content: 'console.log("hola");' }],
};

const FINDINGS: AIFindings = {
  kind: 'AI_FINDINGS',
  functionalSummary: {
    summary: 'Una aplicación de ejemplo que imprime un saludo por consola para demostración.',
    confidencePct: 80,
    determined: true,
  },
};

/** Crea un proveedor mock que devuelve hallazgos fijos y registra sus llamadas. */
function providerReturning(findings: AIFindings): { provider: AIProvider; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async (_input: AIInferenceInput) => findings);
  return { provider: { infer: spy }, spy };
}

describe('DefaultAIInferenceModule.isConfigured (Requisitos 4.5, 4.6)', () => {
  it('devuelve true cuando la variable de entorno del proveedor está presente y no vacía', () => {
    const { provider } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({
      provider,
      env: { [AI_PROVIDER_ENV_VAR]: 'algun-proveedor' },
    });
    expect(mod.isConfigured()).toBe(true);
  });

  it('devuelve false cuando la variable de entorno está ausente', () => {
    const { provider } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({ provider, env: {} });
    expect(mod.isConfigured()).toBe(false);
  });

  it('devuelve false cuando la variable de entorno está vacía o solo con espacios', () => {
    const { provider } = providerReturning(FINDINGS);
    const modEmpty = new DefaultAIInferenceModule({ provider, env: { [AI_PROVIDER_ENV_VAR]: '' } });
    const modBlank = new DefaultAIInferenceModule({ provider, env: { [AI_PROVIDER_ENV_VAR]: '   ' } });
    expect(modEmpty.isConfigured()).toBe(false);
    expect(modBlank.isConfigured()).toBe(false);
  });

  it('permite configurar el nombre de la variable de entorno sin fijar un proveedor concreto', () => {
    const { provider } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({
      provider,
      env: { MI_PROVEEDOR_IA: 'x' },
      envVarName: 'MI_PROVEEDOR_IA',
    });
    expect(mod.isConfigured()).toBe(true);
  });
});

describe('DefaultAIInferenceModule.infer - privacidad (Requisitos 4.1, 4.2, 4.3)', () => {
  it('con privacidad deshabilitada, no envía código y omite la inferencia', async () => {
    const { provider, spy } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({
      provider,
      env: { [AI_PROVIDER_ENV_VAR]: 'algun-proveedor' },
    });

    const result = await mod.infer(SAMPLE_INPUT, false);

    expect(spy).not.toHaveBeenCalled();
    expect(result.kind).toBe('AI_UNAVAILABLE');
    if (result.kind === 'AI_UNAVAILABLE') {
      expect(result.reason).toBe('PRIVACIDAD_DESHABILITADA');
      expect(result.notice.length).toBeGreaterThan(0);
    }
  });

  it('no envía código aunque el proveedor esté configurado si la privacidad está deshabilitada', async () => {
    const { provider, spy } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({
      provider,
      env: { [AI_PROVIDER_ENV_VAR]: 'algun-proveedor' },
    });

    await mod.infer(SAMPLE_INPUT, false);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('DefaultAIInferenceModule.infer - envío con IA (Requisito 4.4)', () => {
  it('con privacidad habilitada y proveedor configurado, envía el código al proveedor', async () => {
    const { provider, spy } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({
      provider,
      env: { [AI_PROVIDER_ENV_VAR]: 'algun-proveedor' },
    });

    const result = await mod.infer(SAMPLE_INPUT, true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(SAMPLE_INPUT);
    expect(result).toEqual(FINDINGS);
  });
});

describe('DefaultAIInferenceModule.infer - proveedor ausente (Requisitos 4.5, 4.6)', () => {
  it('con privacidad habilitada pero proveedor no configurado, no envía código, omite y avisa error', async () => {
    const { provider, spy } = providerReturning(FINDINGS);
    const mod = new DefaultAIInferenceModule({ provider, env: {} });

    const result = await mod.infer(SAMPLE_INPUT, true);

    expect(spy).not.toHaveBeenCalled();
    expect(result.kind).toBe('AI_UNAVAILABLE');
    if (result.kind === 'AI_UNAVAILABLE') {
      expect(result.reason).toBe('PROVEEDOR_NO_CONFIGURADO');
      expect(result.notice.length).toBeGreaterThan(0);
    }
  });
});

describe('DefaultAIInferenceModule.infer - degradación elegante (Requisitos 3.6, 14.5)', () => {
  it('si el proveedor falla, degrada a solo estático con aviso sin lanzar', async () => {
    const failing: AIProvider = {
      infer: vi.fn(async () => {
        throw new Error('proveedor caído');
      }),
    };
    const mod = new DefaultAIInferenceModule({
      provider: failing,
      env: { [AI_PROVIDER_ENV_VAR]: 'algun-proveedor' },
    });

    const result = await mod.infer(SAMPLE_INPUT, true);

    expect(result.kind).toBe('AI_UNAVAILABLE');
    if (result.kind === 'AI_UNAVAILABLE') {
      expect(result.reason).toBe('PROVEEDOR_FALLO');
      expect(result.notice.length).toBeGreaterThan(0);
    }
  });
});
