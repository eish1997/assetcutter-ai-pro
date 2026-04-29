import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';

import type { DialogMessage, DialogSession, DialogTempItem } from '../types';
import { dialogVersionsForMessage } from '../services/dialogImageHelpers';
import { triggerImageDownload } from '../services/imageDataUrl';
import { loadDialogWorkspaceState, saveDialogWorkspaceState } from '../services/dialogSessionStore';
import { hydrateDialogSessionsWithR2, mergeHydratedDialogSessions } from '../services/dialogR2Image';

function createDialogSession(): DialogSession {
  const now = Date.now();
  return {
    id: Math.random().toString(36).slice(2, 11),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 持久化/合并后可能缺 updatedAt 或为 NaN，会导致 UI 按 24h 分组时两边都进不去 */
function normalizeDialogSession(s: DialogSession): DialogSession {
  const now = Date.now();
  const createdAt = typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : now;
  let updatedAt = typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : createdAt;
  if (updatedAt < createdAt) updatedAt = createdAt;
  return { ...s, createdAt, updatedAt };
}

const SAVE_DEBOUNCE_MS = 450;

/**
 * @param persistUserId 已登录用户 id；未登录传 null（与访客 localStorage 键隔离）
 */
export function useDialogWorkspace(persistUserId: string | null = null) {
  const [dialogSessions, setDialogSessions] = useState<DialogSession[]>(() => [createDialogSession()]);
  const [dialogActiveSessionId, setDialogActiveSessionId] = useState<string>('');
  const [dialogTempLibrary, setDialogTempLibrary] = useState<DialogTempItem[]>([]);
  const [dialogTempLibraryFilter, setDialogTempLibraryFilter] = useState<'all' | 'current'>('all');
  /** 默认展开「更早」，避免会话全落在该区时看起来像「没有会话」 */
  const [dialogOlderCollapsed, setDialogOlderCollapsed] = useState(false);
  const [dialogArchivedCollapsed, setDialogArchivedCollapsed] = useState(true);
  const [dialogTempPreviewId, setDialogTempPreviewId] = useState<string | null>(null);
  const [dialogTempSelectedIds, setDialogTempSelectedIds] = useState<Set<string>>(new Set());

  const storageKeyRef = useRef<string | null | undefined>(undefined);
  const hydratedRef = useRef(false);
  const sessionsRef = useRef(dialogSessions);
  const activeIdRef = useRef(dialogActiveSessionId);
  const tempLibRef = useRef(dialogTempLibrary);
  useEffect(() => {
    sessionsRef.current = dialogSessions;
    activeIdRef.current = dialogActiveSessionId;
    tempLibRef.current = dialogTempLibrary;
  }, [dialogSessions, dialogActiveSessionId, dialogTempLibrary]);

  const dialogActiveSessionIdResolved = dialogActiveSessionId || dialogSessions[0]?.id || '';
  const activeSession = useMemo(
    () => dialogSessions.find((session) => session.id === dialogActiveSessionIdResolved),
    [dialogActiveSessionIdResolved, dialogSessions]
  );
  const dialogMessages = activeSession?.messages ?? [];

  const setDialogMessages = useCallback((updater: SetStateAction<DialogMessage[]>) => {
    setDialogSessions((prev) =>
      prev.map((session) =>
        session.id !== dialogActiveSessionIdResolved
          ? session
          : {
              ...session,
              messages: typeof updater === 'function' ? updater(session.messages) : updater,
              updatedAt: Date.now(),
            }
      )
    );
  }, [dialogActiveSessionIdResolved]);

  const addToDialogTempLibrary = useCallback((item: Omit<DialogTempItem, 'id' | 'timestamp'>) => {
    setDialogTempLibrary((prev) => [...prev, { ...item, id: Math.random().toString(36).slice(2, 11), timestamp: Date.now() }]);
  }, []);

  const dialogTempFiltered = useMemo(() => {
    const filtered =
      dialogTempLibraryFilter === 'current'
        ? dialogTempLibrary.filter((item) => item.sourceSessionId === dialogActiveSessionIdResolved)
        : dialogTempLibrary;
    return [...filtered].sort((a, b) => b.timestamp - a.timestamp);
  }, [dialogActiveSessionIdResolved, dialogTempLibrary, dialogTempLibraryFilter]);

  const createNewDialogSession = useCallback(() => {
    const session = createDialogSession();
    setDialogSessions((prev) => [...prev, session]);
    setDialogActiveSessionId(session.id);
    return session.id;
  }, []);

  const updateDialogSession = useCallback((sessionId: string, updater: (session: DialogSession) => DialogSession) => {
    setDialogSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(session) : session)));
  }, []);

  const archiveDialogSession = useCallback(
    (sessionId: string) => {
      updateDialogSession(sessionId, (session) => ({ ...session, archived: true }));
    },
    [updateDialogSession]
  );

  const removeDialogSession = useCallback(
    (sessionId: string) => {
      setDialogSessions((prev) => {
        const next = prev.filter((session) => session.id !== sessionId);
        return next.length ? next : [createDialogSession()];
      });
      setDialogTempLibrary((prev) => prev.filter((item) => item.sourceSessionId !== sessionId));
      setDialogTempSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of dialogTempLibrary) {
          if (item.sourceSessionId === sessionId) next.delete(item.id);
        }
        return next;
      });
      setDialogTempPreviewId((prev) => {
        const item = dialogTempLibrary.find((entry) => entry.id === prev);
        return item?.sourceSessionId === sessionId ? null : prev;
      });
      if (sessionId === dialogActiveSessionIdResolved) {
        setDialogActiveSessionId('');
      }
    },
    [dialogActiveSessionIdResolved, dialogTempLibrary]
  );

  const handleDialogTempToggleSelect = useCallback((id: string) => {
    setDialogTempSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDialogTempSelectAll = useCallback(() => {
    setDialogTempSelectedIds(new Set(dialogTempFiltered.map((item) => item.id)));
  }, [dialogTempFiltered]);

  const handleDialogTempInvertSelect = useCallback(() => {
    setDialogTempSelectedIds(new Set(dialogTempFiltered.filter((item) => !dialogTempSelectedIds.has(item.id)).map((item) => item.id)));
  }, [dialogTempFiltered, dialogTempSelectedIds]);

  const handleDialogTempBatchDownload = useCallback(async () => {
    const list = dialogTempFiltered.filter((item) => dialogTempSelectedIds.has(item.id));
    for (let i = 0; i < list.length; i++) {
      await triggerImageDownload(list[i].data, `临时库_${list[i].label || list[i].id}`);
      if (i < list.length - 1) await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }, [dialogTempFiltered, dialogTempSelectedIds]);

  /** 活动会话 id 必须在列表中；否则 activeSession 为空 → 对话区无消息、发送也写不进任何会话 */
  useEffect(() => {
    if (dialogSessions.length === 0) return;
    const firstId = dialogSessions[0].id;
    if (!dialogActiveSessionId) {
      setDialogActiveSessionId(firstId);
      return;
    }
    if (!dialogSessions.some((s) => s.id === dialogActiveSessionId)) {
      setDialogActiveSessionId(firstId);
    }
  }, [dialogSessions, dialogActiveSessionId]);

  /** 切换账号时：先落盘旧键，再载入新键 */
  useEffect(() => {
    const prevKey = storageKeyRef.current;
    if (prevKey === persistUserId && hydratedRef.current) return;

    if (hydratedRef.current && prevKey !== persistUserId) {
      saveDialogWorkspaceState(prevKey ?? null, {
        version: 1,
        sessions: sessionsRef.current,
        activeSessionId: activeIdRef.current,
        tempLibrary: tempLibRef.current,
      });
    }

    const loaded = loadDialogWorkspaceState(persistUserId);
    if (loaded?.sessions?.length) {
      setDialogSessions(loaded.sessions.map(normalizeDialogSession));
      setDialogActiveSessionId(loaded.activeSessionId || loaded.sessions[0]?.id || '');
      setDialogTempLibrary(loaded.tempLibrary || []);
    } else {
      setDialogSessions([createDialogSession()]);
      setDialogActiveSessionId('');
      setDialogTempLibrary([]);
    }
    storageKeyRef.current = persistUserId;
    hydratedRef.current = true;
  }, [persistUserId]);

  /** 登录用户：将仅存 R2 key 的版本拉取为 data URL。依赖 persistUserId；setTimeout(0) 让「从 localStorage 载入会话」先落盘到 state，再读 ref。合并结果避免覆盖刚发的消息。 */
  useEffect(() => {
    if (!persistUserId || !hydratedRef.current) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      let needs = false;
      for (const s of sessionsRef.current) {
        for (const m of s.messages) {
          if (m.role !== 'assistant') continue;
          for (const v of dialogVersionsForMessage(m)) {
            if (v.resultImageObjectKey && !v.resultImageBase64) {
              needs = true;
              break;
            }
          }
          if (needs) break;
        }
        if (needs) break;
      }
      if (!needs) return;
      void (async () => {
        const snap = sessionsRef.current;
        const hydrated = await hydrateDialogSessionsWithR2(snap);
        if (cancelled) return;
        setDialogSessions((prev) => mergeHydratedDialogSessions(prev, hydrated).map(normalizeDialogSession));
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [persistUserId]);

  /** 会话 / 临时库变更时防抖写入 */
  useEffect(() => {
    if (!hydratedRef.current) return;
    const key = storageKeyRef.current;
    const t = window.setTimeout(() => {
      saveDialogWorkspaceState(key ?? null, {
        version: 1,
        sessions: sessionsRef.current,
        activeSessionId: activeIdRef.current,
        tempLibrary: tempLibRef.current,
      });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [dialogSessions, dialogActiveSessionId, dialogTempLibrary, persistUserId]);

  /** 页面卸载时尽力同步 */
  useEffect(() => {
    const onBeforeUnload = () => {
      saveDialogWorkspaceState(storageKeyRef.current ?? null, {
        version: 1,
        sessions: sessionsRef.current,
        activeSessionId: activeIdRef.current,
        tempLibrary: tempLibRef.current,
      });
    };
    window.addEventListener('pagehide', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', onBeforeUnload);
      onBeforeUnload();
    };
  }, []);

  return {
    dialogSessions,
    setDialogSessions,
    dialogActiveSessionId,
    setDialogActiveSessionId,
    dialogActiveSessionIdResolved,
    activeSession,
    dialogMessages,
    setDialogMessages,
    dialogTempLibrary,
    setDialogTempLibrary,
    dialogTempLibraryFilter,
    setDialogTempLibraryFilter,
    dialogOlderCollapsed,
    setDialogOlderCollapsed,
    dialogArchivedCollapsed,
    setDialogArchivedCollapsed,
    dialogTempPreviewId,
    setDialogTempPreviewId,
    dialogTempSelectedIds,
    setDialogTempSelectedIds,
    dialogTempFiltered,
    addToDialogTempLibrary,
    createNewDialogSession,
    updateDialogSession,
    archiveDialogSession,
    removeDialogSession,
    handleDialogTempToggleSelect,
    handleDialogTempSelectAll,
    handleDialogTempInvertSelect,
    handleDialogTempBatchDownload,
  };
}
