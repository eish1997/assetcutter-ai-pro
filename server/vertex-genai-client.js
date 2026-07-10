/**
 * Vertex / Gemini Enterprise Agent Platform 客户端（@google/genai + ADC）。
 *
 * 官方：https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation
 * - 默认 location：us-central1 → {region}-aiplatform.googleapis.com（Console「Agent Platform API」）
 * - Gemini 3.x（含 flash-preview / *-image）：本项目在 us-central1 常 404，默认改走 global express
 *   （Console 可能记在「Gemini for Google Cloud API」）；可用 VERTEX_GEMINI3_LOCATION / VERTEX_AIPLATFORM_REGIONAL_ONLY 覆盖
 * - 生图需 config.responseModalities: ['TEXT','IMAGE']（见 gemini-proxy-api / buildGeminiConfig）
 * - REST 建议 v1
 */
import { GoogleGenAI } from '@google/genai';

const DEFAULT_REGIONAL_LOCATION = 'us-central1';
const DEFAULT_GEMINI3_LOCATION = 'global';

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

/**
 * Gemini 3 系列（含 preview / image）在部分项目的区域端点会 NOT_FOUND；
 * 默认走 global，除非 VERTEX_AIPLATFORM_REGIONAL_ONLY=true。
 */
export function isGemini3VertexModel(model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return false;
  return (
    m.startsWith('gemini-3') ||
    m.includes('gemini-3.') ||
    /^gemini-3[.-]/.test(m)
  );
}

export function resolveVertexGemini3LocationFromEnv() {
  if (String(process.env.VERTEX_AIPLATFORM_REGIONAL_ONLY || '').trim().toLowerCase() === 'true') {
    return resolveVertexLocationFromEnv().location;
  }
  const override = String(process.env.VERTEX_GEMINI3_LOCATION || '').trim();
  if (override) return override;
  return DEFAULT_GEMINI3_LOCATION;
}

/** Per-request location: Gemini 3 → global (default); else VERTEX_LOCATION. */
export function resolveVertexLocationForModel(model) {
  if (isGemini3VertexModel(model)) return resolveVertexGemini3LocationFromEnv();
  return resolveVertexLocationFromEnv().location;
}

export function vertexAgentPlatformHost(location) {
  const loc = String(location || '').trim() || DEFAULT_REGIONAL_LOCATION;
  if (loc === 'global') return 'aiplatform.googleapis.com';
  return `${loc}-aiplatform.googleapis.com`;
}

export function describeVertexAgentPlatformRoute() {
  const project = vertexProjectIdFromEnv();
  const { location } = resolveVertexLocationFromEnv();
  const gemini3Location = resolveVertexGemini3LocationFromEnv();
  const apiVersion = vertexApiVersionFromEnv();
  const host = vertexAgentPlatformHost(location);
  return {
    project: project || null,
    location,
    gemini3Location,
    apiVersion,
    apiHost: host,
    baseUrl: `https://${host}/`,
    agentPlatformRegional: location !== 'global',
    gemini3UsesGlobal: gemini3Location === 'global' && location !== 'global',
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

/** Pick client by model id (Gemini 3 → global by default). */
export function getVertexGenAIClientForModel(model) {
  return getVertexGenAIClientForLocation(resolveVertexLocationForModel(model));
}

/** @internal */
export function resetVertexGenAIClientForTests() {
  clientCache.clear();
}
