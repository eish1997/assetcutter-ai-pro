import type { AiJobDetail, AiJobSummary } from './aiJobsClient';
import { cancelMyAiJob, getMyAiJob, listMyAiJobs, retryMyAiJob, type RetryAiJobInput } from './aiJobsClient';

export type AiJobsState = {
  items: AiJobSummary[];
  byId: Record<string, AiJobSummary>;
  detailsById: Record<string, AiJobDetail>;
  loading: boolean;
  refreshingJobIds: Record<string, boolean>;
  error: string | null;
  lastLoadedAt: number | null;
  limit: number;
};

const EMPTY_STATE: AiJobsState = Object.freeze({
  items: [],
  byId: {},
  detailsById: {},
  loading: false,
  refreshingJobIds: {},
  error: null,
  lastLoadedAt: null,
  limit: 20,
});

let state: AiJobsState = EMPTY_STATE;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function setState(patch: Partial<AiJobsState>) {
  state = { ...state, ...patch };
  emit();
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error || '请求失败');
}

function mergeSummary(summary: AiJobSummary, prev: Record<string, AiJobSummary>) {
  return { ...prev, [summary.id]: summary };
}

function normalizeItems(items: unknown): AiJobSummary[] {
  return Array.isArray(items) ? items.filter((item): item is AiJobSummary => Boolean(item && typeof item === 'object' && 'id' in item)) : [];
}

function indexItems(items: AiJobSummary[]) {
  return items.reduce<Record<string, AiJobSummary>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

export function getAiJobsSnapshot(): AiJobsState {
  return state;
}

export function subscribeAiJobs(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshMyAiJobs(options: { limit?: number } = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || state.limit || 20)));
  setState({ loading: true, error: null, limit });
  try {
    const res = await listMyAiJobs({ limit });
    const items = normalizeItems(res?.items);
    const byId = { ...state.byId, ...indexItems(items) };
    setState({
      items,
      byId,
      loading: false,
      error: null,
      lastLoadedAt: Date.now(),
      limit: res.limit || limit,
    });
    return items;
  } catch (error) {
    setState({ loading: false, error: errorMessage(error) });
    throw error;
  }
}

export async function refreshMyAiJob(jobId: string) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Invalid AI job id');
  setState({
    refreshingJobIds: { ...state.refreshingJobIds, [id]: true },
    error: null,
  });
  try {
    const detail = await getMyAiJob(id);
    const byId = mergeSummary(detail.job, state.byId);
    const existingIndex = state.items.findIndex((item) => item.id === id);
    const items =
      existingIndex >= 0
        ? state.items.map((item) => (item.id === id ? detail.job : item))
        : [detail.job, ...state.items].slice(0, state.limit || 20);
    const { [id]: _done, ...refreshingJobIds } = state.refreshingJobIds;
    setState({
      items,
      byId,
      detailsById: { ...state.detailsById, [id]: detail },
      refreshingJobIds,
      error: null,
    });
    return detail;
  } catch (error) {
    const { [id]: _done, ...refreshingJobIds } = state.refreshingJobIds;
    setState({ refreshingJobIds, error: errorMessage(error) });
    throw error;
  }
}

export async function cancelAiJob(jobId: string) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Invalid AI job id');
  setState({
    refreshingJobIds: { ...state.refreshingJobIds, [id]: true },
    error: null,
  });
  try {
    const detail = await cancelMyAiJob(id);
    const { [id]: _done, ...refreshingJobIds } = state.refreshingJobIds;
    setState({
      items: state.items.map((item) => (item.id === id ? detail.job : item)),
      byId: mergeSummary(detail.job, state.byId),
      detailsById: { ...state.detailsById, [id]: detail },
      refreshingJobIds,
      error: null,
    });
    return detail;
  } catch (error) {
    const { [id]: _done, ...refreshingJobIds } = state.refreshingJobIds;
    setState({ refreshingJobIds, error: errorMessage(error) });
    throw error;
  }
}

export async function retryAiJob(jobId: string, input: RetryAiJobInput = {}) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Invalid AI job id');
  setState({
    refreshingJobIds: { ...state.refreshingJobIds, [id]: true },
    error: null,
  });
  try {
    const detail = await retryMyAiJob(id, input);
    const { [id]: _done, ...refreshingJobIds } = state.refreshingJobIds;
    const items = [detail.job, ...state.items.filter((item) => item.id !== detail.job.id)].slice(0, state.limit || 20);
    setState({
      items,
      byId: mergeSummary(detail.job, state.byId),
      detailsById: { ...state.detailsById, [detail.job.id]: detail },
      refreshingJobIds,
      error: null,
    });
    return detail;
  } catch (error) {
    const { [id]: _done, ...refreshingJobIds } = state.refreshingJobIds;
    setState({ refreshingJobIds, error: errorMessage(error) });
    throw error;
  }
}

export function upsertAiJobSummary(summary: AiJobSummary) {
  const byId = mergeSummary(summary, state.byId);
  const existingIndex = state.items.findIndex((item) => item.id === summary.id);
  const items =
    existingIndex >= 0
      ? state.items.map((item) => (item.id === summary.id ? summary : item))
      : [summary, ...state.items].slice(0, state.limit || 20);
  setState({ items, byId });
}

export function resetAiJobsStateForTests() {
  state = EMPTY_STATE;
  emit();
}
