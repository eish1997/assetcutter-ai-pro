import type { DialogSession } from '../types';
import { r2ApiUrl } from './apiBase';
import { dialogVersionsForMessage } from './dialogImageHelpers';
import { requestJson } from './httpClient';
import { parseDataUrlToBytes } from './workspaceR2ImageBundle';

type DownloadUrlResponse = { downloadUrl: string; objectKey: string };

function sanitizeUserPathSegment(s: string): string {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function userStorageDirName(userId: string, username?: string | null): string {
  const uid = String(userId || '').trim();
  const name = sanitizeUserPathSegment(username || '');
  return name ? `${name}-${uid}` : uid;
}

function pathSeg(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'x';
}

function mimeToExt(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return 'jpg';
}

async function putBinaryToPresignedUrl(uploadUrl: string, contentType: string, body: ArrayBuffer): Promise<void> {
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!put.ok) throw new Error(`R2 PUT 失败（${put.status}）`);
}

export function buildDialogResultImageObjectKey(
  userId: string,
  username: string | null | undefined,
  sessionId: string,
  messageId: string,
  versionIndex: number,
  mime: string
): string {
  const ext = mimeToExt(mime);
  return `users/${userStorageDirName(userId, username)}/dialogs/${pathSeg(sessionId)}/${pathSeg(messageId)}/v${versionIndex}.${ext}`;
}

export async function downloadR2ObjectAsDataUrl(objectKey: string): Promise<string> {
  const { downloadUrl } = await requestJson<DownloadUrlResponse>(r2ApiUrl('/download-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, expiresIn: 600 }),
  });
  const r = await fetch(downloadUrl);
  if (!r.ok) throw new Error(`R2 GET 失败（${r.status}）`);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

async function mapLimit<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) break;
        out[i] = await mapper(items[i]!);
      }
    })
  );
  return out;
}

/**
 * 登录且云同步可用时：将对话生图上传至用户命名空间下 dialogs/，返回 object key。
 */
export async function uploadDialogResultImageToR2(
  userId: string,
  username: string | null | undefined,
  sessionId: string,
  messageId: string,
  versionIndex: number,
  dataUrl: string
): Promise<string | null> {
  const parsed = parseDataUrlToBytes(dataUrl);
  if (!parsed) return null;
  const objectKey = buildDialogResultImageObjectKey(userId, username, sessionId, messageId, versionIndex, parsed.mime);
  const { uploadUrl } = await requestJson<{ uploadUrl: string }>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({
      objectKey,
      contentType: parsed.mime,
      contentLength: parsed.buffer.byteLength,
      expiresIn: 900,
    }),
  });
  await putBinaryToPresignedUrl(uploadUrl, parsed.mime, parsed.buffer);
  await requestJson<{ ok?: boolean }>(r2ApiUrl('/register-upload'), {
    method: 'POST',
    body: JSON.stringify({ objectKey }),
  });
  return objectKey;
}

/**
 * 为仅含 resultImageObjectKey 的版本拉取像素数据，写入 resultImageBase64。
 */
export async function hydrateDialogSessionsWithR2(sessions: DialogSession[]): Promise<DialogSession[]> {
  const keys = new Set<string>();
  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role !== 'assistant') continue;
      for (const v of dialogVersionsForMessage(m)) {
        if (v.resultImageObjectKey && !v.resultImageBase64) keys.add(v.resultImageObjectKey);
      }
    }
  }
  if (keys.size === 0) return sessions;

  const list = [...keys];
  const dataUrls = await mapLimit(list, 4, async (key) => {
    try {
      return { key, dataUrl: await downloadR2ObjectAsDataUrl(key) };
    } catch (e) {
      console.warn('[dialog] R2 hydrate 失败', key, e);
      return { key, dataUrl: null as string | null };
    }
  });
  const map = new Map<string, string>();
  for (const { key, dataUrl } of dataUrls) {
    if (dataUrl) map.set(key, dataUrl);
  }

  return sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.role !== 'assistant') return message;
      const versions = dialogVersionsForMessage(message);
      if (versions.length === 0) return message;
      const nextVersions = versions.map((v) => {
        if (!v.resultImageObjectKey || v.resultImageBase64) return v;
        const data = map.get(v.resultImageObjectKey);
        if (!data) return v;
        return { ...v, resultImageBase64: data };
      });
      if (message.versions && message.versions.length > 0) {
        return { ...message, versions: nextVersions };
      }
      const last = nextVersions[nextVersions.length - 1];
      return {
        ...message,
        resultImageBase64: last?.resultImageBase64 ?? message.resultImageBase64,
        resultImageObjectKey: last?.resultImageObjectKey ?? message.resultImageObjectKey,
        understoodPrompt: last?.understoodPrompt ?? message.understoodPrompt,
      };
    }),
  }));
}

/**
 * hydrate 异步完成时以当前 prev 为准，只把 hydrated 里已拉到的 base64 合并进去，避免覆盖用户刚发的消息。
 */
export function mergeHydratedDialogSessions(prev: DialogSession[], hydrated: DialogSession[]): DialogSession[] {
  const byId = new Map(hydrated.map((s) => [s.id, s]));
  return prev.map((session) => {
    const hs = byId.get(session.id);
    if (!hs) return session;
    return {
      ...session,
      messages: session.messages.map((msg) => {
        if (msg.role !== 'assistant') return msg;
        const hm = hs.messages.find((m) => m.id === msg.id);
        if (!hm) return msg;
        if (msg.versions?.length) {
          return {
            ...msg,
            versions: msg.versions.map((v, vi) => {
              if (v.resultImageBase64) return v;
              const cand = hm.versions?.[vi];
              if (cand?.resultImageObjectKey === v.resultImageObjectKey && cand.resultImageBase64) {
                return { ...v, resultImageBase64: cand.resultImageBase64 };
              }
              const byKey = hm.versions?.find((x) => x.resultImageObjectKey === v.resultImageObjectKey);
              if (byKey?.resultImageBase64) return { ...v, resultImageBase64: byKey.resultImageBase64 };
              return v;
            }),
          };
        }
        const v0 = dialogVersionsForMessage(msg)[0];
        const hv0 = dialogVersionsForMessage(hm)[0];
        if (v0?.resultImageObjectKey && !v0.resultImageBase64 && hv0?.resultImageBase64) {
          return { ...msg, resultImageBase64: hv0.resultImageBase64 };
        }
        return msg;
      }),
    };
  });
}
