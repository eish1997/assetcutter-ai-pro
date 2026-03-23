/**
 * 向量引擎 VectorEngine（Gemini 原生 REST 兼容）适配层。
 * 文档示例：https://vectorengine.apifox.cn/api-381740608
 * 服务端点：https://api.vectorengine.ai
 *
 * 与 ToAPIs 的差异（维护时注意）：
 * - ToAPIs：OpenAI `/v1/chat/completions` + 异步 `/v1/images/generations`，需单独映射。
 * - VectorEngine：与 Google Gemini 相同的 `generateContent` / `streamGenerateContent` 协议，
 *   本站直接复用 `@google/genai` 的序列化，仅替换 `httpOptions.baseUrl`。
 * - 鉴权：与官方一致，浏览器侧由 SDK 使用 `x-goog-api-key`；若代理商仅支持 URL `?key=`，
 *   需在其控制台确认或与官方对齐后再改（避免重复实现整套 mldev 序列化）。
 */

import { GoogleGenAI } from '@google/genai';

/** 去掉末尾斜杠；空则使用官方文档中的正式环境根地址（不含路径） */
export function normalizeVectorengineBaseUrl(raw: string): string {
  const s = (raw || '').trim().replace(/\/+$/, '');
  return s || 'https://api.vectorengine.ai';
}

/**
 * 解析实际请求的 Base URL。
 * - 浏览器直连多数第三方 Gemini 网关会触发 CORS，表现为 `Failed to fetch`。
 * - 开发环境（Vite）默认走同源 `/__vectorengine`，由 vite.config 反代到 api.vectorengine.ai。
 * - 可选 `VITE_VECTOR_ENGINE_PROXY`：显式指定代理根地址（生产可配 Nginx 同源路径）。
 * - 可选 `VITE_VECTOR_ENGINE_DIRECT=true`：开发时仍使用设置页中的直连地址（用于验证代理商是否已放行 CORS）。
 */
export function resolveVectorengineBaseUrl(userStored: string): string {
  const env = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string> }).env : undefined;
  const proxyFromEnv = (env?.VITE_VECTOR_ENGINE_PROXY || '').trim();
  if (proxyFromEnv) {
    if (proxyFromEnv.startsWith('/')) {
      if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin.replace(/\/+$/, '')}${proxyFromEnv}`.replace(/\/+$/, '');
      }
      return proxyFromEnv;
    }
    return proxyFromEnv.replace(/\/+$/, '');
  }
  const direct = env?.VITE_VECTOR_ENGINE_DIRECT === 'true';
  if (env?.DEV && !direct && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/+$/, '')}/__vectorengine`;
  }
  return normalizeVectorengineBaseUrl(userStored);
}

/**
 * 使用 VectorEngine 网关的 Gemini 兼容客户端（与站内 `GeminiClientLike` 用法一致）。
 */
export function createVectorengineGeminiClient(baseUrl: string, apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: resolveVectorengineBaseUrl(baseUrl),
    },
  });
}
