import { buildJimengVideoWorkerRequest, startJimengVideoExecution } from '../adapters/jimeng-visual-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const videoWorker = Object.freeze({
  id: 'video-worker',
  modalities: Object.freeze(['video']),
  capabilities: Object.freeze(['video.generate', 'workflow_generate_video', 'workflow_jimeng_video']),
  adapters: Object.freeze(['jimeng-visual']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(videoWorker, route?.adapterId);
    return buildJimengVideoWorkerRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(videoWorker, plan?.route?.adapterId);
    return startJimengVideoExecution(plan, options);
  },
  async cancel() {
    return { cancelled: false, mode: 'soft', reason: 'jimeng_cancel_not_implemented' };
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
