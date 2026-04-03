import type { CapabilitySet, CustomAppModule } from '../types';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';
import { sanitizeAvatarUrl } from './userUiPrefs';
import { workspaceRootPrefix } from './workspaceCloudSync';

type UploadUrlResponse = { uploadUrl: string; objectKey: string };
type DownloadUrlResponse = { downloadUrl: string; objectKey: string };

export type WorkspaceUserCloudConfig = {
  version: 1;
  updatedAt: number;
  capabilityPresets: CustomAppModule[];
  capabilitySets: CapabilitySet[];
  settings: {
    dialogSkipUnderstand: boolean;
    workspaceAutoSyncEnabled: boolean;
    aiProvider: 'gemini' | 'toapis' | 'vectorengine';
    geminiApiKey: string;
    toapisApiKey: string;
    toapisBaseUrl: string;
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
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, contentType, expiresIn: 900 }),
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
    return {
      version: 1,
      updatedAt: Number(parsed.updatedAt || Date.now()),
      capabilityPresets: Array.isArray(parsed.capabilityPresets) ? parsed.capabilityPresets : [],
      capabilitySets: Array.isArray(parsed.capabilitySets) ? parsed.capabilitySets : [],
      settings: {
        dialogSkipUnderstand: parsed.settings?.dialogSkipUnderstand === true,
        workspaceAutoSyncEnabled: parsed.settings?.workspaceAutoSyncEnabled !== false,
        aiProvider:
          parsed.settings?.aiProvider === 'toapis' || parsed.settings?.aiProvider === 'vectorengine'
            ? parsed.settings.aiProvider
            : 'gemini',
        geminiApiKey: String(parsed.settings?.geminiApiKey || ''),
        toapisApiKey: String(parsed.settings?.toapisApiKey || ''),
        toapisBaseUrl: String(parsed.settings?.toapisBaseUrl || ''),
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
    settings: {
      dialogSkipUnderstand: input.settings.dialogSkipUnderstand === true,
      workspaceAutoSyncEnabled: input.settings.workspaceAutoSyncEnabled !== false,
      aiProvider:
        input.settings.aiProvider === 'toapis' || input.settings.aiProvider === 'vectorengine'
          ? input.settings.aiProvider
          : 'gemini',
      geminiApiKey: String(input.settings.geminiApiKey || ''),
      toapisApiKey: String(input.settings.toapisApiKey || ''),
      toapisBaseUrl: String(input.settings.toapisBaseUrl || ''),
      vectorengineApiKey: String(input.settings.vectorengineApiKey || ''),
      vectorengineBaseUrl: String(input.settings.vectorengineBaseUrl || ''),
    },
    sidebarProfile,
  };
  await putObjectBytes(userCloudConfigKey(userId, username), 'application/json', JSON.stringify(payload));
}

