import type { WorkspaceConnectedHost, WorkspaceFinger } from './workspaceDocumentProtocol';
import {
  connectedHostsFromDrafts,
  readPublishedConnectionDrafts,
} from './workspaceFingerHosts';

export type SendGateUiState = 'hidden' | 'idle_no_routes' | 'ready_one' | 'ready_many';

export function fingerHasCargo(finger: WorkspaceFinger | null | undefined): boolean {
  if (!finger || typeof finger !== 'object') return false;
  const rel = String(finger.selectedRelPath || '').trim();
  const asset = String(finger.selectedAssetId || '').trim();
  const display = String(finger.selectedDisplayKey || '').trim();
  return Boolean(rel || asset || display);
}

export function listSendTargets(
  finger: WorkspaceFinger | null | undefined,
): WorkspaceConnectedHost[] {
  const fromFinger = Array.isArray(finger?.connectedHosts) ? finger!.connectedHosts! : [];
  const readyFromFinger = fromFinger.filter((h) => h && h.ready && String(h.id || '').trim());
  if (readyFromFinger.length) return readyFromFinger;
  return connectedHostsFromDrafts(readPublishedConnectionDrafts(), {
    hasSelectedCard: fingerHasCargo(finger),
    selectedRelPath: finger?.selectedRelPath,
  }).filter((h) => h.ready && String(h.id || '').trim());
}

export function sendGateUiState(
  finger: WorkspaceFinger | null | undefined,
  targets: WorkspaceConnectedHost[] | null | undefined,
): SendGateUiState {
  if (!fingerHasCargo(finger)) return 'hidden';
  const list = Array.isArray(targets) ? targets : listSendTargets(finger);
  if (!list.length) return 'idle_no_routes';
  if (list.length === 1) return 'ready_one';
  return 'ready_many';
}

export type SendToHostResult = {
  ok: boolean;
  error?: string;
  suggestSurface?: string;
  hostId?: string;
};

export async function dispatchSendToHost(hostId?: string, localVersionId?: string): Promise<SendToHostResult> {
  if (typeof window === 'undefined') return { ok: false, error: 'send_unwired' };
  const shell = (
    window as Window & {
      companionShell?: {
        sendToCurrentHost?: (opts: { hostId?: string; localVersionId?: string }) => Promise<SendToHostResult>;
      };
    }
  ).companionShell;
  if (!shell || typeof shell.sendToCurrentHost !== 'function') return { ok: false, error: 'send_unwired' };
  const trimmed = String(hostId || '').trim();
  const versionId = String(localVersionId || '').trim();
  const r = await shell.sendToCurrentHost(
    trimmed || versionId ? { ...(trimmed ? { hostId: trimmed } : {}), ...(versionId ? { localVersionId: versionId } : {}) } : {},
  );
  return r && typeof r === 'object' ? r : { ok: false, error: 'send_failed' };
}
