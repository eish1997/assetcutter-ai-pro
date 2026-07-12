/**
 * Re-export shared extractor (gemini-proxy tests import this path).
 */
export {
  extractUsageMetadata,
  extractUsageMetadataFromProxyResult,
} from '../shared/extractUsageMetadata.js';

import { extractUsageMetadataFromProxyResult } from '../shared/extractUsageMetadata.js';

export function buildAiGatewayTraceSuccessMetadata(jobId, result) {
  const usageMetadata = extractUsageMetadataFromProxyResult(result);
  return {
    proxyJobId: jobId,
    proxyStatus: 'completed',
    ...(usageMetadata ? { usage: { usageMetadata } } : {}),
  };
}
