import { recordGeminiProxyThrottleWait } from './gemini-proxy-observability.js';

const FALSEY = new Set(['', '0', 'false', 'no', 'off']);

let throttleTail = Promise.resolve();
let lastVertexImageStartAt = 0;

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

export function geminiProxyThrottleSnapshot() {
  return {
    vertexImageMinIntervalMs: vertexImageMinIntervalMs(),
    vertexImageThrottleEnabled: envBool('GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED', true),
    lastVertexImageStartAt,
  };
}

export async function waitForGeminiUpstreamThrottle(args = {}) {
  const useVertex = Boolean(args.useVertex);
  if (!useVertex || !isImageVertexCall(args.model, args.config)) return;
  if (!envBool('GEMINI_VERTEX_IMAGE_THROTTLE_ENABLED', true)) return;
  const minIntervalMs = vertexImageMinIntervalMs();
  if (minIntervalMs <= 0) return;
  const nowFn = args.nowFn || Date.now;
  const sleepFn = args.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const run = async () => {
    const waitMs = Math.max(0, lastVertexImageStartAt + minIntervalMs - nowFn());
    if (waitMs > 0) {
      console.warn(`[gemini-proxy] vertex image throttle wait=${waitMs}ms minInterval=${minIntervalMs}ms`);
      recordGeminiProxyThrottleWait({ waitMs, minIntervalMs });
      await sleepFn(waitMs);
    }
    lastVertexImageStartAt = nowFn();
  };
  const next = throttleTail.then(run, run);
  throttleTail = next.catch(() => {});
  await next;
}

export function resetGeminiProxyThrottleForTests() {
  throttleTail = Promise.resolve();
  lastVertexImageStartAt = 0;
}
