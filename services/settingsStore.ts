/** 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此 */

const STORAGE_KEY = 'ac_gemini_api_key';

export function getUserApiKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setUserApiKey(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, value.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * 供 geminiService 使用：优先返回用户设置的密钥，否则返回环境变量（构建时注入）
 */
export function getApiKey(): string | undefined {
  const user = getUserApiKey();
  if (user) return user;
  return typeof process !== 'undefined' && process.env && process.env.API_KEY
    ? process.env.API_KEY
    : undefined;
}
