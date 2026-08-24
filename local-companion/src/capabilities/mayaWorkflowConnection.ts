import { getDefaultMayaCommandPortTarget, type MayaCommandPortTarget } from '../workflows/runtime/mayaCommandPortConnector.js';
import { readCapabilityPackageDraft, readCapabilityPackageDrafts, type CapabilityPackageDraft } from './capabilityPackageStore.js';
import { deriveSoftwareConnectionState } from './softwareConnectionState.js';

export type MayaWorkflowConnection = {
  connected: boolean;
  draft: CapabilityPackageDraft;
  target: MayaCommandPortTarget;
};

export function findMayaWorkflowConnection(preferredId = 'maya'): MayaWorkflowConnection | null {
  const preferred = readCapabilityPackageDraft(preferredId);
  const others = readCapabilityPackageDrafts().filter((draft) => draft.id !== preferred?.id && isMayaSoftwareConnection(draft));
  const candidates = [preferred, ...others].filter((draft): draft is CapabilityPackageDraft => Boolean(draft && isMayaSoftwareConnection(draft)));
  if (!candidates.length) return null;

  const connected = candidates.find((draft) => deriveSoftwareConnectionState(draft).maturity === 'connected');
  const draft = connected || preferred || candidates[0];
  if (!draft) return null;

  return {
    connected: deriveSoftwareConnectionState(draft).maturity === 'connected',
    draft,
    target: targetFromDraft(draft),
  };
}

export function resolveMayaCommandPortTarget(preferredId = 'maya'): MayaCommandPortTarget {
  return findMayaWorkflowConnection(preferredId)?.target ?? getDefaultMayaCommandPortTarget();
}

function isMayaSoftwareConnection(draft: CapabilityPackageDraft) {
  if (draft.type !== 'software_connection') return false;
  const haystack = [
    draft.id,
    draft.name,
    String(draft.manifest?.hostId || ''),
    String(draft.manifest?.softwareId || ''),
    String(draft.manifest?.appName || ''),
    probeSoftwareId(draft.lastProbe),
  ].join(' ').toLowerCase();
  return haystack.includes('maya');
}

function targetFromDraft(draft: CapabilityPackageDraft): MayaCommandPortTarget {
  const probe = asRecord(draft.lastProbe);
  const result = asRecord(probe.result);
  return getDefaultMayaCommandPortTarget({
    host: firstString(result.host, probe.host),
    port: firstNumber(result.port, probe.port),
  });
}

function probeSoftwareId(lastProbe: unknown) {
  const probe = asRecord(lastProbe);
  const result = asRecord(probe.result);
  return firstString(probe.softwareId, result.softwareId) || '';
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
