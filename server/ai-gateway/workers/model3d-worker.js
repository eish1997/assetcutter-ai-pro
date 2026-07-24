import { buildTripoWorkerRequest, cancelTripoExecution, startTripoExecution } from '../adapters/tripo-openapi-adapter.js';
import {
  buildTencentHunyuan3dWorkerRequest,
  cancelTencentHunyuan3dExecution,
  startTencentHunyuan3dExecution,
} from '../adapters/tencent-hunyuan-3d-adapter.js';
import {
  buildVolcengineArkAsyncWorkerRequest,
  cancelVolcengineArkAsyncExecution,
  startVolcengineArkAsyncExecution,
} from '../adapters/volcengine-ark-async-adapter.js';
import {
  buildOpenAiCompatibleAsyncWorkerRequest,
  cancelOpenAiCompatibleAsyncExecution,
  startOpenAiCompatibleAsyncExecution,
} from '../adapters/openai-compatible-async-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const model3dWorker = Object.freeze({
  id: 'model3d-worker',
  modalities: Object.freeze(['model3d']),
  capabilities: Object.freeze(['model3d.generate']),
  adapters: Object.freeze(['tripo-openapi', 'volcengine-ark-async', 'tencent-hunyuan-3d', 'openai-compatible-async']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(model3dWorker, route?.adapterId);
    if (route?.adapterId === 'openai-compatible-async') return buildOpenAiCompatibleAsyncWorkerRequest(job, route);
    if (route?.adapterId === 'volcengine-ark-async') return buildVolcengineArkAsyncWorkerRequest(job, route);
    if (route?.adapterId === 'tencent-hunyuan-3d') return buildTencentHunyuan3dWorkerRequest(job, route);
    return buildTripoWorkerRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(model3dWorker, plan?.route?.adapterId);
    if (plan?.route?.adapterId === 'openai-compatible-async') return startOpenAiCompatibleAsyncExecution(plan, options);
    if (plan?.route?.adapterId === 'volcengine-ark-async') return startVolcengineArkAsyncExecution(plan, options);
    if (plan?.route?.adapterId === 'tencent-hunyuan-3d') return startTencentHunyuan3dExecution(plan, options);
    return startTripoExecution(plan, options);
  },
  async cancel(plan, options = {}) {
    if (plan?.route?.adapterId === 'openai-compatible-async') return cancelOpenAiCompatibleAsyncExecution(plan, options);
    if (plan?.route?.adapterId === 'volcengine-ark-async') return cancelVolcengineArkAsyncExecution(plan, options);
    if (plan?.route?.adapterId === 'tencent-hunyuan-3d') return cancelTencentHunyuan3dExecution(plan, options);
    return cancelTripoExecution(plan, options);
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
