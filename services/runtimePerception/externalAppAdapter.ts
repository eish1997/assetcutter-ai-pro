import type {
  RuntimeCapability,
  RuntimeExternalAppState,
  RuntimeExternalCommandEvent,
  RuntimeExternalSelection,
  RuntimePerceptionRisk,
} from '../../types/runtimePerception';
import { sanitizeRuntimePerceptionText, uniqueCleanStrings } from './sanitize';

export type BuildRuntimeExternalAppStateInput = {
  appId: string;
  name: string;
  connected?: boolean;
  foreground?: boolean;
  activeDocument?: string | null;
  activeDocumentPath?: string | null;
  selection?: Partial<RuntimeExternalSelection> | null;
  currentTool?: string | null;
  unsavedChanges?: boolean;
  recentCommands?: readonly Partial<RuntimeExternalCommandEvent>[] | null;
  health?: RuntimeExternalAppState['health'];
  lastHeartbeatAt?: number;
};

export function buildRuntimeExternalAppState(
  input: BuildRuntimeExternalAppStateInput
): RuntimeExternalAppState {
  const selection: RuntimeExternalSelection = {
    kind: input.selection?.kind ?? 'unknown',
    ...(typeof input.selection?.count === 'number' ? { count: input.selection.count } : {}),
    ...(input.selection?.summary ? { summary: sanitizeRuntimePerceptionText(input.selection.summary, 160) } : {}),
    ...(input.selection?.ids?.length ? { ids: uniqueCleanStrings(input.selection.ids, 50) } : {}),
    ...(typeof input.selection?.stale === 'boolean' ? { stale: input.selection.stale } : {}),
  };
  return {
    appId: sanitizeRuntimePerceptionText(input.appId, 120),
    name: sanitizeRuntimePerceptionText(input.name, 120),
    connected: input.connected === true,
    ...(typeof input.foreground === 'boolean' ? { foreground: input.foreground } : {}),
    ...(input.activeDocument ? { activeDocument: sanitizeRuntimePerceptionText(input.activeDocument, 120) } : {}),
    ...(input.activeDocumentPath ? { activeDocumentPath: sanitizeRuntimePerceptionText(input.activeDocumentPath, 160) } : {}),
    selection,
    ...(input.currentTool ? { currentTool: sanitizeRuntimePerceptionText(input.currentTool, 120) } : {}),
    ...(typeof input.unsavedChanges === 'boolean' ? { unsavedChanges: input.unsavedChanges } : {}),
    recentCommands: (input.recentCommands ?? []).slice(0, 10).map((command, index) => ({
      id: sanitizeRuntimePerceptionText(command.id || `cmd-${index + 1}`, 120),
      ts: typeof command.ts === 'number' && Number.isFinite(command.ts) ? command.ts : Date.now(),
      commandId: sanitizeRuntimePerceptionText(command.commandId || 'unknown', 120),
      ...(command.label ? { label: sanitizeRuntimePerceptionText(command.label, 120) } : {}),
      status: command.status ?? 'requested',
      ...(command.summary ? { summary: sanitizeRuntimePerceptionText(command.summary, 160) } : {}),
    })),
    health: input.health ?? (input.connected ? 'ok' : 'disconnected'),
    ...(typeof input.lastHeartbeatAt === 'number' ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
  };
}

export function buildExternalAppCapabilities(apps: readonly RuntimeExternalAppState[]): RuntimeCapability[] {
  return apps.flatMap((app) => {
    const hasSelection =
      app.selection.kind !== 'none' &&
      app.selection.kind !== 'unknown' &&
      (app.selection.count == null || app.selection.count > 0);
    return [
      {
        id: `external.${app.appId}.inspect`,
        label: `Inspect ${app.name}`,
        source: 'external_app' as const,
        appId: app.appId,
        enabled: app.connected,
        unavailableReason: app.connected ? undefined : `${app.name} is disconnected`,
        risk: 'read' as const,
        targetScope: 'external_selection' as const,
        requiresConfirmation: false,
      },
      {
        id: `external.${app.appId}.repair_connection`,
        label: `Repair ${app.name} connection`,
        source: app.appId === 'local-companion' ? ('companion' as const) : ('external_app' as const),
        appId: app.appId,
        enabled: !app.connected,
        unavailableReason: !app.connected ? undefined : `${app.name} is already connected`,
        risk: 'light' as const,
        targetScope: 'current' as const,
        requiresConfirmation: false,
      },
      {
        id: `external.${app.appId}.apply_to_selection`,
        label: `Apply to ${app.name} selection`,
        source: 'external_app' as const,
        appId: app.appId,
        enabled: app.connected && hasSelection,
        unavailableReason: app.connected
          ? hasSelection
            ? undefined
            : 'External selection is empty or unknown'
          : `${app.name} is disconnected`,
        risk: 'destructive' as const,
        targetScope: 'external_selection' as const,
        requiresConfirmation: true,
      },
    ];
  });
}

export type RuntimeConnectionPackageLike = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  manifest?: unknown;
  connectionState?: unknown;
  lastProbe?: unknown;
  lastInstall?: unknown;
  events?: unknown;
  source?: unknown;
};

