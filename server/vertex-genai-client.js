/**
 * Vertex / Gemini Enterprise Agent Platform 客户端（@google/genai + ADC）。
 *
 * 官方：https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation
 * - location 默认 us-central1 → {region}-aiplatform.googleapis.com（Console「Agent Platform API」）
 * - 生图需 config.responseModalities: ['TEXT','IMAGE']（见 gemini-proxy-api / buildGeminiConfig）
 * - REST 建议 v1（GenerateContent on publishers/google/models）
 */
import { GoogleGenAI } from '@google/genai';

const DEFAULT_REGIONAL_LOCATION = 'us-central1';

export function vertexProjectIdFromEnv() {
  return (process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
}

/** Agent Platform 生图/GA 模型推荐 v1；可用 VERTEX_API_VERSION 覆盖 */
export function vertexApiVersionFromEnv() {
  const raw = String(process.env.VERTEX_API_VERSION || 'v1').trim();
  return raw || 'v1';
}

export function resolveVertexLocationFromEnv() {
  const location = (
    process.env.VERTEX_LOCATION ||
    process.env.GOOGLE_CLOUD_LOCATION ||
    DEFAULT_REGIONAL_LOCATION
  ).trim() || DEFAULT_REGIONAL_LOCATION;
  return { location };
}

export function vertexAgentPlatformHost(location) {
  const loc = String(location || '').trim() || DEFAULT_REGIONAL_LOCATION;
  if (loc === 'global') return 'aiplatform.googleapis.com';
  return `${loc}-aiplatform.googleapis.com`;
}

export function describeVertexAgentPlatformRoute() {
  const project = vertexProjectIdFromEnv();
  const { location } = resolveVertexLocationFromEnv();
  const apiVersion = vertexApiVersionFromEnv();
  const host = vertexAgentPlatformHost(location);
  return {
    project: project || null,
    location,
    apiVersion,
    apiHost: host,
    baseUrl: `https://${host}/`,
    agentPlatformRegional: location !== 'global',
  };
}

/** @type {Map<string, import('@google/genai').GoogleGenAI>} */
const clientCache = new Map();

export function getVertexGenAIClientForLocation(locationOverride) {
  const project = vertexProjectIdFromEnv();
  if (!project) {
    throw new Error('Vertex: set VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT');
  }
  const { location: envLocation } = resolveVertexLocationFromEnv();
  const location =
    locationOverride != null && String(locationOverride).trim()
      ? String(locationOverride).trim()
      : envLocation;
  const apiVersion = vertexApiVersionFromEnv();
  const cacheKey = `${project}\0${location}\0${apiVersion}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    apiVersion,
  });
  clientCache.set(cacheKey, client);
  return client;
}

export function getVertexGenAIClient() {
  return getVertexGenAIClientForLocation();
}

/** @internal */
export function resetVertexGenAIClientForTests() {
  clientCache.clear();
}
