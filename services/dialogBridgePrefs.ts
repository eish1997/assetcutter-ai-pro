import { readLocalString, writeLocalString } from './clientPersist';

const STORAGE_KEY = 'ac_dialog_bridge_prefs_v1';

/** A-Driver 连接器：gemini-web = 操作 gemini.google.com；bb-site = bb-browser site 子命令 */
export type DialogBridgeConnectorId = 'gemini-web' | 'bb-site';

export type DialogBridgePrefs = {
  enabled: boolean;
  /** 与 A-Driver 环境变量 BRIDGE_DEVICE_ID 一致 */
  deviceId: string;
  /** gemini-web：可填完整 URL 覆盖默认；bb-site：site 路由如 duckduckgo/search */
  bbSiteRoute: string;
  connectorId: DialogBridgeConnectorId;
};

const DEFAULTS: DialogBridgePrefs = {
  enabled: false,
  deviceId: '',
  bbSiteRoute: '',
  connectorId: 'gemini-web',
};

function normalizeConnectorId(raw: unknown): DialogBridgeConnectorId {
  return raw === 'bb-site' ? 'bb-site' : 'gemini-web';
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeDialogBridgePrefs(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getDialogBridgePrefs(): DialogBridgePrefs {
  const raw = readLocalString(STORAGE_KEY) ?? '';
  if (!raw.trim()) return { ...DEFAULTS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      deviceId: typeof o.deviceId === 'string' ? o.deviceId.trim() : '',
      bbSiteRoute: typeof o.bbSiteRoute === 'string' ? o.bbSiteRoute.trim() : '',
      connectorId: normalizeConnectorId(o.connectorId),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setDialogBridgePrefs(patch: Partial<DialogBridgePrefs>): void {
  const cur = getDialogBridgePrefs();
  const next: DialogBridgePrefs = {
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : cur.enabled,
    deviceId: patch.deviceId !== undefined ? String(patch.deviceId).trim() : cur.deviceId,
    bbSiteRoute: patch.bbSiteRoute !== undefined ? String(patch.bbSiteRoute).trim() : cur.bbSiteRoute,
    connectorId:
      patch.connectorId !== undefined ? normalizeConnectorId(patch.connectorId) : cur.connectorId,
  };
  writeLocalString(STORAGE_KEY, JSON.stringify(next));
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) notify();
  });
}
