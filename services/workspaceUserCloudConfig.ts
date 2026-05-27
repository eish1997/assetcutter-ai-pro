import type { CapabilitySet, CustomAppModule } from '../types';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';
import { normalizeEnabledAiProviders, type ConfigurableAiProvider } from './aiProviderCatalog';
import { normalizeEnabledChannels } from './modelRegistry/channelCatalog';
import type { ChannelId } from './modelRegistry/types';
import type { AiProvider } from './settingsStore';
import { sanitizeAvatarUrl } from './userUiPrefs';
import { workspaceRootPrefix } from './workspaceCloudSync';

type UploadUrlResponse = { uploadUrl: string; objectKey: string };
type DownloadUrlResponse = { downloadUrl: string; objectKey: string };

export type CapabilityCloudRecord<T extends { id: string }> = {
  id: string;
  updatedAt: number;
  deletedAt?: number;
  value?: T;
};

export type WorkspaceUserCloudConfig = {
  version: 1;
  updatedAt: number;
  capabilityPresets: CustomAppModule[];
  capabilitySets: CapabilitySet[];
  capabilityPresetRecords?: CapabilityCloudRecord<CustomAppModule>[];
  capabilitySetRecords?: CapabilityCloudRecord<CapabilitySet>[];
  settings: {
    dialogSkipUnderstand: boolean;
    workspaceAutoSyncEnabled: boolean;
    aiProvider: AiProvider;
    enabledAiProviders: ConfigurableAiProvider[];
    enabledChannels?: ChannelId[];
    geminiApiKey: string;
    toapisApiKey: string;
    toapisBaseUrl: string;
    antigravityApiKey: string;
    antigravityBaseUrl: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    vectorengineApiKey: string;
    vectorengineBaseUrl: string;
  };
  /** 侧栏展示名与头像（仅同步 https/http 图链；本机 data 头像不上云） */
  sidebarProfile?: {
    displayName: string;
    avatarUrl: string;
  };
};

function userCloudConfigKey(userId: string, username?: string | null): string {
  return `${workspaceRootPrefix(userId, username)}/user-config.json`;
}

async function putObjectBytes(objectKey: string, contentType: string, body: string): Promise<void> {
  const contentLength = new TextEncoder().encode(body).byteLength;
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, contentType, expiresIn: 900, contentLength }),
  });
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!put.ok) throw new Error(`R2 上传失败（${put.status}）`);
  await requestJson<{ ok?: boolean }>(r2ApiUrl('/register-upload'), {
    method: 'POST',
    body: JSON.stringify({ objectKey }),
  });
}

async function downloadObjectText(objectKey: string): Promise<string | null> {
  const { downloadUrl } = await requestJson<DownloadUrlResponse>(r2ApiUrl('/download-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, expiresIn: 300 }),
  });
  const r = await fetch(downloadUrl);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`R2 读取失败（${r.status}）`);
  return await r.text();
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value) || '';
  } catch {
    return '';
  }
}

function sanitizeRecord<T extends { id: string }>(
  record: CapabilityCloudRecord<T>,
  fallbackUpdatedAt: number
): CapabilityCloudRecord<T> | null {
  const id = String(record?.id || '').trim();
  if (!id) return null;
  const updatedAt = Number(record?.updatedAt || fallbackUpdatedAt || Date.now());
  const deletedAtRaw = record?.deletedAt;
  const deletedAt = deletedAtRaw != null ? Number(deletedAtRaw) : undefined;
  const value = record?.value && typeof record.value === 'object' ? record.value : undefined;
  return {
    id,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    ...(deletedAt != null && Number.isFinite(deletedAt) ? { deletedAt } : {}),
    ...(value ? { value } : {}),
  };
}

