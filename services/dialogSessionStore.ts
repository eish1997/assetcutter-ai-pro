import type { DialogSession, DialogTempItem } from '../types';

import { dialogVersionsForMessage } from './dialogImageHelpers';

const STORE_VERSION = 1 as const;
/** 单 key 上限（留余量给站点其它 localStorage） */
const DIALOG_STORE_MAX_BYTES = 3 * 1024 * 1024;

export type DialogWorkspacePersistPayload = {
  version: typeof STORE_VERSION;
  sessions: DialogSession[];
  activeSessionId: string;
  tempLibrary: DialogTempItem[];
};

export function dialogWorkspaceStorageKey(persistUserId: string | null): string {
  return persistUserId ? `ac_dialog_workspace_v1__u_${persistUserId}` : 'ac_dialog_workspace_v1';
}

function estimateBytes(text: string): number {
  try {
    return new Blob([text]).size;
  } catch {
    return text.length * 2;
  }
}

/** 已上传 R2 的版本：仅持久化 object key，不写 base64（减轻 localStorage） */
function stripDialogPayloadForPersist(payload: DialogWorkspacePersistPayload): DialogWorkspacePersistPayload {
  return {
    ...payload,
    sessions: payload.sessions.map((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.role !== 'assistant') return m;
        if (m.versions?.length) {
          return {
            ...m,
            versions: m.versions.map((v) => {
              if (!v.resultImageObjectKey) return v;
              const { resultImageBase64: _b, ...rest } = v;
              return rest;
            }),
          };
        }
        const vs = dialogVersionsForMessage(m);
        const last = vs[vs.length - 1];
        if (last?.resultImageObjectKey && m.resultImageBase64) {
          const { resultImageBase64: _b, ...rest } = m;
          return rest;
        }
        return m;
      }),
    })),
  };
}

/** 为塞进配额：压缩会话内大图（先裁临时库，再裁历史版本与归档会话） */
function lightenPayload(input: DialogWorkspacePersistPayload): DialogWorkspacePersistPayload {
  const stripped = stripDialogPayloadForPersist(input);
  let tempLibrary = [...stripped.tempLibrary].sort((a, b) => b.timestamp - a.timestamp).slice(0, 60);
  let sessions = stripped.sessions.map((s) => ({
    ...s,
    messages: s.messages.map((m) => ({ ...m })),
  }));

  const trySerialize = () =>
    JSON.stringify(
      stripDialogPayloadForPersist({
        version: STORE_VERSION,
        sessions,
        activeSessionId: stripped.activeSessionId,
        tempLibrary,
      })
    );

  let text = trySerialize();
  if (estimateBytes(text) <= DIALOG_STORE_MAX_BYTES) {
    return { version: STORE_VERSION, sessions, activeSessionId: stripped.activeSessionId, tempLibrary };
  }

  tempLibrary = tempLibrary.slice(0, 24);
  text = trySerialize();
  if (estimateBytes(text) <= DIALOG_STORE_MAX_BYTES) {
    return { version: STORE_VERSION, sessions, activeSessionId: stripped.activeSessionId, tempLibrary };
  }

  const stripAssistant = (m: DialogSession['messages'][0]) => {
    const next = { ...m };
    delete next.imageBase64;
    next.inputImages = undefined;
    delete next.resultImageBase64;
    delete next.understoodPrompt;
    if (next.versions?.length) {
      next.versions = next.versions.slice(-1).map((v) => ({
        ...v,
        resultImageBase64: v.resultImageObjectKey ? undefined : '',
        detectedBoxes: v.detectedBoxes,
      }));
    }
    return next;
  };

  const stripUser = (m: DialogSession['messages'][0]) => ({
    ...m,
    imageBase64: undefined,
    inputImages: undefined,
  });

  for (const s of sessions) {
    if (s.archived) {
      s.messages = s.messages.map((m) => (m.role === 'assistant' ? stripAssistant(m) : stripUser(m)));
    }
  }
  text = trySerialize();
  if (estimateBytes(text) <= DIALOG_STORE_MAX_BYTES) {
    return { version: STORE_VERSION, sessions, activeSessionId: stripped.activeSessionId, tempLibrary };
  }

  for (const s of sessions) {
    s.messages = s.messages.map((m) => (m.role === 'assistant' ? stripAssistant(m) : stripUser(m)));
  }
  text = trySerialize();
  if (estimateBytes(text) <= DIALOG_STORE_MAX_BYTES) {
    return { version: STORE_VERSION, sessions, activeSessionId: stripped.activeSessionId, tempLibrary };
  }

  sessions = sessions.slice(-8);
  text = trySerialize();
  while (estimateBytes(text) > DIALOG_STORE_MAX_BYTES && sessions.length > 1) {
    sessions = sessions.slice(1);
    text = trySerialize();
  }

  return {
    version: STORE_VERSION,
    sessions,
    activeSessionId: stripped.activeSessionId,
    tempLibrary: [],
  };
}

export function loadDialogWorkspaceState(persistUserId: string | null): DialogWorkspacePersistPayload | null {
  try {
    const raw = localStorage.getItem(dialogWorkspaceStorageKey(persistUserId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<DialogWorkspacePersistPayload>;
    if (data.version !== STORE_VERSION || !Array.isArray(data.sessions)) return null;
    return {
      version: STORE_VERSION,
      sessions: data.sessions as DialogSession[],
      activeSessionId: typeof data.activeSessionId === 'string' ? data.activeSessionId : '',
      tempLibrary: Array.isArray(data.tempLibrary) ? (data.tempLibrary as DialogTempItem[]) : [],
    };
  } catch {
    return null;
  }
}

export function saveDialogWorkspaceState(persistUserId: string | null, payload: DialogWorkspacePersistPayload): void {
  let toSave: DialogWorkspacePersistPayload = {
    version: STORE_VERSION,
    sessions: payload.sessions,
    activeSessionId: payload.activeSessionId,
    tempLibrary: payload.tempLibrary,
  };
  let json = JSON.stringify(stripDialogPayloadForPersist(toSave));
  if (estimateBytes(json) > DIALOG_STORE_MAX_BYTES) {
    toSave = lightenPayload(toSave);
    json = JSON.stringify(stripDialogPayloadForPersist(toSave));
  }
  try {
    localStorage.setItem(dialogWorkspaceStorageKey(persistUserId), json);
  } catch (e) {
    const name = typeof DOMException !== 'undefined' && e instanceof DOMException ? e.name : '';
    if (name === 'QuotaExceededError' || (e instanceof Error && /quota/i.test(e.message))) {
      toSave = lightenPayload({
        ...toSave,
        sessions: toSave.sessions.slice(-3),
        tempLibrary: [],
      });
      try {
        localStorage.setItem(dialogWorkspaceStorageKey(persistUserId), JSON.stringify(stripDialogPayloadForPersist(toSave)));
      } catch {
        console.warn('[dialog] localStorage 仍不足，已跳过本次对话持久化');
      }
    } else {
      throw e;
    }
  }
}
