/**
 * Project Agent hot thread — one per userId + workspaceProjectId (P5 / P25 / §18).
 * Hot window 80. Migrates legacy quickCompose workspace keys when present.
 */

import type { QuickComposeThreadMessage } from '../../types/quickComposeThread';
import { readLocalJson, scopedStorageKey, writeLocalJson } from '../clientPersist';
import {
  loadQuickComposeThread,
  QUICK_COMPOSE_THREAD_MAX_MESSAGES,
  type QuickComposeThreadStoreKey,
} from '../quickComposeThreadStore';

export const PROJECT_AGENT_THREAD_STORE_VERSION = 1 as const;
/** Spec §17.10 / §18 — local hot window. */
export const PROJECT_AGENT_THREAD_MAX_MESSAGES = 80;

const STORAGE_BASE = 'ac_project_agent_thread_v1';

export type ProjectAgentThreadStoreKey = {
  userId: string | null;
  workspaceProjectId: string;
};

export type ProjectAgentThread = {
  id: string;
  workspaceProjectId: string;
  messages: QuickComposeThreadMessage[];
  createdAt: number;
  updatedAt: number;
};

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function projectAgentThreadStorageKey(input: ProjectAgentThreadStoreKey): string {
  const pid = String(input.workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  const scoped = scopedStorageKey(STORAGE_BASE, input.userId);
  return `${scoped}__p_${pid}`;
}

export function trimProjectAgentThreadMessages(
  messages: QuickComposeThreadMessage[]
): QuickComposeThreadMessage[] {
  if (messages.length <= PROJECT_AGENT_THREAD_MAX_MESSAGES) return [...messages];
  return messages.slice(-PROJECT_AGENT_THREAD_MAX_MESSAGES);
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
  const timestamp =
    typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : Date.now();
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
      ? (Object.fromEntries(
          Object.entries(m.taskAssetById as Record<string, unknown>).filter(
            ([k, v]) => typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()
          )
        ) as Record<string, string>)
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

function normalizeThread(parsed: unknown, workspaceProjectId: string): ProjectAgentThread | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as Partial<ProjectAgentThread> & { version?: number };
  if (data.version !== PROJECT_AGENT_THREAD_STORE_VERSION) return null;
  const id = typeof data.id === 'string' ? data.id.trim() : '';
  const pid =
    typeof data.workspaceProjectId === 'string' ? data.workspaceProjectId.trim() : workspaceProjectId;
  if (!id || !pid) return null;
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages = rawMessages
    .map(normalizeMessage)
    .filter((m): m is QuickComposeThreadMessage => m != null);
  const createdAt =
    typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : Date.now();
  const updatedAt =
    typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : createdAt;
  return {
    id,
    workspaceProjectId: pid,
    messages: trimProjectAgentThreadMessages(messages),
    createdAt,
    updatedAt,
  };
}

export function createProjectAgentThread(key: ProjectAgentThreadStoreKey): ProjectAgentThread {
  const now = Date.now();
  return {
    id: genId(),
    workspaceProjectId: String(key.workspaceProjectId).trim(),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** One-shot migrate from legacy workspace quickCompose thread (not lightbox). */
function migrateFromLegacyWorkspace(key: ProjectAgentThreadStoreKey): ProjectAgentThread | null {
  const legacyKey: QuickComposeThreadStoreKey = {
    userId: key.userId,
    workspaceProjectId: key.workspaceProjectId,
    scope: 'workspace',
  };
  try {
    const legacy = loadQuickComposeThread(legacyKey);
    if (!legacy || !legacy.messages.length) return null;
    const migrated: ProjectAgentThread = {
      id: legacy.id || genId(),
      workspaceProjectId: String(key.workspaceProjectId).trim(),
      messages: trimProjectAgentThreadMessages(legacy.messages),
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    };
    saveProjectAgentThread(key, migrated);
    return migrated;
  } catch {
    return null;
  }
}

export function loadProjectAgentThread(key: ProjectAgentThreadStoreKey): ProjectAgentThread | null {
  const storageKey = projectAgentThreadStorageKey(key);
  const loaded = readLocalJson<ProjectAgentThread | null>(storageKey, null, (parsed) =>
    normalizeThread(parsed, String(key.workspaceProjectId).trim())
  );
  if (loaded) return loaded;
  return migrateFromLegacyWorkspace(key);
}

export function saveProjectAgentThread(key: ProjectAgentThreadStoreKey, thread: ProjectAgentThread): void {
  const trimmed: ProjectAgentThread = {
    ...thread,
    messages: trimProjectAgentThreadMessages(thread.messages),
    updatedAt: Date.now(),
  };
  writeLocalJson(projectAgentThreadStorageKey(key), {
    version: PROJECT_AGENT_THREAD_STORE_VERSION,
    ...trimmed,
  });
}

export function loadOrCreateProjectAgentThread(key: ProjectAgentThreadStoreKey): ProjectAgentThread {
  return loadProjectAgentThread(key) ?? createProjectAgentThread(key);
}

export type AppendProjectAgentMessageInput = Omit<QuickComposeThreadMessage, 'id' | 'timestamp'> &
  Partial<Pick<QuickComposeThreadMessage, 'id' | 'timestamp'>>;

export function appendProjectAgentThreadMessage(
  key: ProjectAgentThreadStoreKey,
  message: AppendProjectAgentMessageInput
): { thread: ProjectAgentThread; message: QuickComposeThreadMessage } {
  const thread = loadOrCreateProjectAgentThread(key);
  const full: QuickComposeThreadMessage = {
    ...message,
    id: message.id?.trim() || genId(),
    text: typeof message.text === 'string' ? message.text : '',
    timestamp:
      typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now(),
  };
  thread.messages = trimProjectAgentThreadMessages([...thread.messages, full]);
  thread.updatedAt = Date.now();
  saveProjectAgentThread(key, thread);
  return { thread, message: full };
}

export function appendProjectAgentThreadTurn(
  key: ProjectAgentThreadStoreKey,
  input: {
    userText: string;
    planText: string;
    taskIds: string[];
    assetIds?: string[];
    taskAssetById?: Record<string, string>;
    errorMessage?: string;
  }
): ProjectAgentThread {
  const trimmed = input.userText.trim();
  const thread = loadOrCreateProjectAgentThread(key);
  if (!trimmed) return thread;
  const now = Date.now();
  const normalizedAssetIds = input.assetIds?.map((id) => id.trim()).filter(Boolean);
  const userMessage: QuickComposeThreadMessage = {
    id: genId(),
    role: 'user',
    text: trimmed,
    timestamp: now,
    status: 'submitted',
    ...(normalizedAssetIds?.length ? { assetIds: normalizedAssetIds } : {}),
  };
  const taskIds = input.taskIds.filter((id) => id.trim());
  const normalizedTaskAssetById = input.taskAssetById
    ? Object.fromEntries(
        taskIds
          .map((id) => [id, input.taskAssetById![id]] as const)
          .filter(([, assetId]) => typeof assetId === 'string' && assetId.trim())
      )
    : undefined;
  const failed = Boolean(input.errorMessage) || taskIds.length === 0;
  const assistantMessage: QuickComposeThreadMessage = {
    id: genId(),
    role: 'assistant',
    text: input.planText,
    timestamp: now + 1,
    status: failed ? 'error' : 'queued',
    taskIds,
    ...(normalizedTaskAssetById && Object.keys(normalizedTaskAssetById).length
      ? { taskAssetById: normalizedTaskAssetById }
      : {}),
    ...(failed
      ? { errorMessage: input.errorMessage?.trim() || '未能创建任务' }
      : {}),
  };
  thread.messages = trimProjectAgentThreadMessages([
    ...thread.messages,
    userMessage,
    assistantMessage,
  ]);
  thread.updatedAt = Date.now();
  saveProjectAgentThread(key, thread);
  return thread;
}

/** Archive current hot thread (clear for P25) — returns archived snapshot; caller may cloud-backup later. */
export function archiveAndResetProjectAgentThread(key: ProjectAgentThreadStoreKey): {
  archived: ProjectAgentThread;
  next: ProjectAgentThread;
} {
  const current = loadOrCreateProjectAgentThread(key);
  const next = createProjectAgentThread(key);
  saveProjectAgentThread(key, next);
  return { archived: current, next };
}

/** @internal test helper — legacy max still exported from quickCompose for comparison */
export const _LEGACY_MAX_FOR_TEST = QUICK_COMPOSE_THREAD_MAX_MESSAGES;
