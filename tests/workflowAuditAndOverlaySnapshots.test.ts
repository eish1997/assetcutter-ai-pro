import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSessionJson, removeLocalKey, scopedStorageKey } from '../services/clientPersist';
import {
  appendWorkflowAuditEvent,
  appendWorkflowRunTaskFailureAudit,
  hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty,
  readWorkflowAuditRing,
  WORKFLOW_AUDIT_CODES,
  WORKFLOW_AUDIT_SESSION_KEY,
  WORKFLOW_AUDIT_LOCAL_BASE_KEY,
  WORKFLOW_AUDIT_IDB_BUNDLE_BASE,
} from '../services/workflowAuditEvents';
import { setWorkflowMirrorPreferenceScope } from '../services/workflowMirrorPreferenceScope';
import {
  appendWorkflowOverlayCloseSnapshot,
  hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty,
  readWorkflowOverlaySnapshotRing,
  supersedeWorkflowOverlaySnapshotsForAsset,
  WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY,
  WORKFLOW_OVERLAY_LOCAL_BASE_KEY,
  WORKFLOW_OVERLAY_IDB_BUNDLE_BASE,
} from '../services/workflowOverlaySnapshots';
import { idbDeleteBundle, idbSaveBundleJson } from '../services/workspaceBundleIdb';
import type { ImageOverlayAnnotationDoc, WorkflowPendingTask } from '../types';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  setWorkflowMirrorPreferenceScope(null);
});

afterEach(async () => {
  writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events: [] });
  removeLocalKey(scopedStorageKey(WORKFLOW_AUDIT_LOCAL_BASE_KEY, null));
  writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries: [] });
  removeLocalKey(scopedStorageKey(WORKFLOW_OVERLAY_LOCAL_BASE_KEY, null));
  await idbDeleteBundle(scopedStorageKey(WORKFLOW_OVERLAY_IDB_BUNDLE_BASE, null));
  await idbDeleteBundle(scopedStorageKey(WORKFLOW_AUDIT_IDB_BUNDLE_BASE, null));
});

describe('workflowAuditEvents', () => {
  it('appends and reads warn discard blocked', () => {
    appendWorkflowAuditEvent({
      level: 'warn',
      code: WORKFLOW_AUDIT_CODES.DISCARD_BLOCKED_VGP,
      assetId: 'a1',
      displayKey: 'foo__v__x',
      message: 'blocked',
    });
    const ring = readWorkflowAuditRing();
    expect(ring).toHaveLength(1);
    expect(ring[0]!.code).toBe(WORKFLOW_AUDIT_CODES.DISCARD_BLOCKED_VGP);
    expect(ring[0]!.assetId).toBe('a1');
  });

  it('appendWorkflowRunTaskFailureAudit carries taskId', () => {
    const task: WorkflowPendingTask = {
      id: 'tid',
      assetId: 'aid',
      actionType: 'cap_x',
      inputImage: '',
      addedAt: 1,
      inputSourceDisplayKey: 'original',
    };
    appendWorkflowRunTaskFailureAudit({
      task,
      code: WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_REJECTED,
      level: 'warn',
      message: 'rej',
    });
    const e = readWorkflowAuditRing()[0]!;
    expect(e.taskId).toBe('tid');
    expect(e.code).toBe(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_REJECTED);
    expect(e.detail?.actionType).toBe('cap_x');
    expect(e.detail?.retryable).toBe(true);
    expect(e.detail?.retrySnapshot).toMatchObject({
      v: 1,
      assetId: 'aid',
      actionType: 'cap_x',
      sourceTaskId: 'tid',
    });
  });

  it('records EXPORT_IMAGE info audit', () => {
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
      assetId: 'a1',
      displayKey: 'original',
      message: 'dl',
      detail: { context: 'test' },
    });
    expect(readWorkflowAuditRing()[0]!.code).toBe(WORKFLOW_AUDIT_CODES.EXPORT_IMAGE);
  });

  it('records LIGHTBOX_OVERLAY_RESTORE_FROM_RING', () => {
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.LIGHTBOX_OVERLAY_RESTORE_FROM_RING,
      assetId: 'a1',
      displayKey: 'original',
      message: 'restore',
      detail: { context: 'workflow_lightbox', bucket: 'flat' },
    });
    expect(readWorkflowAuditRing()[0]!.code).toBe(WORKFLOW_AUDIT_CODES.LIGHTBOX_OVERLAY_RESTORE_FROM_RING);
  });

  it('readWorkflowAuditRing merges from local when session cleared', () => {
    appendWorkflowAuditEvent({
      level: 'warn',
      code: WORKFLOW_AUDIT_CODES.DISCARD_BLOCKED_VGP,
      assetId: 'a1',
      displayKey: 'foo',
      message: 'x',
    });
    writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events: [] });
    const ring = readWorkflowAuditRing();
    expect(ring).toHaveLength(1);
    expect(ring[0]!.code).toBe(WORKFLOW_AUDIT_CODES.DISCARD_BLOCKED_VGP);
  });

  it('scoped local mirror merges after session cleared', () => {
    setWorkflowMirrorPreferenceScope('u_scope_test');
    try {
      appendWorkflowAuditEvent({
        level: 'info',
        code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
        assetId: 'a1',
        displayKey: 'original',
        message: 'scoped',
      });
      writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events: [] });
      expect(readWorkflowAuditRing()).toHaveLength(1);
    } finally {
      removeLocalKey(scopedStorageKey(WORKFLOW_AUDIT_LOCAL_BASE_KEY, 'u_scope_test'));
      setWorkflowMirrorPreferenceScope(null);
    }
  });

  it('hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty restores session from IndexedDB', async () => {
    const key = scopedStorageKey(WORKFLOW_AUDIT_IDB_BUNDLE_BASE, null);
    await idbSaveBundleJson(
      key,
      JSON.stringify({
        events: [
          {
            id: 'wa_idb1',
            ts: 1,
            level: 'info' as const,
            code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
            assetId: 'a1',
            displayKey: 'original',
            message: 'from idb',
          },
        ],
      })
    );
    writeSessionJson(WORKFLOW_AUDIT_SESSION_KEY, { events: [] });
    expect(await hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty()).toBe(true);
    expect(readWorkflowAuditRing()).toHaveLength(1);
    expect(readWorkflowAuditRing()[0]!.id).toBe('wa_idb1');
  });

  it('hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty is no-op when session has events', async () => {
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
      assetId: 'a1',
      displayKey: 'original',
      message: 'x',
    });
    expect(await hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty()).toBe(false);
  });
});

