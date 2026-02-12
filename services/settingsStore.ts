/** 用户设置的 API 密钥存 localStorage，键名与读写逻辑集中在此 */

const STORAGE_KEY_GEMINI = 'ac_gemini_api_key';
const STORAGE_KEY_TENCENT_SECRET_ID = 'ac_tencent_secret_id';
const STORAGE_KEY_TENCENT_SECRET_KEY = 'ac_tencent_secret_key';

// ----- Gemini -----
export function getUserApiKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_GEMINI);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setUserApiKey(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_GEMINI);
    } else {
      localStorage.setItem(STORAGE_KEY_GEMINI, value.trim());
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

// ----- 混元（腾讯云） -----
export function getTencentSecretId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_TENCENT_SECRET_ID);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setTencentSecretId(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_TENCENT_SECRET_ID);
    } else {
      localStorage.setItem(STORAGE_KEY_TENCENT_SECRET_ID, value.trim());
    }
  } catch {
    // ignore
  }
}

export function getTencentSecretKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_TENCENT_SECRET_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setTencentSecretKey(value: string | null): void {
  try {
    if (value == null || !value.trim()) {
      localStorage.removeItem(STORAGE_KEY_TENCENT_SECRET_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY_TENCENT_SECRET_KEY, value.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * 供 tencentService 使用：优先返回用户设置的混元凭证，否则返回环境变量
 */
export function getTencentCreds(): { secretId: string; secretKey: string } {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const userSecretId = getTencentSecretId();
  const userSecretKey = getTencentSecretKey();
  const secretId = (userSecretId || (env.TENCENT_SECRET_ID as string) || '').trim();
  const secretKey = (userSecretKey || (env.TENCENT_SECRET_KEY as string) || '').trim();
  return { secretId, secretKey };
}
