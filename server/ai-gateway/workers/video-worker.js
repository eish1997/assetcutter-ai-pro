import { buildJimengVideoWorkerRequest, cancelJimengVideoExecution, startJimengVideoExecution } from '../adapters/jimeng-visual-adapter.js';
import {
  buildVolcengineArkAsyncWorkerRequest,
  cancelVolcengineArkAsyncExecution,
  startVolcengineArkAsyncExecution,
} from '../adapters/volcengine-ark-async-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const videoWorker = Object.freeze({
  id: 'video-worker',
  modalities: Object.freeze(['video']),
  capabilities: Object.freeze(['video.generate', 'workflow_generate_video', 'workflow_jimeng_video']),
  adapters: Object.freeze(['jimeng-visual', 'volcengine-ark-async']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(videoWorker, route?.adapterId);
    if (route?.adapterId === 'volcengine-ark-async') return buildVolcengineArkAsyncWorkerRequest(job, route);
    return buildJimengVideoWorkerRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(videoWorker, plan?.route?.adapterId);
    if (plan?.route?.adapterId === 'volcengine-ark-async') return startVolcengineArkAsyncExecution(plan, options);
    return startJimengVideoExecution(plan, options);
  },
  async cancel(plan, options = {}) {
    if (plan?.route?.adapterId === 'volcengine-ark-async') return cancelVolcengineArkAsyncExecution(plan, options);
    return cancelJimengVideoExecution(plan, options);
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