function normalizeRecords<T extends { id: string }>(
  records: CapabilityCloudRecord<T>[] | undefined,
  fallbackUpdatedAt: number
): CapabilityCloudRecord<T>[] {
  if (!Array.isArray(records)) return [];
  const out: CapabilityCloudRecord<T>[] = [];
  const seen = new Set<string>();
  for (const item of records) {
    const next = sanitizeRecord<T>(item, fallbackUpdatedAt);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

export function buildCapabilityCloudRecords<T extends { id: string }>(
  currentList: T[],
  previousRecords: CapabilityCloudRecord<T>[],
  nowTs = Date.now()
): CapabilityCloudRecord<T>[] {
  const now = Number.isFinite(nowTs) ? nowTs : Date.now();
  const prevMap = new Map<string, CapabilityCloudRecord<T>>();
  for (const r of normalizeRecords(previousRecords, now)) {
    prevMap.set(r.id, r);
  }
  const next: CapabilityCloudRecord<T>[] = [];
  const presentIds = new Set<string>();
  for (const item of Array.isArray(currentList) ? currentList : []) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    presentIds.add(id);
    const prev = prevMap.get(id);
    const same = prev?.value != null && stableStringify(prev.value) === stableStringify(item);
    next.push({
      id,
      updatedAt: same ? Number(prev?.updatedAt || now) : now,
      value: item,
    });
  }
  for (const [id, prev] of prevMap.entries()) {
    if (presentIds.has(id)) continue;
    const prevDel = prev.deletedAt != null ? Number(prev.deletedAt) : undefined;
    next.push({
      id,
      updatedAt: Number(prev.updatedAt || now),
      deletedAt: prevDel != null && Number.isFinite(prevDel) ? prevDel : now,
    });
  }
  return next;
}

export function mergeCapabilityCloudRecords<T extends { id: string }>(
  localCurrentList: T[],
  localPreviousRecords: CapabilityCloudRecord<T>[],
  cloudRecords: CapabilityCloudRecord<T>[],
  nowTs = Date.now(),
  options?: { serverWins?: boolean }
): { list: T[]; records: CapabilityCloudRecord<T>[] } {
  const now = Number.isFinite(nowTs) ? nowTs : Date.now();
  const serverWins = options?.serverWins === true;
  const localRecords = buildCapabilityCloudRecords(localCurrentList, localPreviousRecords, now);
  const mergedMap = new Map<string, CapabilityCloudRecord<T>>();
  for (const r of normalizeRecords(localRecords, now)) mergedMap.set(r.id, r);
  for (const remote of normalizeRecords(cloudRecords, now)) {
    const local = mergedMap.get(remote.id);
    if (!local) {
      mergedMap.set(remote.id, remote);
      continue;
    }
    if (serverWins) {
      mergedMap.set(remote.id, remote);
      continue;
    }
    const localLatest = Math.max(Number(local.updatedAt || 0), Number(local.deletedAt || 0));
    const remoteLatest = Math.max(Number(remote.updatedAt || 0), Number(remote.deletedAt || 0));
    if (remoteLatest > localLatest) mergedMap.set(remote.id, remote);
  }
  const records = Array.from(mergedMap.values());
  const list = records
    .filter((r) => !(r.deletedAt != null && Number(r.deletedAt) >= Number(r.updatedAt || 0)))
    .map((r) => r.value)
    .filter((v): v is T => Boolean(v && typeof v === 'object'));
  return { list, records };
}

export async function fetchWorkspaceUserCloudConfig(
  userId: string,
  username?: string | null
): Promise<WorkspaceUserCloudConfig | null> {
  const raw = await downloadObjectText(userCloudConfigKey(userId, username));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceUserCloudConfig>;
    if (parsed.version !== 1) return null;
    const sp = parsed.sidebarProfile;
    const sidebarProfile =
      sp && typeof sp === 'object'
        ? {
            displayName: String((sp as { displayName?: unknown }).displayName || '').slice(0, 24).trim(),
            avatarUrl: sanitizeAvatarUrl(String((sp as { avatarUrl?: unknown }).avatarUrl || '')),
          }
        : undefined;
    const fallbackUpdatedAt = Number(parsed.updatedAt || Date.now());
    const presetRecordsFromCloud = normalizeRecords<CustomAppModule>(parsed.capabilityPresetRecords, fallbackUpdatedAt);
    const setRecordsFromCloud = normalizeRecords<CapabilitySet>(parsed.capabilitySetRecords, fallbackUpdatedAt);
    const capabilityPresets =
      presetRecordsFromCloud.length > 0
        ? presetRecordsFromCloud
            .filter((r) => !(r.deletedAt != null && Number(r.deletedAt) >= Number(r.updatedAt || 0)))
            .map((r) => r.value)
            .filter((v): v is CustomAppModule => Boolean(v && typeof v === 'object'))
        : Array.isArray(parsed.capabilityPresets)
        ? parsed.capabilityPresets
        : [];
    const capabilitySets =
      setRecordsFromCloud.length > 0
        ? setRecordsFromCloud
            .filter((r) => !(r.deletedAt != null && Number(r.deletedAt) >= Number(r.updatedAt || 0)))
            .map((r) => r.value)
            .filter((v): v is CapabilitySet => Boolean(v && typeof v === 'object'))
        : Array.isArray(parsed.capabilitySets)
        ? parsed.capabilitySets
        : [];
    return {
      version: 1,
      updatedAt: fallbackUpdatedAt,
      capabilityPresets,
      capabilitySets,
      capabilityPresetRecords:
        presetRecordsFromCloud.length > 0
          ? presetRecordsFromCloud
          : capabilityPresets.map((p) => ({ id: p.id, updatedAt: fallbackUpdatedAt, value: p })),
      capabilitySetRecords:
        setRecordsFromCloud.length > 0
          ? setRecordsFromCloud
          : capabilitySets.map((s) => ({ id: s.id, updatedAt: fallbackUpdatedAt, value: s })),
      settings: {
        dialogSkipUnderstand: parsed.settings?.dialogSkipUnderstand === true,
        workspaceAutoSyncEnabled: parsed.settings?.workspaceAutoSyncEnabled !== false,
        aiProvider: (() => {
          const ap = String(parsed.settings?.aiProvider ?? '')
            .trim()
            .toLowerCase();
          if (ap === 'trial' || ap === 'vertex' || ap === 'toapis' || ap === 'antigravity' || ap === 'openai' || ap === 'vectorengine') {
            return ap as AiProvider;
          }
          if (ap === 'gemini') return 'gemini';
          return 'gemini';
        })(),
        enabledAiProviders: normalizeEnabledAiProviders(parsed.settings?.enabledAiProviders),
        enabledChannels: normalizeEnabledChannels(parsed.settings?.enabledChannels),
        geminiApiKey: String(parsed.settings?.geminiApiKey || ''),
        toapisApiKey: String(parsed.settings?.toapisApiKey || ''),
        toapisBaseUrl: String(parsed.settings?.toapisBaseUrl || ''),
        antigravityApiKey: String(parsed.settings?.antigravityApiKey || ''),
        antigravityBaseUrl: String(parsed.settings?.antigravityBaseUrl || ''),
        openaiApiKey: String(parsed.settings?.openaiApiKey || ''),
        openaiBaseUrl: String(parsed.settings?.openaiBaseUrl || ''),
        vectorengineApiKey: String(parsed.settings?.vectorengineApiKey || ''),
        vectorengineBaseUrl: String(parsed.settings?.vectorengineBaseUrl || ''),
      },
      ...(sidebarProfile ? { sidebarProfile } : {}),
    };
  } catch {
    return null;
  }
}