type RuntimeConnectionStateLike = {
  maturity?: unknown;
  label?: unknown;
  blockedReason?: unknown;
  nextAction?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalText(value: unknown): string | undefined {
  const text = sanitizeRuntimePerceptionText(value, 160);
  return text || undefined;
}

function eventTime(value: unknown): number | undefined {
  const text = String(value || '').trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordOk(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && (record as Record<string, unknown>).ok === true);
}

function recordFailed(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && (record as Record<string, unknown>).ok === false);
}

function connectionStateFor(pkg: RuntimeConnectionPackageLike): RuntimeConnectionStateLike {
  const explicit = asRecord(pkg.connectionState);
  if (Object.keys(explicit).length) return explicit;
  if (recordOk(pkg.lastProbe)) {
    return { maturity: 'connected', label: 'Connected', blockedReason: '', nextAction: 'Connection has a real probe signal.' };
  }
  if (recordFailed(pkg.lastProbe)) {
    return { maturity: 'probe_failed', label: 'Probe failed', blockedReason: 'No real host signal received.', nextAction: 'Repair or rerun probe.' };
  }
  if (recordOk(pkg.lastInstall)) {
    return { maturity: 'bridge_installed', label: 'Installed, waiting for probe', blockedReason: 'Probe has not succeeded yet.', nextAction: 'Open the host app and run probe.' };
  }
  return { maturity: 'unknown', label: 'Unknown', blockedReason: 'Connection state is unknown.', nextAction: 'Open the connection page and refresh.' };
}

function healthForConnectionState(state: RuntimeConnectionStateLike): RuntimeExternalAppState['health'] {
  const maturity = String(state.maturity || '').toLowerCase();
  if (maturity === 'connected') return 'ok';
  if (maturity === 'probe_failed') return 'error';
  if (maturity === 'bridge_installed' || maturity === 'bridge_supported' || maturity === 'path_ready' || maturity === 'process_ready') {
    return 'degraded';
  }
  if (maturity === 'draft' || maturity === 'template_missing' || maturity === 'needs_user_action') return 'disconnected';
  return 'unknown';
}

