import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiJobDetail, AiJobSummary } from '../services/aiJobsClient';

vi.mock('../services/aiJobsClient', () => ({
  cancelMyAiJob: vi.fn(),
  listMyAiJobs: vi.fn(),
  getMyAiJob: vi.fn(),
  retryMyAiJob: vi.fn(),
}));

import { cancelMyAiJob, getMyAiJob, listMyAiJobs, retryMyAiJob } from '../services/aiJobsClient';
import {
  cancelAiJob,
  getAiJobsSnapshot,
  refreshMyAiJob,
  refreshMyAiJobs,
  resetAiJobsStateForTests,
  retryAiJob,
  subscribeAiJobs,
  upsertAiJobSummary,
} from '../services/aiJobsStore';

function makeSummary(id: string, status: AiJobSummary['status'] = 'created'): AiJobSummary {
  return {
    id,
    status,
    modality: 'image',
    capability: 'image.generate',
    provider: 'vertex-gemini',
    model: 'gemini-3-pro-image',
    userId: 'user_1',
    correlationId: `corr_${id}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    route: { providerId: 'vertex-gemini', adapterId: 'gemini-proxy', channel: 'vertex-proxy', upstreamBackend: 'vertex' },
    traceOnly: true,
    legacyPath: '/proxy/gemini/async',
    proxyJobId: null,
    creditsGate: { mode: 'plan', estimatedCredits: 134 },
    error: null,
  };
}

function makeDetail(id: string, status: AiJobSummary['status'] = 'succeeded'): AiJobDetail {
  return {
    job: {
      ...makeSummary(id, status),
      output: null,
      artifacts: [],
    },
    route: { providerId: 'vertex-gemini', adapterId: 'gemini-proxy', channel: 'vertex-proxy', upstreamBackend: 'vertex' },
    adapterRequest: { method: 'POST', path: '/proxy/gemini/async', headers: {} },
  };
}

describe('aiJobsStore', () => {
  beforeEach(() => {
    resetAiJobsStateForTests();
    vi.mocked(listMyAiJobs).mockReset();
    vi.mocked(getMyAiJob).mockReset();
    vi.mocked(cancelMyAiJob).mockReset();
    vi.mocked(retryMyAiJob).mockReset();
  });

  it('refreshes recent jobs and indexes them by id', async () => {
    const item = makeSummary('aijob_store_1', 'queued');
    vi.mocked(listMyAiJobs).mockResolvedValue({ items: [item], limit: 20 });

    await refreshMyAiJobs();

    const state = getAiJobsSnapshot();
    expect(listMyAiJobs).toHaveBeenCalledWith({ limit: 20 });
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([item]);
    expect(state.byId.aijob_store_1).toEqual(item);
    expect(state.lastLoadedAt).toBeTruthy();
  });

  it('treats malformed list payloads as an empty list', async () => {
    vi.mocked(listMyAiJobs).mockResolvedValue({ limit: 20 } as any);

    await expect(refreshMyAiJobs()).resolves.toEqual([]);

    const state = getAiJobsSnapshot();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.items).toEqual([]);
    expect(state.byId).toEqual({});
  });

  it('stores refresh errors without clearing existing items', async () => {
    const item = makeSummary('aijob_store_keep', 'running');
    upsertAiJobSummary(item);
    vi.mocked(listMyAiJobs).mockRejectedValue(new Error('offline'));

    await expect(refreshMyAiJobs()).rejects.toThrow('offline');

    const state = getAiJobsSnapshot();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('offline');
    expect(state.items[0]).toEqual(item);
  });

  it('refreshes one job detail and updates list state', async () => {
    upsertAiJobSummary(makeSummary('aijob_store_detail', 'running'));
    const detail = makeDetail('aijob_store_detail', 'succeeded');
    vi.mocked(getMyAiJob).mockResolvedValue(detail);

    await refreshMyAiJob('aijob_store_detail');

    const state = getAiJobsSnapshot();
    expect(getMyAiJob).toHaveBeenCalledWith('aijob_store_detail');
    expect(state.byId.aijob_store_detail.status).toBe('succeeded');
    expect(state.items[0].status).toBe('succeeded');
    expect(state.detailsById.aijob_store_detail).toEqual(detail);
    expect(state.refreshingJobIds.aijob_store_detail).toBeUndefined();
  });

  it('notifies subscribers on state changes', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiJobs(listener);
    upsertAiJobSummary(makeSummary('aijob_store_sub'));
    unsubscribe();
    upsertAiJobSummary(makeSummary('aijob_store_after_unsub'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('updates local state after cancel and prepends retry jobs', async () => {
    upsertAiJobSummary(makeSummary('aijob_store_cancel', 'running'));
    const cancelled = makeDetail('aijob_store_cancel', 'cancelled');
    vi.mocked(cancelMyAiJob).mockResolvedValueOnce(cancelled);

    await cancelAiJob('aijob_store_cancel');
    expect(cancelMyAiJob).toHaveBeenCalledWith('aijob_store_cancel');
    expect(getAiJobsSnapshot().byId.aijob_store_cancel.status).toBe('cancelled');

    const retry = makeDetail('aijob_store_retry', 'created');
    vi.mocked(retryMyAiJob).mockResolvedValueOnce(retry);
    await retryAiJob('aijob_store_cancel', { id: 'aijob_store_retry' });

    const snap = getAiJobsSnapshot();
    expect(retryMyAiJob).toHaveBeenCalledWith('aijob_store_cancel', { id: 'aijob_store_retry' });
    expect(snap.items[0].id).toBe('aijob_store_retry');
    expect(snap.detailsById.aijob_store_retry.job.id).toBe('aijob_store_retry');
  });
});
