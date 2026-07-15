export class HttpRequestError extends Error {
  status: number;
  code?: string;
  payload?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, payload?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

const AI_GATEWAY_ERROR_MESSAGES: Record<string, string> = {
  AI_GATEWAY_MODEL_NOT_PUBLISHED: '该模型尚未发布到工作台，请在供应商中心发布后再使用。',
  AI_GATEWAY_MODEL_ADAPTER_PENDING: '该模型已在目录中，但后端通道尚未接通，暂时不能生成。',
  AI_GATEWAY_MODEL_ROUTE_NOT_FOUND: '该模型没有可用的 AI Gateway 执行通道。',
  AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE: '该供应商没有可用平台 Key，请先在供应商中心配置并启用 Key。',
  AI_GATEWAY_PROVIDER_KEY_MISSING: '该供应商没有可用平台 Key，请先在供应商中心配置并启用 Key。',
  AI_GATEWAY_MODEL_PAUSED: '该模型已被运营暂停，请稍后再试或切换模型。',
  AI_GATEWAY_NO_PROVIDER_ROUTE: '当前能力没有可用供应商通道。',
};

function responseErrorCode(data: Record<string, unknown> & { error?: string; code?: string }): string | undefined {
  if (typeof data.code === 'string' && data.code.trim()) return data.code.trim();
  if (typeof data.error === 'string' && /^[A-Z0-9_]+$/.test(data.error.trim())) return data.error.trim();
  return undefined;
}

function responseErrorMessage(
  data: Record<string, unknown> & { error?: string; code?: string; message?: string },
  code?: string
): string {
  if (code && AI_GATEWAY_ERROR_MESSAGES[code]) return AI_GATEWAY_ERROR_MESSAGES[code];
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data.error === 'string' && data.error.trim() && data.error.trim() !== code) return data.error.trim();
  return '请求失败';
}

function getCookie(name: string) {
  if (typeof document === 'undefined') return '';
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const raw of cookies) {
    const [k, ...rest] = raw.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) };
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = getCookie('ac_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as Record<string, unknown> & { error?: string; code?: string; message?: string };
    const code = responseErrorCode(d);
    throw new HttpRequestError(
      responseErrorMessage(d, code),
      res.status,
      code,
      d
    );
  }
  return data as T;
}
