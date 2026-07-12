import { describe, expect, it } from 'vitest';
import {
  aiJobStatusLabel,
  canCancelAiJobStatus,
  canRetryAiJobStatus,
} from '../services/aiJobDisplay';

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
});
