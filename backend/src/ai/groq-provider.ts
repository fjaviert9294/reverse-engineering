/**
 * Proveedor de IA concreto basado en Groq (API de Chat Completions compatible
 * con OpenAI).
 *
 * Implementa el puerto `AIProvider` (decisión abierta #1 del diseño): recibe la
 * entrada de inferencia ya filtrada por privacidad (el módulo solo invoca al
 * proveedor cuando el `Parametro_Privacidad` está habilitado, Requisito 4.4) y
 * devuelve `AIFindings`. Si la llamada al modelo falla o la respuesta no es
 * interpretable, LANZA; el `DefaultAIInferenceModule` captura el fallo y degrada
 * a solo estático con aviso (Requisitos 3.6, 14.5).
 *
 * IMPORTANTE (Requisito 2.2): esta clase transmite código fuente transitorio al
 * proveedor únicamente durante la inferencia; nunca lo persiste. La respuesta se
 * transforma en resultados/metadatos (resumen, categorías, arquitectura).
 *
 * No añade dependencias: usa `fetch` nativo (Node.js >= 18). La clave de API y el
 * modelo se leen de variables de entorno (Requisito 4.5).
 */

import type {
  AIComponentCategory,
  AIFindings,
  AIInferenceInput,
  AIProvider,
} from './types.js';
import type {
  ArchitectureType,
  ComponentCategory,
} from '../domain/index.js';

/** Nombre de la variable de entorno con la clave de API de Groq (Requisito 4.5). */
export const GROQ_API_KEY_ENV_VAR = 'GROQ_API_KEY';
/** Modelo por defecto; puede sobreescribirse con `GROQ_MODEL`. */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b';

const GROQ_CHAT_COMPLETIONS_ENDPOINT =
  'https://api.groq.com/openai/v1/chat/completions';

/**
 * Topes del contenido enviado al modelo. Se mantienen conservadores para caber
 * en los límites de tokens por minuto del tier gratuito de Groq (p. ej. 8000 TPM
 * en algunos modelos). Como referencia aproximada, ~4 caracteres ≈ 1 token.
 *
 * `MAX_TOTAL_CHARS` acota el TAMAÑO TOTAL del código incluido en el prompt;
 * `MAX_FILES` y `MAX_CHARS_PER_FILE` acotan por archivo. Pueden ajustarse con las
 * variables de entorno GROQ_MAX_FILES, GROQ_MAX_CHARS_PER_FILE y
 * GROQ_MAX_TOTAL_CHARS (por si usas un modelo con mayor presupuesto de tokens).
 */
const DEFAULT_MAX_FILES = 12;
const DEFAULT_MAX_CHARS_PER_FILE = 1_500;
const DEFAULT_MAX_TOTAL_CHARS = 12_000;

const VALID_CATEGORIES: ReadonlySet<ComponentCategory> = new Set([
  'modulo',
  'servicio',
  'controlador',
  'modelo',
  'punto_de_entrada',
  'configuracion',
]);

const VALID_ARCHITECTURES: ReadonlySet<ArchitectureType> = new Set([
  'monolito',
  'microservicios',
  'mvc',
  'hexagonal',
  'por_capas',
  'otro',
]);

export interface GroqProviderOptions {
  apiKey: string;
  model?: string;
  /** Máximo de archivos incluidos en el prompt. */
  maxFiles?: number;
  /** Máximo de caracteres por archivo. */
  maxCharsPerFile?: number;
  /** Presupuesto total de caracteres de código en el prompt. */
  maxTotalChars?: number;
  /** Inyectable para pruebas; por defecto, el `fetch` global. */
  fetchImpl?: typeof fetch;
}

/**
 * Construye un proveedor Groq a partir del entorno, o devuelve `null` si la clave
 * de API no está configurada. El composition root usa esto para resolver el
 * proveedor concreto sin acoplarse a él.
 */
export function createGroqProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GroqProvider | null {
  const apiKey = env[GROQ_API_KEY_ENV_VAR];
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return null;
  }
  const model = env.GROQ_MODEL?.trim() || GROQ_DEFAULT_MODEL;
  return new GroqProvider({
    apiKey: apiKey.trim(),
    model,
    maxFiles: parsePositiveInt(env.GROQ_MAX_FILES),
    maxCharsPerFile: parsePositiveInt(env.GROQ_MAX_CHARS_PER_FILE),
    maxTotalChars: parsePositiveInt(env.GROQ_MAX_TOTAL_CHARS),
  });
}

/** Interpreta un entero positivo de una variable de entorno; `undefined` si no aplica. */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Respuesta mínima esperada de la API de Chat Completions de Groq. */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

/** Estructura JSON que pedimos al modelo que devuelva. */
interface ModelPayload {
  summary?: unknown;
  summaryConfidencePct?: unknown;
  components?: unknown;
  architectureType?: unknown;
  architectureConfidencePct?: unknown;
  architectureEvidence?: unknown;
}

