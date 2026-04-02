import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';

import type { DialogMessage, DialogSession, DialogTempItem } from '../types';
import { triggerImageDownload } from '../services/imageDataUrl';

function createDialogSession(): DialogSession {
  const now = Date.now();
  return {
    id: Math.random().toString(36).slice(2, 11),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function useDialogWorkspace() {
  const [dialogSessions, setDialogSessions] = useState<DialogSession[]>(() => [createDialogSession()]);
  const [dialogActiveSessionId, setDialogActiveSessionId] = useState<string>('');
  const [dialogTempLibrary, setDialogTempLibrary] = useState<DialogTempItem[]>([]);
  const [dialogTempLibraryFilter, setDialogTempLibraryFilter] = useState<'all' | 'current'>('all');
  const [dialogOlderCollapsed, setDialogOlderCollapsed] = useState(true);
  const [dialogArchivedCollapsed, setDialogArchivedCollapsed] = useState(true);
  const [dialogTempPreviewId, setDialogTempPreviewId] = useState<string | null>(null);
  const [dialogTempSelectedIds, setDialogTempSelectedIds] = useState<Set<string>>(new Set());

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

  const archiveDialogSession = useCallback((sessionId: string) => {
    updateDialogSession(sessionId, (session) => ({ ...session, archived: true }));
  }, [updateDialogSession]);

  const removeDialogSession = useCallback((sessionId: string) => {
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
  }, [dialogActiveSessionIdResolved, dialogTempLibrary]);

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

  useEffect(() => {
    if (!dialogActiveSessionId && dialogSessions.length > 0) {
      setDialogActiveSessionId(dialogSessions[0].id);
    }
  }, [dialogActiveSessionId, dialogSessions]);

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
