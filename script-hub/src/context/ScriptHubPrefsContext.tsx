import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchScriptHubPrefs, patchScriptHubPrefs } from '../services/scriptHubPrefsApi';
import {
  readScriptHubPrefsLocalOrDefault,
  writeScriptHubPrefsLocal,
} from '../services/scriptHubPrefsLocal';
import { DEFAULT_SCRIPT_HUB_PREFS, type ScriptHubUserPrefsV1 } from '../types/scriptHubPrefs';

type Ctx = {
  ready: boolean;
  prefs: ScriptHubUserPrefsV1;
  mayaHost: string;
  mayaPort: number;
  setMayaEndpoint: (host: string, port: number) => void;
  getLastParams: (scriptId: string) => Record<string, unknown> | null;
  saveLastParams: (scriptId: string, params: Record<string, unknown>, revisionId?: string) => Promise<void>;
  refreshPrefs: () => Promise<void>;
};

const PrefsCtx = createContext<Ctx | null>(null);

export function ScriptHubPrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : '';
  const [prefs, setPrefs] = useState<ScriptHubUserPrefsV1>(DEFAULT_SCRIPT_HUB_PREFS);
  const [ready, setReady] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const hydrate = useCallback(async () => {
    if (!userId) {
      setPrefs(DEFAULT_SCRIPT_HUB_PREFS);
      setReady(true);
      return;
    }
    const local = readScriptHubPrefsLocalOrDefault(userId);
    setPrefs(local);
    setReady(true);
    try {
      const { prefs: cloud } = await fetchScriptHubPrefs();
      setPrefs(cloud);
      writeScriptHubPrefsLocal(userId, cloud);
    } catch {
      /* 离线/未登录 API：沿用本地缓存 */
    }
  }, [userId]);

  useEffect(() => {
    setReady(false);
    void hydrate();
  }, [hydrate]);

  const persistPatch = useCallback(
    async (patch: Partial<Pick<ScriptHubUserPrefsV1, 'maya' | 'lastParamsByScriptId'>>) => {
      if (!userId) return;
      const merged: ScriptHubUserPrefsV1 = {
        ...prefsRef.current,
        ...patch,
        version: 1,
        updatedAt: Date.now(),
        maya: patch.maya ?? prefsRef.current.maya,
        lastParamsByScriptId: {
          ...prefsRef.current.lastParamsByScriptId,
          ...(patch.lastParamsByScriptId ?? {}),
        },
      };
      setPrefs(merged);
      writeScriptHubPrefsLocal(userId, merged);
      try {
        const { prefs: cloud } = await patchScriptHubPrefs(patch);
        setPrefs(cloud);
        writeScriptHubPrefsLocal(userId, cloud);
      } catch {
        /* 下次 hydrate 再同步 */
      }
    },
    [userId],
  );

  const mayaSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMayaEndpoint = useCallback(
    (host: string, port: number) => {
      const h = host.trim() || '127.0.0.1';
      const p = Number.isFinite(port) && port > 0 ? Math.floor(port) : 7001;
      setPrefs((prev) => ({ ...prev, maya: { host: h, port: p } }));
      if (mayaSaveTimer.current) clearTimeout(mayaSaveTimer.current);
      mayaSaveTimer.current = setTimeout(() => {
        void persistPatch({ maya: { host: h, port: p } });
      }, 450);
    },
    [persistPatch],
  );

  const getLastParams = useCallback(
    (scriptId: string) => {
      const entry = prefs.lastParamsByScriptId[scriptId];
      return entry?.params ?? null;
    },
    [prefs.lastParamsByScriptId],
  );

  const saveLastParams = useCallback(
    async (scriptId: string, params: Record<string, unknown>, revisionId?: string) => {
      await persistPatch({
        lastParamsByScriptId: {
          [scriptId]: {
            params,
            updatedAt: Date.now(),
            ...(revisionId ? { revisionId } : {}),
          },
        },
      });
    },
    [persistPatch],
  );

  const v = useMemo(
    (): Ctx => ({
      ready,
      prefs,
      mayaHost: prefs.maya.host,
      mayaPort: prefs.maya.port,
      setMayaEndpoint,
      getLastParams,
      saveLastParams,
      refreshPrefs: hydrate,
    }),
    [ready, prefs, setMayaEndpoint, getLastParams, saveLastParams, hydrate],
  );

  return <PrefsCtx.Provider value={v}>{children}</PrefsCtx.Provider>;
}

export function useScriptHubPrefs(): Ctx {
  const x = useContext(PrefsCtx);
  if (!x) throw new Error('useScriptHubPrefs 须在 ScriptHubPrefsProvider 内');
  return x;
}
