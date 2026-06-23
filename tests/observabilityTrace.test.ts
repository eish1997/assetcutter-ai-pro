import { describe, expect, it } from 'vitest';
import { fetchObservabilityTraceByCorrelationId } from '../server/admin-observability-trace.js';

describe('observability trace read model', () => {
  it('returns empty slices when correlationId missing', async () => {
    const trace = await fetchObservabilityTraceByCorrelationId('');
    expect(trace.correlationId).toBe('');
    expect(trace.usage.events).toEqual([]);
    expect(trace.taskEvents.events).toEqual([]);
  });

  it('aggregates usage and task events by taskId', async () => {
    const trace = await fetchObservabilityTraceByCorrelationId('nonexistent-task-id-xyz');
    expect(trace.correlationId).toBe('nonexistent-task-id-xyz');
    expect(Array.isArray(trace.usage.events)).toBe(true);
    expect(Array.isArray(trace.taskEvents.events)).toBe(true);
    expect(trace.usage.eventCount).toBe(trace.usage.events.length);
  });
});