function commandEventsFromPackage(pkg: RuntimeConnectionPackageLike): RuntimeExternalCommandEvent[] {
  const rows: RuntimeExternalCommandEvent[] = [];
  const pushRecord = (kind: string, record: unknown) => {
    const row = asRecord(record);
    if (!Object.keys(row).length) return;
    const result = asRecord(row.result);
    rows.push({
      id: sanitizeRuntimePerceptionText(`${pkg.id || 'connection'}-${kind}-${row.at || rows.length + 1}`, 120),
      ts: eventTime(row.at) ?? Date.now(),
      commandId: sanitizeRuntimePerceptionText(kind, 120),
      label: sanitizeRuntimePerceptionText(kind, 120),
      status: row.ok === true ? 'succeeded' : row.ok === false ? 'failed' : 'requested',
      summary: sanitizeRuntimePerceptionText(result.message || row.message || kind, 160),
    });
  };
  pushRecord('install', pkg.lastInstall);
  pushRecord('probe', pkg.lastProbe);
  for (const event of Array.isArray(pkg.events) ? pkg.events : []) {
    const row = asRecord(event);
    if (!Object.keys(row).length) continue;
    rows.push({
      id: sanitizeRuntimePerceptionText(`${pkg.id || 'connection'}-${row.kind || 'event'}-${row.at || rows.length + 1}`, 120),
      ts: eventTime(row.at) ?? Date.now(),
      commandId: sanitizeRuntimePerceptionText(row.kind || 'event', 120),
      label: sanitizeRuntimePerceptionText(row.kind || 'event', 120),
      status: row.ok === true ? 'succeeded' : row.ok === false ? 'failed' : 'requested',
      summary: sanitizeRuntimePerceptionText(row.message || row.kind || 'event', 160),
    });
  }
  return rows.sort((a, b) => b.ts - a.ts).slice(0, 10);
}

export function buildRuntimeExternalAppsFromConnectionPackages(
  packages: readonly RuntimeConnectionPackageLike[]
): RuntimeExternalAppState[] {
  return packages
    .filter((pkg) => String(pkg?.type || '') === 'software_connection')
    .map((pkg) => {
      const manifest = asRecord(pkg.manifest);
      const state = connectionStateFor(pkg);
      const health = healthForConnectionState(state);
      const connected = health === 'ok';
      return buildRuntimeExternalAppState({
        appId: sanitizeRuntimePerceptionText(pkg.id || manifest.hostId || manifest.softwareId || 'software-connection', 120),
        name: sanitizeRuntimePerceptionText(pkg.name || manifest.appName || manifest.hostId || 'Software connection', 120),
        connected,
        activeDocument: optionalText(manifest.activeDocument || manifest.documentName),
        activeDocumentPath: optionalText(manifest.activeDocumentPath || manifest.documentPath),
        selection: {
          kind: 'unknown',
          summary: connected
            ? 'selection unknown'
            : sanitizeRuntimePerceptionText(state.blockedReason || state.label || 'connection not ready', 160),
        },
        currentTool: optionalText(state.nextAction),
        recentCommands: commandEventsFromPackage(pkg),
        health,
        lastHeartbeatAt: recordOk(pkg.lastProbe) ? eventTime(asRecord(pkg.lastProbe).at) : undefined,
      });
    });
}

export function buildDisconnectedCompanionExternalApp(message?: unknown): RuntimeExternalAppState {
  return buildRuntimeExternalAppState({
    appId: 'local-companion',
    name: 'Local companion',
    connected: false,
    selection: {
      kind: 'unknown',
      summary: sanitizeRuntimePerceptionText(message || 'companion unavailable', 160),
    },
    recentCommands: [
      {
        id: 'local-companion-status',
        ts: Date.now(),
        commandId: 'companion.status',
        label: 'Companion status',
        status: 'failed',
        summary: sanitizeRuntimePerceptionText(message || 'Unable to read companion connection packages', 160),
      },
    ],
    health: 'disconnected',
  });
}

export function buildExternalAppPerceptionRisks(apps: readonly RuntimeExternalAppState[]): RuntimePerceptionRisk[] {
  return apps
    .filter((app) => !app.connected || app.selection.kind === 'unknown' || app.selection.stale)
    .map((app) => ({
      id: `external.${app.appId}.${app.connected ? 'unknown_selection' : 'disconnected'}`,
      summary: app.connected ? `${app.name} selection is unknown` : `${app.name} is not connected`,
      level: app.connected ? ('warn' as const) : ('block' as const),
      source: 'external_app' as const,
    }));
}
