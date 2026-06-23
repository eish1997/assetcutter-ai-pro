import type { WorkflowPendingTask } from '../types';
import { buildRetrySnapshotFromTask, isTaskRetryable } from './workflowTaskRetry';
import { readLocalJson, readSessionJson, scopedStorageKey, writeLocalJson, writeSessionJson } from './clientPersist';
import { getWorkflowMirrorPreferenceScope } from './workflowMirrorPreferenceScope';
import { idbLoadBundleJson, idbSaveBundleJson } from './workspaceBundleIdb';
import { syncWorkflowTaskEventToServer } from './workflowTaskEventsSync';

/** 与 `readWorkflowAuditRing` 同源；测试或排障后可清空 */
export const WORKFLOW_AUDIT_SESSION_KEY = 'ac_workflow_audit_ring_v1';
/**
 * 审计环 **localStorage** 镜像基键；实际键为 **`scopedStorageKey(WORKFLOW_AUDIT_LOCAL_BASE_KEY, preferenceScope)`**，
 * 与 **`preferenceScope`** 对齐（未登录等为 `__guest`）。**关标签后**仍可 `read` 合并；**换设备/清站点数据**仍失。
 */
export const WORKFLOW_AUDIT_LOCAL_BASE_KEY = 'ac_workflow_audit_ring_v1_local';
/**
 * 审计环 **IndexedDB** 镜像键基名（与 **`workspaceBundleIdb`**、Overlay 环 IDB 键空间隔离）。
 * 全量写入 `events` JSON；**local 写失败或配额紧张**时仍可在本机保留一份；新标签见 **`hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty`**。
 */
export const WORKFLOW_AUDIT_IDB_BUNDLE_BASE = 'ac_workflow_audit_ring_idb_v1';

const MAX_EVENTS = 200;

export type WorkflowAuditLevel = 'info' | 'warn' | 'error';

export type WorkflowAuditEvent = {
  id: string;
  ts: number;
  level: WorkflowAuditLevel;
  code: string;
  assetId?: string;
  taskId?: string;
  displayKey?: string;
  message: string;
  detail?: Record<string, unknown>;
};

type AuditRingFile = { events: WorkflowAuditEvent[] };

function workflowAuditLocalStorageKey(): string {
  return scopedStorageKey(WORKFLOW_AUDIT_LOCAL_BASE_KEY, getWorkflowMirrorPreferenceScope());
}

function auditRingIdbBundleKey(): string {
  return scopedStorageKey(WORKFLOW_AUDIT_IDB_BUNDLE_BASE, getWorkflowMirrorPreferenceScope());
}

function persistAuditRingToIdb(events: WorkflowAuditEvent[]): void {
  const key = auditRingIdbBundleKey();
  void idbSaveBundleJson(key, JSON.stringify({ events } as AuditRingFile)).catch(() => {});
}

