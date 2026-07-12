import { USE_POSTGRES } from '../auth-store.js';
import { aiGatewayCreditsGateMode } from './credits-gate.js';

export function isAiGatewayExecutionEnabled() {
  const raw = String(process.env.AI_GATEWAY_EXECUTION_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

export function aiGatewayHealthSnapshot() {
  return {
    enabled: true,
    executionEnabled: isAiGatewayExecutionEnabled(),
    jobStore: USE_POSTGRES ? 'postgres' : 'json',
    creditsGateMode: aiGatewayCreditsGateMode(),
    routes: {
      createJob: 'POST /ai-gateway/jobs',
      listJobs: 'GET /ai-gateway/jobs?limit=20',
      getJob: 'GET /ai-gateway/jobs/:id',
      updateJobStatus: 'PATCH /ai-gateway/jobs/:id',
      executeViaAuthApi: 'POST /api/ai/jobs (AI_GATEWAY_EXECUTION_ENABLED=true)',
    },
    adapters: ['gemini-proxy'],
    modalities: ['text', 'image', 'music', 'video', 'model3d'],
  };
}
