import { describe, expect, it, vi } from 'vitest';

import { GroqProvider, createGroqProviderFromEnv } from './groq-provider.js';
import type { AIInferenceInput } from './types.js';

const input: AIInferenceInput = {
  jobId: 'job-1',
  primaryLanguage: 'TYPESCRIPT',
  code: [{ path: 'src/index.ts', content: 'console.log("hola");' }],
};

/** Construye una respuesta `fetch` simulada con el JSON del modelo. */
function fakeResponse(modelJson: unknown, ok = true, status = 200): Response {
  const body = {
    choices: [{ message: { content: JSON.stringify(modelJson) } }],
  };
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('createGroqProviderFromEnv', () => {
  it('devuelve null si falta la clave de API', () => {
    expect(createGroqProviderFromEnv({})).toBeNull();
  });

  it('crea el proveedor cuando la clave está presente', () => {
    expect(createGroqProviderFromEnv({ GROQ_API_KEY: 'k' })).not.toBeNull();
  });
});

describe('GroqProvider.infer', () => {
  it('transforma la respuesta del modelo en AIFindings válidos', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        summary: 'x'.repeat(60),
        summaryConfidencePct: 150, // se recorta a 100
        components: [
          { path: 'src/index.ts', category: 'punto_de_entrada', confidence: 2 }, // se recorta a 1
          { path: 'x', category: 'categoria_invalida' }, // se descarta
        ],
        architectureType: 'monolito',
        architectureConfidencePct: 80,
        architectureEvidence: 'un solo despliegue',
      }),
    );
    const provider = new GroqProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    const findings = await provider.infer(input);

    expect(findings.kind).toBe('AI_FINDINGS');
    expect(findings.functionalSummary?.confidencePct).toBe(100);
    expect(findings.componentCategories).toHaveLength(1);
    expect(findings.componentCategories?.[0].confidence).toBe(1);
    expect(findings.architecture?.type).toBe('monolito');
  });

  it('envía el modelo y la clave en la petición', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ summary: 'y'.repeat(60) }));
    const provider = new GroqProvider({
      apiKey: 'secreta',
      model: 'llama-3.1-8b-instant',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.infer(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secreta');
    expect(String(init.body)).toContain('llama-3.1-8b-instant');
  });

  it('respeta el presupuesto total de caracteres del código enviado', async () => {
    let sentBody = '';
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return fakeResponse({ summary: 'z'.repeat(60) });
    });
    const bigInput: AIInferenceInput = {
      jobId: 'job-2',
      primaryLanguage: 'TYPESCRIPT',
      code: Array.from({ length: 50 }, (_v, i) => ({
        path: `src/file-${i}.ts`,
        content: 'a'.repeat(5_000),
      })),
    };
    const provider = new GroqProvider({
      apiKey: 'k',
      maxFiles: 12,
      maxCharsPerFile: 1_500,
      maxTotalChars: 6_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.infer(bigInput);

    // El código incluido son bloques 'aaaa...'; el runs más largo de 'a' consecutivas
    // proviene del contenido de un archivo y no debe superar maxCharsPerFile,
    // y la suma total de 'a' de código no debe superar el presupuesto total.
    const runs = sentBody.match(/a{100,}/g) ?? [];
    const totalCodeChars = runs.reduce((sum, run) => sum + run.length, 0);
    expect(totalCodeChars).toBeLessThanOrEqual(6_000);
    for (const run of runs) {
      expect(run.length).toBeLessThanOrEqual(1_500);
    }
  });

  it('lanza cuando la API responde con error (para degradar a solo estático)', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({}, false, 500));
    const provider = new GroqProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.infer(input)).rejects.toThrow();
  });
});
