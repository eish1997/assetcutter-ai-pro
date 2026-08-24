import type { SoftwareBridgeLifecycleInput } from '../softwareBridgeDriver.js';
import type { SoftwareBridgeLifecycleResult } from '../softwareBridgeDriver.js';

export function textMatches(input: { packageId: string; name: string; manifest: Record<string, unknown> }, pattern: RegExp): boolean {
  const text = [
    input.packageId,
    input.name,
    String(input.manifest.appName || ''),
    String(input.manifest.hostId || ''),
    String(input.manifest.softwareId || ''),
    String(input.manifest.templateHint || ''),
  ]
    .join(' ')
    .toLowerCase();
  return pattern.test(text);
}

export function targetDirsFromInput(input?: SoftwareBridgeLifecycleInput): string[] | undefined {
  return Array.isArray(input?.scriptsDirs)
    ? input?.scriptsDirs
    : input?.targetDir
      ? [input.targetDir]
      : undefined;
}

export function bridgeProbeResult(
  raw: { ok?: boolean; message?: string; error?: string; [key: string]: unknown } | null | undefined,
  fallbackMessage: string,
  softwareId: string,
): SoftwareBridgeLifecycleResult {
  const ok = Boolean(raw && raw.ok === true);
  const message = String(raw?.message || fallbackMessage);
  return ok
    ? { ...(raw || {}), ok: true, message, softwareId }
    : { ...(raw || {}), ok: false, error: String(raw?.error || 'probe_failed'), message, softwareId };
}
