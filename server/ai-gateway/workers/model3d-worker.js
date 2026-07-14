import { buildTripoWorkerRequest, cancelTripoExecution, startTripoExecution } from '../adapters/tripo-openapi-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const model3dWorker = Object.freeze({
  id: 'model3d-worker',
  modalities: Object.freeze(['model3d']),
  capabilities: Object.freeze(['model3d.generate']),
  adapters: Object.freeze(['tripo-openapi']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(model3dWorker, route?.adapterId);
    return buildTripoWorkerRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(model3dWorker, plan?.route?.adapterId);
    return startTripoExecution(plan, options);
  },
  async cancel(plan, options = {}) {
    return cancelTripoExecution(plan, options);
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