export async function pushWorkspaceUserCloudConfig(
  userId: string,
  username: string | null | undefined,
  input: Omit<WorkspaceUserCloudConfig, 'version' | 'updatedAt'>
): Promise<void> {
  const sidebarProfile = input.sidebarProfile
    ? {
        displayName: String(input.sidebarProfile.displayName || '').slice(0, 24).trim(),
        avatarUrl: sanitizeAvatarUrl(String(input.sidebarProfile.avatarUrl || '')),
      }
    : { displayName: '', avatarUrl: '' };
  const payload: WorkspaceUserCloudConfig = {
    version: 1,
    updatedAt: Date.now(),
    capabilityPresets: input.capabilityPresets,
    capabilitySets: input.capabilitySets,
    capabilityPresetRecords: normalizeRecords<CustomAppModule>(
      input.capabilityPresetRecords,
      Date.now()
    ),
    capabilitySetRecords: normalizeRecords<CapabilitySet>(input.capabilitySetRecords, Date.now()),
    settings: {
      dialogSkipUnderstand: input.settings.dialogSkipUnderstand === true,
      workspaceAutoSyncEnabled: input.settings.workspaceAutoSyncEnabled !== false,
      aiProvider: (() => {
        const ap = String(input.settings.aiProvider ?? '')
          .trim()
          .toLowerCase();
        if (ap === 'trial' || ap === 'vertex' || ap === 'toapis' || ap === 'antigravity' || ap === 'openai' || ap === 'vectorengine') {
          return ap as AiProvider;
        }
        if (ap === 'gemini') return 'gemini';
        return 'gemini';
      })(),
      enabledAiProviders: normalizeEnabledAiProviders(input.settings.enabledAiProviders),
      enabledChannels: normalizeEnabledChannels(input.settings.enabledChannels),
      geminiApiKey: String(input.settings.geminiApiKey || ''),
      toapisApiKey: String(input.settings.toapisApiKey || ''),
      toapisBaseUrl: String(input.settings.toapisBaseUrl || ''),
      antigravityApiKey: String(input.settings.antigravityApiKey || ''),
      antigravityBaseUrl: String(input.settings.antigravityBaseUrl || ''),
      openaiApiKey: String(input.settings.openaiApiKey || ''),
      openaiBaseUrl: String(input.settings.openaiBaseUrl || ''),
      vectorengineApiKey: String(input.settings.vectorengineApiKey || ''),
      vectorengineBaseUrl: String(input.settings.vectorengineBaseUrl || ''),
    },
    sidebarProfile,
  };
  await putObjectBytes(userCloudConfigKey(userId, username), 'application/json', JSON.stringify(payload));
}

