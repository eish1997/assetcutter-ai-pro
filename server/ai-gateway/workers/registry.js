import { AiGatewayValidationError } from '../job.js';
import { imageWorker } from './image-worker.js';
import { model3dWorker } from './model3d-worker.js';
import { textWorker } from './text-worker.js';
import { publicWorkerDescriptor } from './types.js';
import { videoWorker } from './video-worker.js';

/** music-worker stub 已删除（cleanup）：不注册 music；resolve 抛 NOT_REGISTERED。 */
export const AI_GATEWAY_WORKERS = Object.freeze([
  textWorker,
  imageWorker,
  videoWorker,
  model3dWorker,
]);

const WORKER_BY_ID = new Map(AI_GATEWAY_WORKERS.map((worker) => [worker.id, worker]));

export function listAiGatewayWorkers() {
  return AI_GATEWAY_WORKERS.map(publicWorkerDescriptor);
}

export function resolveAiGatewayWorker(route) {
  const workerId = String(route?.workerId || '').trim();
  const worker = workerId ? WORKER_BY_ID.get(workerId) : null;
  if (!worker) {
    throw new AiGatewayValidationError(
      `No AI gateway worker registered for route: ${workerId || 'missing'}`,
      'AI_GATEWAY_WORKER_NOT_REGISTERED'
    );
  }
  return worker;
}

export function buildAiGatewayWorkerRequest(job, route) {
  const worker = resolveAiGatewayWorker(route);
  return worker.buildRequest(job, route);
}

export async function startAiGatewayWorkerExecution(plan, options = {}) {
  const worker = resolveAiGatewayWorker(plan?.route);
  return worker.start(plan, options);
}

export async function cancelAiGatewayWorkerExecution(plan, options = {}) {
  const worker = resolveAiGatewayWorker(plan?.route);
  return worker.cancel(plan, options);
}

export function estimateAiGatewayWorkerCost(job, route, options = {}) {
  const worker = resolveAiGatewayWorker(route);
  return worker.estimateCost(job, route, options);
}

export function settleAiGatewayWorkerUsage(plan, options = {}) {
  const worker = resolveAiGatewayWorker(plan?.route);
  return worker.settleUsage(plan, options);
}
