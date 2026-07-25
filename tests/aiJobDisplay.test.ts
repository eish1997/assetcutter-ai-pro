import { describe, expect, it } from 'vitest';
import {
  aiJobMediaArchiveStatus,
  aiJobMediaArchiveUserHint,
  aiJobStatusLabel,
  canCancelAiJobStatus,
  canRetryAiJobStatus,
} from '../services/aiJobDisplay';
import type { AiJobSummary } from '../services/aiJobsClient';

function jobStub(partial: Partial<AiJobSummary>): AiJobSummary {
  return {
    id: 'j1',
    status: 'succeeded',
    modality: 'image',
    capability: 'image.generate',
    provider: null,
    model: null,
    userId: null,
    correlationId: 'c',
    createdAt: '',
    updatedAt: '',
    startedAt: null,
    finishedAt: null,
    route: null,
    traceOnly: false,
    proxyPath: null,
    proxyJobId: null,
    creditsGate: null,
    error: null,
    ...partial,
  };
}

describe('aiJobDisplay', () => {
  it('keeps user actions aligned with terminal and active states', () => {
    expect(canCancelAiJobStatus('created')).toBe(true);
    expect(canCancelAiJobStatus('queued')).toBe(true);
    expect(canCancelAiJobStatus('running')).toBe(true);
    expect(canCancelAiJobStatus('succeeded')).toBe(false);
    expect(canCancelAiJobStatus('failed')).toBe(false);

    expect(canRetryAiJobStatus('failed')).toBe(true);
    expect(canRetryAiJobStatus('cancelled')).toBe(true);
    expect(canRetryAiJobStatus('running')).toBe(false);
  });

  it('maps gateway status labels consistently', () => {
    expect(aiJobStatusLabel('queued')).toBe('排队中');
    expect(aiJobStatusLabel('succeeded')).toBe('成功');
  });

  it('D7: mediaArchive skipped is list-scannable and user-hinted', () => {
    expect(aiJobMediaArchiveStatus(jobStub({ mediaArchive: { status: 'ok' } }))).toBe('ok');
    expect(aiJobMediaArchiveStatus(jobStub({ mediaArchive: { status: 'skipped' } }))).toBe('skipped');
    expect(aiJobMediaArchiveUserHint(jobStub({ mediaArchive: { status: 'skipped' } }))).toMatch(/未归档/);
    expect(aiJobMediaArchiveUserHint(jobStub({ mediaArchive: { status: 'ok' } }))).toBeNull();
  });
});
