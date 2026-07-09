/**
 * Vertex / Agent Platform 客户端：强制区域 aiplatform 端点，避免 global 走 Console 里的
 * 「Gemini for Google Cloud API」计量线（用户侧 429 高发）。
 *
 * SDK 路由（@google/genai）：
 * - location=global 或 apiKey → https://aiplatform.googleapis.com/
 * - location=us-central1 等 → https://us-central1-aiplatform.googleapis.com/
 */
import { GoogleGenAI } from '@google/genai';

const DEFAULT_REGIONAL_LOCATION = 'us-central1';
const GLOBAL_LOCATION = 'global';

function envBool(name, defaultTrue = false) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return defaultTrue;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** 默认 true：仅走区域 Agent Platform API（{region}-aiplatform.googleapis.com） */
export function vertexAgentPlatformRegionalOnly() {
  return envBool('VERTEX_AIPLATFORM_REGIONAL_ONLY', true);
}

export function vertexAllowGlobalEndpoint() {
  return envBool('VERTEX_ALLOW_GLOBAL_ENDPOINT', false);
}

export function vertexProjectIdFromEnv() {
  return (process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
}

export function vertexApiVersionFromEnv() {
  const raw = String(process.env.VERTEX_API_VERSION || 'v1beta1').trim();
  return raw || 'v1beta1';
}

/**
 * 解析 Vertex location。regional-only 时把 global 降为 us-central1（预览模型需显式 VERTEX_ALLOW_GLOBAL_ENDPOINT=true）。
 * @returns {{ location: string, coercedFromGlobal: boolean }}
 */
export function resolveVertexLocationFromEnv() {
  const raw = (process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || '').trim();
  let location = raw || (vertexAgentPlatformRegionalOnly() ? DEFAULT_REGIONAL_LOCATION : GLOBAL_LOCATION);

  if (
    location === GLOBAL_LOCATION &&
    vertexAgentPlatformRegionalOnly() &&
    !vertexAllowGlobalEndpoint()
  ) {
    return { location: DEFAULT_REGIONAL_LOCATION, coercedFromGlobal: true };
  }

  return { location, coercedFromGlobal: false };
}

/** @returns {string} aiplatform 主机名（无 scheme） */
export function vertexAgentPlatformHost(location) {
  const loc = String(location || '').trim() || DEFAULT_REGIONAL_LOCATION;
  if (loc === GLOBAL_LOCATION) return 'aiplatform.googleapis.com';
  return `${loc}-aiplatform.googleapis.com`;
}

export function describeVertexAgentPlatformRoute() {
  const project = vertexProjectIdFromEnv();
  const { location, coercedFromGlobal } = resolveVertexLocationFromEnv();
  const apiVersion = vertexApiVersionFromEnv();
  const host = vertexAgentPlatformHost(location);
  return {
    project: project || null,
    location,
    apiVersion,
    apiHost: host,
    baseUrl: `https://${host}/`,
    regionalAgentPlatformOnly: vertexAgentPlatformRegionalOnly(),
    allowGlobalEndpoint: vertexAllowGlobalEndpoint(),
    coercedFromGlobal,
    usesGlobalExpressEndpoint: location === GLOBAL_LOCATION,
  };
}

let cachedClient = null;
let cachedClientKey = '';

/**
 * 单例 Vertex GenAI 客户端（ADC + 区域 Agent Platform）。
 * @returns {import('@google/genai').GoogleGenAI}
 */
export function getVertexGenAIClient() {
  const project = vertexProjectIdFromEnv();
  if (!project) {
    throw new Error('Vertex: set VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT');
  }
  const { location } = resolveVertexLocationFromEnv();
  const apiVersion = vertexApiVersionFromEnv();
  const cacheKey = `${project}\0${location}\0${apiVersion}`;
  if (cachedClient && cachedClientKey === cacheKey) return cachedClient;

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    apiVersion,
  });
  cachedClientKey = cacheKey;
  return cachedClient;
}

/** @internal */
export function resetVertexGenAIClientForTests() {
  cachedClient = null;
  cachedClientKey = '';
}
