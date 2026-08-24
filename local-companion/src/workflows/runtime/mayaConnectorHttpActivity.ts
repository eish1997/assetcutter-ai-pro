export type MayaConnectorRepairSuggestion = {
  canRetry: boolean;
  hermesActions: string[];
  recommendedAction: string;
  recoveryAction: 'retry' | 'review' | 'restart' | 'manual';
  requiresUserInput: boolean;
  summary: string;
  userMessage: string;
};

export type ExternalMayaConnectorSyncState = 'checking' | 'connected' | 'offline' | 'failed';

export type ExternalMayaConnectorSyncStatus = {
  lastCheckedAt?: string;
  lastError?: string;
  lastRepairSuggestion?: MayaConnectorRepairSuggestion;
  mode?: string;
  selectionCount?: number;
  state: ExternalMayaConnectorSyncState;
};

export type ExternalMayaConnectorExportResult =
  | {
      data: {
        bytes: number;
        exportedAt: string;
        localPath: string;
        selectedObjects: string[];
        selectionCount: number;
        sourceUri: string;
        storageUri: string;
        traceId?: string;
      };
      ok: true;
    }
  | {
      error: {
        message: string;
        repairSuggestion?: MayaConnectorRepairSuggestion;
      };
      ok: false;
    };

import {
  checkMayaCommandPortConnector,
  exportMayaCommandPortFbx,
  type MayaCommandPortTarget,
} from './mayaCommandPortConnector.js';

export async function checkExternalMayaConnector(
  baseUrl?: string,
  target?: Partial<MayaCommandPortTarget>,
): Promise<ExternalMayaConnectorSyncStatus> {
  if (!baseUrl) return checkMayaCommandPortConnector(target);

  const checkedAt = new Date().toISOString();
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  try {
    const health = await readRoute(`${normalizedBaseUrl}/health`);
    if (!health.ok) {
      return {
        lastCheckedAt: checkedAt,
        lastError: getRouteErrorMessage(health),
        lastRepairSuggestion: getRouteRepairSuggestion(health),
        state: 'failed',
      };
    }

    const selection = await readRoute(`${normalizedBaseUrl}/selection`);
    if (!selection.ok) {
      return {
        lastCheckedAt: checkedAt,
        lastError: getRouteErrorMessage(selection),
        lastRepairSuggestion: getRouteRepairSuggestion(selection),
        mode: getStringField(health.data, 'mode'),
        state: 'failed',
      };
    }

    return {
      lastCheckedAt: checkedAt,
      mode: getStringField(health.data, 'mode'),
      selectionCount: getNumberField(selection.data, 'count'),
      state: 'connected',
    };
  } catch (error) {
    return {
      lastCheckedAt: checkedAt,
      lastError: error instanceof Error ? error.message : String(error),
      state: 'offline',
    };
  }
}

export async function exportExternalMayaFbx(
  input: {
    output_path: string;
    overwrite: boolean;
    target?: Partial<MayaCommandPortTarget>;
    trace_id?: string;
  },
  baseUrl?: string,
): Promise<ExternalMayaConnectorExportResult> {
  if (!baseUrl) return exportMayaCommandPortFbx(input);

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const route = await postRoute(`${normalizedBaseUrl}/export/fbx`, input);
  if (!route.ok) {
    return {
      error: {
        message: getRouteErrorMessage(route),
        repairSuggestion: getRouteRepairSuggestion(route),
      },
      ok: false,
    };
  }

  return {
    data: {
      bytes: getNumberField(route.data, 'bytes') ?? 0,
      exportedAt: getStringField(route.data, 'exported_at') ?? new Date().toISOString(),
      localPath: getStringField(route.data, 'local_path') ?? input.output_path,
      selectedObjects: getStringArrayField(route.data, 'selected_objects'),
      selectionCount: getNumberField(route.data, 'selection_count') ?? 0,
      sourceUri: getStringField(route.data, 'source_uri') ?? 'maya://selection/current',
      storageUri: getStringField(route.data, 'storage_uri') ?? input.output_path,
      traceId: getStringField(route.data, 'trace_id') ?? input.trace_id,
    },
    ok: true,
  };
}

async function readRoute(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  const text = await response.text();
  return parseRouteJson(text, response.status);
}

async function postRoute(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  return parseRouteJson(text, response.status);
}

function parseRouteJson(text: string, status: number): Record<string, unknown> {
  try {
    return JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    return { ok: false, error: { message: text || `HTTP ${status}` } };
  }
}

function getRouteErrorMessage(route: Record<string, unknown>) {
  const error = isRecord(route.error) ? route.error : {};
  return getStringField(error, 'message') ?? getStringField(error, 'code') ?? 'Maya Connector request failed';
}

function getRouteRepairSuggestion(route: Record<string, unknown>) {
  const error = isRecord(route.error) ? route.error : {};
  const suggestion = isRecord(error.repair_suggestion) ? error.repair_suggestion : undefined;
  if (!suggestion) return undefined;

  return {
    canRetry: Boolean(suggestion.can_retry),
    hermesActions: Array.isArray(suggestion.hermes_actions)
      ? suggestion.hermes_actions.filter((item): item is string => typeof item === 'string')
      : [],
    recommendedAction: getStringField(suggestion, 'recommended_action') ?? 'inspect_connector_error',
    recoveryAction: 'review',
    requiresUserInput: Boolean(suggestion.requires_user_input),
    summary: getStringField(suggestion, 'summary') ?? 'Maya Connector failure',
    userMessage: getStringField(suggestion, 'user_message') ?? getRouteErrorMessage(route),
  } satisfies MayaConnectorRepairSuggestion;
}

function getStringField(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function getStringArrayField(record: unknown, key: string) {
  if (!isRecord(record)) return [];
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
