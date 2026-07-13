import { buildAiGatewayImageJobBody, isAiGatewayImageExecutionEnabled, type AiGatewayTraceInput } from './aiGatewayTrace';
import { createAiJob, type AiJobDetail } from './aiJobsClient';

export type AiGatewayImageExecutionInput = AiGatewayTraceInput & {
  abortSignal?: AbortSignal;
};

export type AiGatewayImageExecutionResult = {
  aiGatewayJobId: string | null;
  proxyJobId: string | null;
  createStatus: string;
  detail: AiJobDetail;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function createAiGatewayImageExecutionJob(
  input: AiGatewayImageExecutionInput
): Promise<AiGatewayImageExecutionResult | null> {
  if (!isAiGatewayImageExecutionEnabled(input.useVertex)) return null;
  const detail = await createAiJob(
    buildAiGatewayImageJobBody(input, { traceOnly: false }) as Parameters<typeof createAiJob>[0],
    {
      signal: input.abortSignal,
      cache: 'no-store',
    }
  );
  return {
    aiGatewayJobId: nonEmptyString(detail.job?.id),
    proxyJobId: nonEmptyString(detail.job?.proxyJobId),
    createStatus: nonEmptyString(detail.job?.status) || 'created',
    detail,
  };
}