export const WORKFLOW_AUDIT_CODES = {
  DISCARD_BLOCKED_VGP: 'DISCARD_BLOCKED_VGP',
  /** `runTask`：大图客户端合成 deferred 缺失 */
  RUN_TASK_LIGHTBOX_DEFERRED_MISSING: 'RUN_TASK_LIGHTBOX_DEFERRED_MISSING',
  RUN_TASK_LIGHTBOX_COMPOSITE_EMPTY: 'RUN_TASK_LIGHTBOX_COMPOSITE_EMPTY',
  RUN_TASK_LIGHTBOX_COMPOSITE_EXCEPTION: 'RUN_TASK_LIGHTBOX_COMPOSITE_EXCEPTION',
  RUN_TASK_INPUT_IMAGE_RESOLVE: 'RUN_TASK_INPUT_IMAGE_RESOLVE',
  RUN_TASK_CAPABILITY_SET_NOT_FOUND: 'RUN_TASK_CAPABILITY_SET_NOT_FOUND',
  RUN_TASK_CAPABILITY_SET_REJECTED: 'RUN_TASK_CAPABILITY_SET_REJECTED',
  RUN_TASK_CAPABILITY_SET_EXCEPTION: 'RUN_TASK_CAPABILITY_SET_EXCEPTION',
  RUN_TASK_MODULE_NOT_CONFIGURED: 'RUN_TASK_MODULE_NOT_CONFIGURED',
  RUN_TASK_GENERATE3D_NOT_CONFIGURED: 'RUN_TASK_GENERATE3D_NOT_CONFIGURED',
  RUN_TASK_GENERATE3D_NO_INPUT: 'RUN_TASK_GENERATE3D_NO_INPUT',
  RUN_TASK_GENERATE3D_EXCEPTION: 'RUN_TASK_GENERATE3D_EXCEPTION',
  RUN_TASK_PRESET_MODULE_MISSING: 'RUN_TASK_PRESET_MODULE_MISSING',
  RUN_TASK_CAPABILITY_REJECTED: 'RUN_TASK_CAPABILITY_REJECTED',
  RUN_TASK_CAPABILITY_EXCEPTION: 'RUN_TASK_CAPABILITY_EXCEPTION',
  RUN_TASK_FALLBACK_UNKNOWN: 'RUN_TASK_FALLBACK_UNKNOWN',
  RUN_TASK_BRANCH_CUT_NO_MODULE: 'RUN_TASK_BRANCH_CUT_NO_MODULE',
  /** 队列 processTask 外层异常 */
  RUN_TASK_PROCESS_EXCEPTION: 'RUN_TASK_PROCESS_EXCEPTION',
  /** `runTask` 开始执行（关联用量 audit_log_id） */
  RUN_TASK_EXECUTE: 'RUN_TASK_EXECUTE',
  /** 用户从运行日志触发重试 */
  RUN_TASK_RETRY: 'RUN_TASK_RETRY',
  /** 队列任务执行成功 */
  RUN_TASK_SUCCESS: 'RUN_TASK_SUCCESS',
  /** §6：用户从工作流大图下载当前预览图（按需审计） */
  EXPORT_IMAGE: 'EXPORT_IMAGE',
  /** 大图下载文字预览为 .txt */
  EXPORT_TEXT_PREVIEW: 'EXPORT_TEXT_PREVIEW',
  /** §10：关大图时用户选择不写回 overlay（与 flush 路径相对） */
  LIGHTBOX_OVERLAY_CLOSE_DISCARDED: 'LIGHTBOX_OVERLAY_CLOSE_DISCARDED',
  /** 用户从 session overlay 环将某时点 doc 加载回当前大图草稿 */
  LIGHTBOX_OVERLAY_RESTORE_FROM_RING: 'LIGHTBOX_OVERLAY_RESTORE_FROM_RING',
} as const;

