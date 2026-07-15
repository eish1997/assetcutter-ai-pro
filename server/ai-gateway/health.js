import { USE_POSTGRES } from '../auth-store.js';
import { aiGatewayCreditsGateMode } from './credits-gate.js';
import { aiGatewayAutoCircuitConfig, isAiGatewayAutoCircuitEnabled, resolveAiGatewayOpsControlSource } from './ops-control.js';
import { listAiGatewayWorkers } from './workers/registry.js';

export function isAiGatewayExecutionEnabled() {
  const raw = String(process.env.AI_GATEWAY_EXECUTION_ENABLED || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (!raw) return true;
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

export function aiGatewayHealthSnapshot() {
  return {
    enabled: true,
    executionEnabled: isAiGatewayExecutionEnabled(),
    jobStore: USE_POSTGRES ? 'postgres' : 'json',
    providerKeyStore: USE_POSTGRES ? 'postgres' : 'json',
    opsControlStore: resolveAiGatewayOpsControlSource(),
    autoCircuitEnabled: isAiGatewayAutoCircuitEnabled(),
    autoCircuit: aiGatewayAutoCircuitConfig(),
    creditsGateMode: aiGatewayCreditsGateMode(),
    routes: {
      createJob: 'POST /ai-gateway/jobs',
      listJobs: 'GET /ai-gateway/jobs?limit=20',
      getJob: 'GET /ai-gateway/jobs/:id',
      updateJobStatus: 'PATCH /ai-gateway/jobs/:id',
      executeViaAuthApi: 'POST /api/ai/jobs (AI_GATEWAY_EXECUTION_ENABLED=true)',
    },
    workers: listAiGatewayWorkers(),
    adapters: ['legacy-gemini-proxy', 'openai-official', 'toapis-openai', 'jimeng-visual', 'tripo-openapi'],
    legacyAdapters: ['gemini-proxy'],
    modalities: ['text', 'image', 'music', 'video', 'model3d'],
  };
}