describe('workflowOverlaySnapshots', () => {
  it('stores close snapshot when doc small', () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    const e = appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'original',
      bucket: 'flat',
      doc,
    });
    expect(e).not.toBeNull();
    expect(readWorkflowOverlaySnapshotRing()).toHaveLength(1);
  });

  it('returns null when doc JSON exceeds cap', () => {
    const huge = 'x'.repeat(300_000);
    const doc = {
      v: 1 as const,
      items: [{ id: 's1', type: 'brush' as const, points: [], color: '#fff', width: 1, huge }],
      crops: [],
    } as unknown as ImageOverlayAnnotationDoc;
    const e = appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'k1',
      bucket: 'flat',
      doc,
    });
    expect(e).toBeNull();
    expect(readWorkflowOverlaySnapshotRing()).toHaveLength(0);
  });

  it('marks active entries superseded for asset+key', () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'k1',
      bucket: 'flat',
      doc,
    });
    expect(readWorkflowOverlaySnapshotRing()[0]!.status).toBe('active');
    supersedeWorkflowOverlaySnapshotsForAsset('a1', 'k1');
    expect(readWorkflowOverlaySnapshotRing()[0]!.status).toBe('superseded');
  });

  it('supersede without displayKey marks all for asset', () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    appendWorkflowOverlayCloseSnapshot({ assetId: 'a2', baseDisplayKey: 'k1', bucket: 'flat', doc });
    appendWorkflowOverlayCloseSnapshot({ assetId: 'a2', baseDisplayKey: 'k2', bucket: 'pano', doc });
    supersedeWorkflowOverlaySnapshotsForAsset('a2');
    const ring = readWorkflowOverlaySnapshotRing();
    expect(ring.every((e) => e.assetId !== 'a2' || e.status === 'superseded')).toBe(true);
  });

  it('coalesces periodic snapshots for same asset triple', () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'k1',
      bucket: 'flat',
      doc,
      reason: 'periodic',
    });
    appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'k1',
      bucket: 'flat',
      doc: {
        v: 1,
        items: [{ id: 'x', kind: 'brush' as const, points: [], stroke: '#000', sw: 1 }],
        crops: [],
      },
      reason: 'periodic',
    });
    const ring = readWorkflowOverlaySnapshotRing();
    expect(ring.filter((e) => e.status === 'active')).toHaveLength(1);
    expect(ring.filter((e) => e.status === 'superseded')).toHaveLength(1);
    expect(ring[ring.length - 1]!.reason).toBe('periodic');
  });

  it('close snapshot supersedes active periodic for same triple', () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'k1',
      bucket: 'flat',
      doc,
      reason: 'periodic',
    });
    appendWorkflowOverlayCloseSnapshot({ assetId: 'a1', baseDisplayKey: 'k1', bucket: 'flat', doc, reason: 'close' });
    const ring = readWorkflowOverlaySnapshotRing();
    expect(ring.find((e) => e.reason === 'periodic')?.status).toBe('superseded');
    expect(ring.find((e) => (e.reason ?? 'close') === 'close' && e.status === 'active')).toBeTruthy();
  });

  it('readWorkflowOverlaySnapshotRing merges from local when session cleared', () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    appendWorkflowOverlayCloseSnapshot({
      assetId: 'a1',
      baseDisplayKey: 'original',
      bucket: 'flat',
      doc,
    });
    writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries: [] });
    expect(readWorkflowOverlaySnapshotRing()).toHaveLength(1);
  });

  it('hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty restores session from IndexedDB', async () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    const key = scopedStorageKey(WORKFLOW_OVERLAY_IDB_BUNDLE_BASE, null);
    await idbSaveBundleJson(
      key,
      JSON.stringify({
        entries: [
          {
            id: 'os_idb1',
            createdAt: 1,
            assetId: 'a_idb',
            baseDisplayKey: 'original',
            bucket: 'flat',
            reason: 'close',
            status: 'active',
            doc,
            docBytes: JSON.stringify(doc).length,
          },
        ],
      })
    );
    writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries: [] });
    expect(await hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty()).toBe(true);
    expect(readWorkflowOverlaySnapshotRing()).toHaveLength(1);
    expect(readWorkflowOverlaySnapshotRing()[0]!.id).toBe('os_idb1');
  });

  it('hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty is no-op when session has entries', async () => {
    const doc: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };
    appendWorkflowOverlayCloseSnapshot({ assetId: 'a1', baseDisplayKey: 'k', bucket: 'flat', doc });
    expect(await hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty()).toBe(false);
  });
});
