import { applyAiJobStatusPatch } from './job.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_JOBS = 500;

export function createInMemoryAiJobStore(options = {}) {
  const ttlMs = Number(options.ttlMs || process.env.AI_GATEWAY_JOB_TTL_MS) || DEFAULT_TTL_MS;
  const maxJobs = Number(options.maxJobs || process.env.AI_GATEWAY_MAX_JOBS) || DEFAULT_MAX_JOBS;
  const jobs = new Map();

  function prune(now = Date.now()) {
    for (const [id, entry] of jobs.entries()) {
      if (now - entry.touchedAt > ttlMs) jobs.delete(id);
    }
    while (jobs.size > maxJobs) {
      const oldest = jobs.keys().next().value;
      if (!oldest) break;
      jobs.delete(oldest);
    }
  }

  return {
    put(plan, now = Date.now()) {
      prune(now);
      jobs.set(plan.job.id, { plan, touchedAt: now });
      prune(now);
      return plan;
    },
    get(id, now = Date.now()) {
      prune(now);
      const entry = jobs.get(id);
      if (!entry) return null;
      entry.touchedAt = now;
      return entry.plan;
    },
    update(id, patch, options = {}, now = Date.now()) {
      prune(now);
      const entry = jobs.get(id);
      if (!entry) return null;
      const plan = applyAiJobStatusPatch(entry.plan, patch, options);
      jobs.set(id, { plan, touchedAt: now });
      return plan;
    },
    list(options = {}, now = Date.now()) {
      prune(now);
      const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 20)));
      return Array.from(jobs.values())
        .reverse()
        .slice(0, limit)
        .map((entry) => entry.plan);
    },
    size(now = Date.now()) {
      prune(now);
      return jobs.size;
    },
    clear() {
      jobs.clear();
    },
  };
}

export const aiGatewayJobStore = createInMemoryAiJobStore();
