export type AiGatewayTraceInput = {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  registryId?: string;
  estimatedCredits?: number;
  useVertex?: boolean;
  source?: string;
};

function readEnv(name: string): string {
  try {
    const nodeEnv = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    if (nodeEnv !== undefined) return String(nodeEnv).trim();
  } catch {
    /* ignore */
  }
  try {
    return String((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] || '').trim();
  } catch {
    return '';
  }
}

export function isAiGatewayJobTraceEnabled(useVertex?: boolean): boolean {
  const raw = readEnv('VITE_AI_GATEWAY_JOB_TRACE');
  if (/^(0|false|off|no)$/i.test(raw)) return false;
  if (/^(1|true|on|yes)$/i.test(raw)) return true;
  return Boolean(useVertex);
}

export function isAiGatewayImageExecutionEnabled(useVertex?: boolean): boolean {
  const raw = readEnv('VITE_AI_GATEWAY_IMAGE_EXECUTION');
  if (/^(0|false|off|no)$/i.test(raw)) return false;
  if (/^(1|true|on|yes)$/i.test(raw)) return true;
  if (/^vertex$/i.test(raw)) return Boolean(useVertex);
  return false;
}

export function buildAiGatewayImageJobBody(
  input: AiGatewayTraceInput,
  options: { traceOnly?: boolean } = {}
): Record<string, unknown> {
  const traceOnly = options.traceOnly !== false;
  const metadata: Record<string, unknown> = {
    source: input.source || 'geminiService.bulkProxyGenerateContentAsync',
    legacyPath: '/proxy/gemini/async',
    useVertex: Boolean(input.useVertex),
  };
  if (traceOnly) metadata.traceOnly = true;
  if (input.registryId) metadata.registryId = input.registryId;
  return {
    modality: 'image',
    capability: 'image.generate',
    provider: input.useVertex ? 'vertex-gemini' : undefined,
    model: input.model,
    estimatedCredits: input.estimatedCredits,
    input: {
      model: input.model,
      contents: input.contents,
      config: input.config || {},
      estimatedCredits: input.estimatedCredits,
    },
    metadata,
  };
}

export function buildAiGatewayImageJobTraceBody(input: AiGatewayTraceInput): Record<string, unknown> {
  return buildAiGatewayImageJobBody(input, { traceOnly: true });
}

export function extractAiGatewayTraceJobId(raw: unknown): string | null {
  const obj = raw && typeof raw === 'object' ? (raw as { job?: { id?: unknown } }) : null;
  const id = obj?.job?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
