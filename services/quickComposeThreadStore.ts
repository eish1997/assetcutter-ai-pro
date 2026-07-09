/**
 * 底部快捷栏 Gemini 风格对话线程持久化。
 * 键：userId + workspaceProjectId + scope（lightbox 另加 lightboxSessionKey）。
 */

import type {
  QuickComposeThread,
  QuickComposeThreadMessage,
  QuickComposeThreadScope,
} from '../types/quickComposeThread';
import { readLocalJson, scopedStorageKey, writeLocalJson } from './clientPersist';

export const QUICK_COMPOSE_THREAD_STORE_VERSION = 1 as const;
export const QUICK_COMPOSE_THREAD_MAX_MESSAGES = 50;
const STORAGE_BASE = 'ac_quick_compose_thread_v1';

export type QuickComposeThreadStoreKey = {
  userId: string | null;
  workspaceProjectId: string;
  scope: QuickComposeThreadScope;
  /** scope=lightbox 时必填 */
  lightboxSessionKey?: string;
};

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function threadSubKey(
  workspaceProjectId: string,
  scope: QuickComposeThreadScope,
  lightboxSessionKey?: string
): string {
  const pid = String(workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  if (scope === 'lightbox') {
    const lb = String(lightboxSessionKey ?? '').trim();
    if (!lb) throw new Error('lightboxSessionKey is required for lightbox scope');
    return `p_${pid}__lightbox__${lb}`;
  }
  return `p_${pid}__workspace`;
}

export function quickComposeThreadStorageKey(input: QuickComposeThreadStoreKey): string {
  const scoped = scopedStorageKey(STORAGE_BASE, input.userId);
  return `${scoped}__${threadSubKey(input.workspaceProjectId, input.scope, input.lightboxSessionKey)}`;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((i) => typeof i === 'string');
}

function normalizeMessage(raw: unknown): QuickComposeThreadMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<QuickComposeThreadMessage>;
  const id = typeof m.id === 'string' ? m.id.trim() : '';
  const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
  if (!id || !role) return null;
  const text = typeof m.text === 'string' ? m.text : '';
  const timestamp = typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : Date.now();
  const status =
    m.status === 'submitted' ||
    m.status === 'queued' ||
    m.status === 'understanding' ||
    m.status === 'running' ||
    m.status === 'done' ||
    m.status === 'error'
      ? m.status
      : undefined;
  const assetIds = isStringArray(m.assetIds) ? m.assetIds.filter(Boolean) : undefined;
  const taskIds = isStringArray(m.taskIds) ? m.taskIds.filter(Boolean) : undefined;
  const taskAssetById =
    m.taskAssetById && typeof m.taskAssetById === 'object' && !Array.isArray(m.taskAssetById)
      ? Object.fromEntries(
          Object.entries(m.taskAssetById as Record<string, unknown>).filter(
            ([k, v]) => typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()
          )
        )
      : undefined;
  const errorMessage = typeof m.errorMessage === 'string' ? m.errorMessage : undefined;
  return {
    id,
    role,
    text,
    timestamp,
    ...(assetIds?.length ? { assetIds } : {}),
    ...(taskIds?.length ? { taskIds } : {}),
    ...(taskAssetById && Object.keys(taskAssetById).length ? { taskAssetById } : {}),
    ...(status ? { status } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function normalizeThread(parsed: unknown, key: QuickComposeThreadStoreKey): QuickComposeThread | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as Partial<QuickComposeThread> & { version?: number };
  if (data.version !== QUICK_COMPOSE_THREAD_STORE_VERSION) return null;
  const id = typeof data.id === 'string' ? data.id.trim() : '';
  const scope = data.scope === 'workspace' || data.scope === 'lightbox' ? data.scope : null;
  const workspaceProjectId = typeof data.workspaceProjectId === 'string' ? data.workspaceProjectId.trim() : '';
  if (!id || !scope || !workspaceProjectId) return null;
  if (scope === 'lightbox') {
    const lb = typeof data.lightboxSessionKey === 'string' ? data.lightboxSessionKey.trim() : '';
    if (!lb) return null;
  }
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages = rawMessages.map(normalizeMessage).filter((m): m is QuickComposeThreadMessage => m != null);
  const createdAt =
    typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : Date.now();
  const updatedAt =
    typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : createdAt;
  const lightboxSessionKey =
    scope === 'lightbox' && typeof data.lightboxSessionKey === 'string'
      ? data.lightboxSessionKey.trim()
      : undefined;
  return {
    id,
    scope,
    workspaceProjectId,
    messages: trimQuickComposeThreadMessages(messages),
    createdAt,
    updatedAt,
    ...(lightboxSessionKey ? { lightboxSessionKey } : {}),
  };
}

/** 保留时间序，截断至上限（丢弃最旧消息）。 */
export function trimQuickComposeThreadMessages(
  messages: QuickComposeThreadMessage[]
): QuickComposeThreadMessage[] {
  if (messages.length <= QUICK_COMPOSE_THREAD_MAX_MESSAGES) return [...messages];
  return messages.slice(-QUICK_COMPOSE_THREAD_MAX_MESSAGES);
}

export function createQuickComposeThread(key: QuickComposeThreadStoreKey): QuickComposeThread {
  const now = Date.now();
  const scope = key.scope;
  const workspaceProjectId = String(key.workspaceProjectId).trim();
  const lightboxSessionKey =
    scope === 'lightbox' ? String(key.lightboxSessionKey ?? '').trim() : undefined;
  return {
    id: genId(),
    scope,
    workspaceProjectId,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...(lightboxSessionKey ? { lightboxSessionKey } : {}),
  };
}

export function loadQuickComposeThread(key: QuickComposeThreadStoreKey): QuickComposeThread | null {
  const storageKey = quickComposeThreadStorageKey(key);
  const fallback = null as QuickComposeThread | null;
  return readLocalJson<QuickComposeThread | null>(
    storageKey,
    fallback,
    (parsed) => normalizeThread(parsed, key)
  );
}

export function saveQuickComposeThread(key: QuickComposeThreadStoreKey, thread: QuickComposeThread): void {
  const trimmed: QuickComposeThread = {
    ...thread,
    messages: trimQuickComposeThreadMessages(thread.messages),
    updatedAt: Date.now(),
  };
  const payload = {
    version: QUICK_COMPOSE_THREAD_STORE_VERSION,
    ...trimmed,
  };
  writeLocalJson(quickComposeThreadStorageKey(key), payload);
}

export type AppendQuickComposeThreadMessageInput = Omit<
  QuickComposeThreadMessage,
  'id' | 'timestamp'
> &
  Partial<Pick<QuickComposeThreadMessage, 'id' | 'timestamp'>>;

/** 追加一条消息；线程不存在时自动创建。 */
export function appendQuickComposeThreadMessage(
  key: QuickComposeThreadStoreKey,
  message: AppendQuickComposeThreadMessageInput
): QuickComposeThreadMessage {
  const existing = loadQuickComposeThread(key);
  const thread = existing ?? createQuickComposeThread(key);
  const full: QuickComposeThreadMessage = {
    ...message,
    id: message.id?.trim() || genId(),
    text: typeof message.text === 'string' ? message.text : '',
    timestamp:
      typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now(),
  };
  thread.messages = trimQuickComposeThreadMessages([...thread.messages, full]);
  thread.updatedAt = Date.now();
  saveQuickComposeThread(key, thread);
  return full;
}

export function updateQuickComposeThreadMessage(
  key: QuickComposeThreadStoreKey,
  messageId: string,
  patch: Partial<
      Pick<
      QuickComposeThreadMessage,
      'text' | 'status' | 'assetIds' | 'taskIds' | 'taskAssetById' | 'errorMessage'
    >
  >
): QuickComposeThread | null {
  const thread = loadQuickComposeThread(key);
  if (!thread) return null;
  const idx = thread.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return null;
  thread.messages[idx] = { ...thread.messages[idx], ...patch };
  saveQuickComposeThread(key, thread);
  return thread;
}
