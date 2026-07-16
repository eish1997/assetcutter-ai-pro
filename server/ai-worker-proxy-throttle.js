import { recordAiWorkerProxyThrottleWait } from './ai-worker-proxy-observability.js';
import fs from 'fs';
import path from 'path';

const FALSEY = new Set(['', '0', 'false', 'no', 'off']);

let throttleTail = Promise.resolve();
let lastVertexImageStartAt = 0;
let throttleStateLoaded = false;

function isProductionRuntime() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function envInt(name, fallback, min = 0, max = 10 * 60 * 1000) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function envBool(name, defaultValue = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  if (FALSEY.has(raw)) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function persistentThrottleEnabled() {
  return envBool('GEMINI_VERTEX_IMAGE_THROTTLE_PERSIST', isProductionRuntime());
}

function throttleStatePath() {
  const custom = String(process.env.GEMINI_VERTEX_IMAGE_THROTTLE_STATE_PATH || '').trim();
  return custom
    ? path.resolve(custom)
    : path.resolve(process.cwd(), 'server/data/gemini-vertex-image-throttle-state.json');
}

function loadThrottleStateOnce() {
  if (throttleStateLoaded) return;
  throttleStateLoaded = true;
  if (!persistentThrottleEnabled()) return;
  try {
    const raw = fs.readFileSync(throttleStatePath(), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const t = Math.floor(Number(parsed.lastVertexImageStartAt || 0));
    if (Number.isFinite(t) && t > lastVertexImageStartAt) {
      lastVertexImageStartAt = t;
    }
  } catch {
    /* no persisted throttle state yet */
  }
}

function persistThrottleState() {
  if (!persistentThrottleEnabled()) return;
  try {
    const file = throttleStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ lastVertexImageStartAt })}\n`, 'utf8');
  } catch (e) {
    console.warn('[ai-worker-proxy] vertex image throttle state persist failed:', e instanceof Error ? e.message : String(e));
  }
}

function isImageVertexCall(model, config) {
  const m = String(model || '').toLowerCase();
  if (m.includes('image')) return true;
  const modalities = config?.responseModalities || config?.response_modalities;
  if (Array.isArray(modalities)) {
    return modalities.some((item) => String(item || '').trim().toLowerCase() === 'image');
  }
  return false;
}

export function vertexImageMinIntervalMs() {
  const fallback = isProductionRuntime() ? 65_000 : 0;
  return envInt(
    'GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS',
    envInt('GEMINI_VERTEX_MIN_INTERVAL_MS', fallback, 0),
    0
  );
}

export function aiWorkerProxyThrottleSnapshot() {
  loadThrottleStateOnce();
  return {
    vertexImageMinIntervalMs: vertexImageMinIntervalMs(),
    vertexImageThrottleEnabled: envBool('GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED', true),
    vertexImageThrottlePersistEnabled: persistentThrottleEnabled(),
    lastVertexImageStartAt,
  };
}

export async function waitForGeminiUpstreamThrottle(args = {}) {
  const useVertex = Boolean(args.useVertex);
  if (!useVertex || !isImageVertexCall(args.model, args.config)) return;
  if (!envBool('GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED', true)) return;
  loadThrottleStateOnce();
  const minIntervalMs = vertexImageMinIntervalMs();
  if (minIntervalMs <= 0) return;
  const nowFn = args.nowFn || Date.now;
  const sleepFn = args.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const run = async () => {
    const waitMs = Math.max(0, lastVertexImageStartAt + minIntervalMs - nowFn());
    if (waitMs > 0) {
      console.warn(`[ai-worker-proxy] vertex image throttle wait=${waitMs}ms minInterval=${minIntervalMs}ms`);
      recordAiWorkerProxyThrottleWait({ waitMs, minIntervalMs });
      await sleepFn(waitMs);
    }
    lastVertexImageStartAt = nowFn();
    persistThrottleState();
  };
  const next = throttleTail.then(run, run);
  throttleTail = next.catch(() => {});
  await next;
}

export function resetAiWorkerProxyThrottleForTests() {
  throttleTail = Promise.resolve();
  lastVertexImageStartAt = 0;
  throttleStateLoaded = false;
}
