/**
 * 服务端 HTTP 请求体等限制统一入口，避免各服务写死 Magic Number。
 * 可通过环境变量覆盖（单位：字节）。
 */

export function envBytes(name, fallback) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Gemini 代理：整段 JSON（含 base64 图） */
export const GEMINI_PROXY_MAX_BODY_BYTES = envBytes('GEMINI_PROXY_MAX_BODY_BYTES', 25 * 1024 * 1024);

/**
 * Auth / R2 JSON API：登录、预签名、object-refs 等（大文件本体走 PUT 直传 R2，不经此限制）。
 * 默认 4MB：避免工作区索引、批量 key 列表等偶发超过旧版 1MB。
 */
export const API_JSON_BODY_MAX_BYTES = envBytes('API_JSON_BODY_MAX_BYTES', 4 * 1024 * 1024);

/**
 * 桥接 send-message（JSON 内含 base64 图片）：
 * 4MB 原图经 base64 + JSON 包装后会超过 4MB，单独放宽。
 */
export const BRIDGE_SEND_MESSAGE_MAX_BODY_BYTES = envBytes(
  'BRIDGE_SEND_MESSAGE_MAX_BODY_BYTES',
  16 * 1024 * 1024
);

/** 能力商店预览图等二进制校验 */
export const R2_CAPABILITY_PREVIEW_MAX_BYTES = envBytes('R2_CAPABILITY_PREVIEW_MAX_BYTES', 8 * 1024 * 1024);

/** 管理端 POST 发布能力包到 R2（JSON 内可含较大 preset） */
export const CAPABILITY_PUBLISH_ADMIN_BODY_BYTES = envBytes('CAPABILITY_PUBLISH_ADMIN_BODY_BYTES', 64 * 1024 * 1024);

/**
 * Tripo 图生 3D 上传代理：JSON 内含 base64 参考图，默认与桥接 send-message 同级放宽。
 */
export const TRIPO_UPLOAD_JSON_BODY_MAX_BYTES = envBytes(
  'TRIPO_UPLOAD_JSON_BODY_MAX_BYTES',
  16 * 1024 * 1024
);

export const BODY_TOO_LARGE_MESSAGE = 'Body too large';

export function isBodyTooLargeError(err) {
  return String((err && err.message) || err || '') === BODY_TOO_LARGE_MESSAGE;
}

/**
 * 读取 UTF-8 请求体，超过 maxBytes 时 reject(BODY_TOO_LARGE_MESSAGE)，不 destroy socket，便于返回 413。
 */
export function readBodyUtf8(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const onData = (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        req.off('data', onData);
        req.on('data', () => {});
        reject(new Error(BODY_TOO_LARGE_MESSAGE));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('error', (err) => {
      if (!done) reject(err);
    });
    req.on('end', () => {
      if (done) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
