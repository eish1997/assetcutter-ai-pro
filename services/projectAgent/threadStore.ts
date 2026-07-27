/**
 * Project Agent hot thread — one per userId + workspaceProjectId (P5 / P25 / §18).
 * Hot window 80. Migrates legacy quickCompose workspace keys when present.
 */

import type { QuickComposeThreadMessage } from '../../types/quickComposeThread';
import { readLocalJson, scopedStorageKey } from '../clientPersist';
import {
  loadQuickComposeThread,
  QUICK_COMPOSE_THREAD_MAX_MESSAGES,
  type QuickComposeThreadStoreKey,
} from '../quickComposeThreadStore';
import {
  saveProjectAgentThreadGuarded,
  type SaveProjectAgentThreadGuardedResult,
} from './persist/quotas';

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

function normalizePlanSteps(
  raw: unknown
): QuickComposeThreadMessage['planSteps'] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: NonNullable<QuickComposeThreadMessage['planSteps']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { label?: unknown; toolId?: unknown };
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) continue;
    const toolId = typeof row.toolId === 'string' ? row.toolId.trim() : undefined;
    out.push(toolId ? { label, toolId } : { label });
  }
  return out.length ? out : undefined;
}

const CHILD_RUN_STATUSES = new Set([
  'queued',
  'running',
  'done',
  'error',
  'cancelled',
]);

function normalizeChildRuns(
  raw: unknown
): QuickComposeThreadMessage['childRuns'] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: NonNullable<QuickComposeThreadMessage['childRuns']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const kind = row.kind === 'expert' || row.kind === 'tool' ? row.kind : null;
    const status =
      typeof row.status === 'string' && CHILD_RUN_STATUSES.has(row.status)
        ? (row.status as NonNullable<QuickComposeThreadMessage['childRuns']>[number]['status'])
        : null;
    const startedAt =
      typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) ? row.startedAt : null;
    if (!id || !label || !kind || !status || startedAt == null) continue;
    const run: NonNullable<QuickComposeThreadMessage['childRuns']>[number] = {
      id,
      kind,
      label,
      status,
      startedAt,
    };
    if (typeof row.expertId === 'string' && row.expertId.trim()) run.expertId = row.expertId.trim();
    if (typeof row.toolId === 'string' && row.toolId.trim()) run.toolId = row.toolId.trim();
    if (isStringArray(row.taskIds) && row.taskIds.some(Boolean)) {
      run.taskIds = row.taskIds.filter(Boolean);
    }
    if (isStringArray(row.artifactIds) && row.artifactIds.some(Boolean)) {
      run.artifactIds = row.artifactIds.filter(Boolean);
    }
    if (typeof row.errorMessage === 'string' && row.errorMessage.trim()) {
      run.errorMessage = row.errorMessage;
    }
    if (typeof row.endedAt === 'number' && Number.isFinite(row.endedAt)) {
      run.endedAt = row.endedAt;
    }
    out.push(run);
  }
  return out.length ? out : undefined;
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
  const resultText = typeof m.resultText === 'string' ? m.resultText : undefined;
  const planSteps = normalizePlanSteps(m.planSteps);
  const childRuns = normalizeChildRuns(m.childRuns);
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
    ...(resultText?.trim() ? { resultText: resultText.trim() } : {}),
    ...(planSteps?.length ? { planSteps } : {}),
    ...(childRuns?.length ? { childRuns } : {}),
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

export function saveProjectAgentThread(
  key: ProjectAgentThreadStoreKey,
  thread: ProjectAgentThread
): SaveProjectAgentThreadGuardedResult {
  const trimmed: ProjectAgentThread = {
    ...thread,
    messages: trimProjectAgentThreadMessages(thread.messages),
    updatedAt: Date.now(),
  };
  try {
    const result = saveProjectAgentThreadGuarded(key, trimmed);
    if (!result.ok) {
      console.warn('[projectAgent] thread persist quota exceeded after trim', {
        workspaceProjectId: key.workspaceProjectId,
      });
    }
    return result;
  } catch (e) {
    // Node / SSR: no localStorage — same soft skip as former writeLocalJson
    if (e instanceof Error && /localStorage unavailable/i.test(e.message)) {
      return { ok: true, thread: trimmed };
    }
    console.warn('[projectAgent] thread persist failed', e);
    return { ok: false, reason: 'quota' };
  }
}

export function loadOrCreateProjectAgentThread(key: ProjectAgentThreadStoreKey): ProjectAgentThread {
  return loadProjectAgentThread(key) ?? createProjectAgentThread(key);
}

/** 刷新/重开项目后：内存执行已断，持久化里的 in-flight 助手气泡会假「还在跑」。 */
export const PROJECT_AGENT_STALE_INTERRUPTED_MESSAGE =
  '页面已刷新或重新打开项目，进行中的回合已中断';

function isInFlightAssistantStatus(
  status: QuickComposeThreadMessage['status']
): boolean {
  return (
    status === 'submitted' ||
    status === 'queued' ||
    status === 'understanding' ||
    status === 'running'
  );
}

/**
 * 将热线程中僵尸 in-flight 助手消息收成 error，并结束其 childRuns。
 * 打开项目 / 云 hydrate 后调用并落盘，避免「助手处理中」假锁死。
 */
export function finalizeStaleInFlightProjectAgentThread(
  thread: ProjectAgentThread
): { thread: ProjectAgentThread; changed: boolean } {
  let changed = false;
  const now = Date.now();
  const messages = thread.messages.map((m) => {
    if (m.role !== 'assistant') return m;
    let next = m;
    if (isInFlightAssistantStatus(m.status)) {
      changed = true;
      next = {
        ...m,
        status: 'error',
        errorMessage: PROJECT_AGENT_STALE_INTERRUPTED_MESSAGE,
      };
    }
    const runs = next.childRuns;
    if (!runs?.length) return next;
    let runsChanged = false;
    const childRuns = runs.map((r) => {
      if (r.status !== 'queued' && r.status !== 'running') return r;
      runsChanged = true;
      return {
        ...r,
        status: 'cancelled' as const,
        errorMessage: PROJECT_AGENT_STALE_INTERRUPTED_MESSAGE,
        endedAt: r.endedAt ?? now,
      };
    });
    if (!runsChanged) return next;
    changed = true;
    return { ...next, childRuns };
  });
  if (!changed) return { thread, changed: false };
  return {
    thread: { ...thread, messages, updatedAt: now },
    changed: true,
  };
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
