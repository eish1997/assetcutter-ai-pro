import { buildTripoWorkerRequest, cancelTripoExecution, startTripoExecution } from '../adapters/tripo-openapi-adapter.js';
import {
  buildVolcengineArkAsyncWorkerRequest,
  cancelVolcengineArkAsyncExecution,
  startVolcengineArkAsyncExecution,
} from '../adapters/volcengine-ark-async-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const model3dWorker = Object.freeze({
  id: 'model3d-worker',
  modalities: Object.freeze(['model3d']),
  capabilities: Object.freeze(['model3d.generate']),
  adapters: Object.freeze(['tripo-openapi', 'volcengine-ark-async']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(model3dWorker, route?.adapterId);
    if (route?.adapterId === 'volcengine-ark-async') return buildVolcengineArkAsyncWorkerRequest(job, route);
    return buildTripoWorkerRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(model3dWorker, plan?.route?.adapterId);
    if (plan?.route?.adapterId === 'volcengine-ark-async') return startVolcengineArkAsyncExecution(plan, options);
    return startTripoExecution(plan, options);
  },
  async cancel(plan, options = {}) {
    if (plan?.route?.adapterId === 'volcengine-ark-async') return cancelVolcengineArkAsyncExecution(plan, options);
    return cancelTripoExecution(plan, options);
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
