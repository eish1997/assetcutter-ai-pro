import { describe, expect, it } from 'vitest';
import {
  clearCorrelationContext,
  peekCorrelationContext,
  setCorrelationContext,
} from '../services/observability/correlationContext';

describe('correlationContext', () => {
  it('stores and clears correlation fields', () => {
    setCorrelationContext({
      correlationId: 'task-abc',
      projectId: 'proj-1',
      assetId: 'asset-1',
      actionType: 'preset-id',
    });
    expect(peekCorrelationContext()).toEqual({
      correlationId: 'task-abc',
      projectId: 'proj-1',
      assetId: 'asset-1',
      actionType: 'preset-id',
    });
    clearCorrelationContext();
    expect(peekCorrelationContext()).toEqual({});
  });

  it('stores auditEventId for usage audit_log_id merge', () => {
    setCorrelationContext({
      correlationId: 'task-xyz',
      auditEventId: 'wa_abc123',
      actionType: 'preset-1',
    });
    expect(peekCorrelationContext().auditEventId).toBe('wa_abc123');
    clearCorrelationContext();
  });
});