function newId(): string {
  return `wa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readAuditSessionRaw(): AuditRingFile {
  return readSessionJson<AuditRingFile>(WORKFLOW_AUDIT_SESSION_KEY, { events: [] });
}

function readAuditLocalRaw(): AuditRingFile {
  return readLocalJson<AuditRingFile>(workflowAuditLocalStorageKey(), { events: [] });
}

function mergeAuditEventsById(a: WorkflowAuditEvent[], b: WorkflowAuditEvent[]): WorkflowAuditEvent[] {
  const byId = new Map<string, WorkflowAuditEvent>();
  for (const e of a) {
    if (e && typeof e.id === 'string') byId.set(e.id, e);
  }
  for (const e of b) {
    if (e && typeof e.id === 'string') byId.set(e.id, e);
  }
  return Array.from(byId.values())
    .sort((x, y) => x.ts - y.ts)
    .slice(-MAX_EVENTS);
}

function readMergedAuditEvents(): WorkflowAuditEvent[] {
  return mergeAuditEventsById(readAuditSessionRaw().events, readAuditLocalRaw().events);
}

/**
 * P2 骨架：结构化审计事件。
 * - **sessionStorage**（`WORKFLOW_AUDIT_SESSION_KEY`）：本标签页热读。
 * - **localStorage**（`scopedStorageKey(WORKFLOW_AUDIT_LOCAL_BASE_KEY, preferenceScope)`）：同浏览器 **关标签后**仍可合并读取；与 **`setWorkflowMirrorPreferenceScope`**（`WorkflowSection`）对齐。
 * `append` 后 **双写** session + local 同一条合并后的尾部窗口（`MAX_EVENTS`），并 **IndexedDB 全量镜像**（**`WORKFLOW_AUDIT_IDB_BUNDLE_BASE`**）。换设备 / 清站点数据仍失；上云见文档 §7.3。
 */
export function appendWorkflowAuditEvent(
  partial: Omit<WorkflowAuditEvent, 'id' | 'ts'> & { id?: string }
): WorkflowAuditEvent {
  const ev: WorkflowAuditEvent = {
    id: partial.id ?? newId(),
    ts: Date.now(),
    level: partial.level,
    code: partial.code,
    assetId: partial.assetId,
    taskId: partial.taskId,
    displayKey: partial.displayKey,
    message: partial.message,
    detail: partial.detail,
  };
  const merged = readMergedAuditEvents();
  const events = [...merged, ev].slice(-MAX_EVENTS);
  writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events });
  writeLocalJson(workflowAuditLocalStorageKey(), { events });
  persistAuditRingToIdb(events);
  syncWorkflowTaskEventToServer(ev);
  return ev;
}

/**
 * 新标签页 **session 审计环为空**时：优先从 **IndexedDB** 全量镜像恢复，其次从 **localStorage** 写入 session。
 * 与 **`hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty`** 对称；由 **`WorkflowSection`** 随 **`preferenceScope`** 挂载调用。
 */
export async function hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty(): Promise<boolean> {
  if (readAuditSessionRaw().events.length > 0) return false;
  try {
    const raw = await idbLoadBundleJson(auditRingIdbBundleKey());
    if (raw) {
      const file = JSON.parse(raw) as AuditRingFile;
      if (file.events?.length) {
        const events = file.events.slice(-MAX_EVENTS);
        writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events });
        writeLocalJson(workflowAuditLocalStorageKey(), { events });
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  const loc = readAuditLocalRaw();
  if (loc.events.length > 0) {
    writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events: loc.events.slice(-MAX_EVENTS) });
    return true;
  }
  return false;
}

export function readWorkflowAuditRing(): WorkflowAuditEvent[] {
  return readMergedAuditEvents();
}

const MAX_AUDIT_MESSAGE_LEN = 500;

/**
 * `runTask` / 队列执行失败统一入口：带 **`taskId`** / **`assetId`** / **`inputSourceDisplayKey`**，便于与 §6 映射对齐。
 */
export function appendWorkflowRunTaskFailureAudit(params: {
  task: WorkflowPendingTask;
  code: string;
  level: 'warn' | 'error';
  message: string;
  detail?: Record<string, unknown>;
}): WorkflowAuditEvent {
  const msg =
    params.message.length > MAX_AUDIT_MESSAGE_LEN
      ? `${params.message.slice(0, MAX_AUDIT_MESSAGE_LEN)}…`
      : params.message;
  const retryable = isTaskRetryable(params.task);
  const retrySnapshot = retryable ? buildRetrySnapshotFromTask(params.task) : null;
  return appendWorkflowAuditEvent({
    level: params.level,
    code: params.code,
    assetId: params.task.assetId,
    taskId: params.task.id,
    displayKey: params.task.inputSourceDisplayKey,
    message: msg,
    detail: {
      actionType: params.task.actionType,
      retryable: !!retrySnapshot,
      ...(retrySnapshot ? { retrySnapshot } : {}),
      ...params.detail,
    },
  });
}

/** 队列任务执行成功（与失败审计对称，便于管理端查看执行记录） */
export function appendWorkflowRunTaskSuccessAudit(params: {
  task: Pick<WorkflowPendingTask, 'id' | 'assetId' | 'actionType' | 'displayStepLabel' | 'inputSourceDisplayKey'>;
  detail?: Record<string, unknown>;
}): WorkflowAuditEvent {
  const label = params.task.displayStepLabel || params.task.actionType;
  return appendWorkflowAuditEvent({
    level: 'info',
    code: WORKFLOW_AUDIT_CODES.RUN_TASK_SUCCESS,
    assetId: params.task.assetId,
    taskId: params.task.id,
    displayKey: params.task.inputSourceDisplayKey,
    message: `[${label}] 执行完成`,
    detail: {
      actionType: params.task.actionType,
      ...params.detail,
    },
  });
}
