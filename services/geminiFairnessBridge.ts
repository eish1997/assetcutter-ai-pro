/**
 * 浏览器直连 gemini-proxy 时，通过请求头传递限流键（与 `server/gemini-proxy-fairness.js` 对齐）。
 * 生产环境若代理对公网且未设 `GEMINI_FAIRNESS_TRUST_CLIENT_KEY_HEADER` / HMAC，请勿依赖浏览器自报 user id。
 */
let fairnessUserId: string | null = null;

const USER_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/** 由 `AuthProvider` 在登录态变化时调用。 */
export function setGeminiFairnessUserId(id: string | null): void {
  const s = typeof id === "string" ? id.trim() : "";
  fairnessUserId = s && USER_ID_RE.test(s) ? s : null;
}

/** 附加到 `fetch` 的 HeadersInit；无登录用户时返回空对象（代理走 anon 桶）。 */
export function getGeminiFairnessRequestHeaders(): Record<string, string> {
  if (!fairnessUserId) return {};
  return { "X-AC-Fairness-Key": `user:${fairnessUserId}` };
}
