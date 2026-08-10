import type {
  RuntimeEvent,
  RuntimePerceptionPatch,
  RuntimePerceptionSnapshot,
} from '../../types/runtimePerception';
import { sanitizeRuntimePerceptionText } from './sanitize';

export type RuntimePerceptionContextBusOptions = {
  now?: () => number;
  eventLimit?: number;
  initialSnapshot?: Partial<RuntimePerceptionSnapshot>;
};

export type RuntimePerceptionContextBus = {
  getSnapshot: () => RuntimePerceptionSnapshot;
  updatePartial: (patch: RuntimePerceptionPatch) => RuntimePerceptionSnapshot;
  emitEvent: (event: Omit<RuntimeEvent, 'id' | 'ts'> & Partial<Pick<RuntimeEvent, 'id' | 'ts'>>) => RuntimeEvent;
  listRecentEvents: (limit?: number) => RuntimeEvent[];
  reset: (snapshot?: Partial<RuntimePerceptionSnapshot>) => RuntimePerceptionSnapshot;
};

const DEFAULT_EVENT_LIMIT = 100;

function emptySnapshot(now: number): RuntimePerceptionSnapshot {
  return {
    version: 1,
    capturedAt: now,
    freshnessMs: 0,
    workspace: {
      activeSurface: 'none',
      selectedAssetIds: [],
    },
    workflow: {
      hasPlan: false,
      steps: [],
      blockers: [],
      pendingConfirmations: [],
    },
    externalApps: [],
    capabilities: [],
    recentEvents: [],
    risks: [],
  };
}

function normalizeEvent(
  input: Omit<RuntimeEvent, 'id' | 'ts'> & Partial<Pick<RuntimeEvent, 'id' | 'ts'>>,
  now: number
): RuntimeEvent {
  const id = String(input.id || `evt_${now}_${Math.random().toString(36).slice(2, 8)}`);
  return {
    id,
    ts: typeof input.ts === 'number' && Number.isFinite(input.ts) ? input.ts : now,
    source: input.source,
    type: sanitizeRuntimePerceptionText(input.type, 120) || 'runtime.event',
    summary: sanitizeRuntimePerceptionText(input.summary),
    ...(input.entityRefs?.length ? { entityRefs: input.entityRefs } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.correlationId ? { correlationId: sanitizeRuntimePerceptionText(input.correlationId, 120) } : {}),
  };
}

function mergeSnapshot(
  base: RuntimePerceptionSnapshot,
  patch: Partial<RuntimePerceptionSnapshot>,
  now: number,
  recentEvents: RuntimeEvent[]
): RuntimePerceptionSnapshot {
  const capturedAt =
    typeof patch.capturedAt === 'number' && Number.isFinite(patch.capturedAt)
      ? patch.capturedAt
      : now;
  return {
    ...base,
    ...patch,
    version: 1,
    capturedAt,
    freshnessMs: Math.max(0, now - capturedAt),
    workspace: patch.workspace ?? base.workspace,
    workflow: patch.workflow ?? base.workflow,
    externalApps: patch.externalApps ?? base.externalApps,
    capabilities: patch.capabilities ?? base.capabilities,
    risks: patch.risks ?? base.risks,
    recentEvents,
  };
}

export function createRuntimePerceptionContextBus(
  options: RuntimePerceptionContextBusOptions = {}
): RuntimePerceptionContextBus {
  const nowFn = options.now ?? (() => Date.now());
  const eventLimit = Math.max(1, Math.floor(options.eventLimit ?? DEFAULT_EVENT_LIMIT));
  let events: RuntimeEvent[] = [];
  let snapshot = mergeSnapshot(
    emptySnapshot(nowFn()),
    options.initialSnapshot ?? {},
    nowFn(),
    events
  );

  const refreshFreshness = (): RuntimePerceptionSnapshot => {
    const now = nowFn();
    snapshot = {
      ...snapshot,
      freshnessMs: Math.max(0, now - snapshot.capturedAt),
      recentEvents: events,
    };
    return snapshot;
  };

  return {
    getSnapshot: () => refreshFreshness(),
    updatePartial: (patch) => {
      snapshot = mergeSnapshot(snapshot, patch, nowFn(), events);
      return snapshot;
    },
    emitEvent: (event) => {
      const normalized = normalizeEvent(event, nowFn());
      events = [normalized, ...events].slice(0, eventLimit);
      snapshot = {
        ...snapshot,
        recentEvents: events,
      };
      return normalized;
    },
    listRecentEvents: (limit = eventLimit) => {
      const n = Math.max(0, Math.floor(limit));
      return events.slice(0, n);
    },
    reset: (nextSnapshot = {}) => {
      events = [];
      snapshot = mergeSnapshot(emptySnapshot(nowFn()), nextSnapshot, nowFn(), events);
      return snapshot;
    },
  };
}

export const runtimePerceptionBus = createRuntimePerceptionContextBus();