export class GroqProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxFiles: number;
  private readonly maxCharsPerFile: number;
  private readonly maxTotalChars: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? GROQ_DEFAULT_MODEL;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE;
    this.maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async infer(input: AIInferenceInput): Promise<AIFindings> {
    const prompt = buildPrompt(input, {
      maxFiles: this.maxFiles,
      maxCharsPerFile: this.maxCharsPerFile,
      maxTotalChars: this.maxTotalChars,
    });

    const response = await this.fetchImpl(GROQ_CHAT_COMPLETIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Eres un asistente que analiza repositorios de código fuente y responde exclusivamente con JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      // Incluimos el cuerpo del error de Groq para diagnosticar (clave inválida,
      // modelo inexistente, rate limit, etc.). No expone el código fuente.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Groq respondió con estado ${response.status}: ${detail.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Groq devolvió una respuesta vacía.');
    }

    const payload = JSON.parse(text) as ModelPayload;
    return toFindings(payload);
  }
}

interface PromptLimits {
  maxFiles: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
}

/** Construye el prompt en español pidiendo un JSON estricto, acotando el tamaño. */
function buildPrompt(input: AIInferenceInput, limits: PromptLimits): string {
  const blocks: string[] = [];
  let usedChars = 0;
  for (const file of input.code.slice(0, limits.maxFiles)) {
    if (usedChars >= limits.maxTotalChars) {
      break;
    }
    const remaining = limits.maxTotalChars - usedChars;
    const budget = Math.min(limits.maxCharsPerFile, remaining);
    const content = file.content.slice(0, budget);
    usedChars += content.length;
    blocks.push(`--- ${file.path} ---\n${content}`);
  }
  const files = blocks.join('\n\n');

  const language = input.primaryLanguage ?? 'desconocido';

  return [
    `Lenguaje principal detectado: ${language}.`,
    'Analiza el siguiente código y devuelve EXCLUSIVAMENTE un objeto JSON con esta forma:',
    '{',
    '  "summary": string (explicación funcional en español, 50-2000 caracteres),',
    '  "summaryConfidencePct": number (0-100),',
    '  "components": [{ "path": string, "category": "modulo|servicio|controlador|modelo|punto_de_entrada|configuracion", "confidence": number (0-1) }],',
    '  "architectureType": "monolito|microservicios|mvc|hexagonal|por_capas|otro" | null,',
    '  "architectureConfidencePct": number (0-100),',
    '  "architectureEvidence": string',
    '}',
    'No incluyas texto fuera del JSON.',
    '',
    'Código:',
    files,
  ].join('\n');
}

/** Transforma la respuesta del modelo en `AIFindings`, validando y acotando. */
function toFindings(payload: ModelPayload): AIFindings {
  const findings: AIFindings = { kind: 'AI_FINDINGS' };

  if (typeof payload.summary === 'string' && payload.summary.trim().length > 0) {
    findings.functionalSummary = {
      summary: payload.summary.trim().slice(0, 2000),
      confidencePct: clampPct(payload.summaryConfidencePct),
      determined: true,
    };
  }

  if (Array.isArray(payload.components)) {
    const components = payload.components
      .map(toComponentCategory)
      .filter((component): component is AIComponentCategory => component !== null);
    if (components.length > 0) {
      findings.componentCategories = components;
    }
  }

  const architectureType = normalizeArchitecture(payload.architectureType);
  if (architectureType !== undefined) {
    findings.architecture = {
      type: architectureType,
      confidencePct: clampPct(payload.architectureConfidencePct),
      determined: architectureType !== null,
      evidence:
        typeof payload.architectureEvidence === 'string'
          ? payload.architectureEvidence
          : '',
    };
  }

  return findings;
}

function toComponentCategory(raw: unknown): AIComponentCategory | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as { path?: unknown; category?: unknown; confidence?: unknown };
  if (typeof candidate.path !== 'string' || candidate.path.trim().length === 0) {
    return null;
  }
  if (
    typeof candidate.category !== 'string' ||
    !VALID_CATEGORIES.has(candidate.category as ComponentCategory)
  ) {
    return null;
  }
  const component: AIComponentCategory = {
    path: candidate.path.trim(),
    category: candidate.category as ComponentCategory,
  };
  if (typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)) {
    component.confidence = Math.min(1, Math.max(0, candidate.confidence));
  }
  return component;
}

function normalizeArchitecture(raw: unknown): ArchitectureType | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw === 'string' && VALID_ARCHITECTURES.has(raw as ArchitectureType)) {
    return raw as ArchitectureType;
  }
  return undefined;
}

function clampPct(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 0;
  }
  return Math.round(Math.min(100, Math.max(0, raw)));
}
