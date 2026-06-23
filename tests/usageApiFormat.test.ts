import { describe, expect, it } from 'vitest';
import type { UsageEventRow } from '../services/adminClient';
import {
  computeReferenceCostUsd,
  fmtUsageEstimateCell,
  fmtUsageGroupEstimate,
  fmtUsageGroupMeterSummary,
  fmtUsageQuantity,
  fmtUsageSummaryCost,
  groupUsageEventsByTask,
  isUsageEventByok,
  resolveUsageTaskGroupId,
  sumUsageEventTokenTotals,
} from '../services/usageApi';

function ev(partial: Partial<UsageEventRow> & Pick<UsageEventRow, 'billingSku' | 'meterKind' | 'unit'>): UsageEventRow {
  return {
    id: partial.id || '1',
    userId: 'u1',
    idempotencyKey: partial.idempotencyKey || 'gemini-async:job-1',
    provider: 'vertex',
    billingSku: partial.billingSku,
    meterKind: partial.meterKind,
    quantity: partial.quantity ?? 0,
    quantityIn: partial.quantityIn ?? 0,
    quantityOut: partial.quantityOut ?? 0,
    unit: partial.unit,
    costUsdEst: partial.costUsdEst ?? null,
    costConfidence: partial.costConfidence ?? 'estimated',
    status: 'succeeded',
    createdAt: partial.createdAt || new Date().toISOString(),
    ...partial,
  };
}

describe('usageApi formatters', () => {
  it('recomputes 4K image output estimate from catalog', () => {
    const row = ev({
      billingSku: 'image.gemini.pro',
      meterKind: 'token',
      unit: 'token',
      quantityOut: 2000,
      costUsdEst: null,
      meta: { usagePart: 'output', outputKind: 'token' },
    });
    expect(computeReferenceCostUsd(row)).toBeCloseTo(0.24, 5);
  });

  it('shows unread token hint when metadata missing', () => {
    expect(fmtUsageQuantity(ev({ billingSku: 'llm.gemini.flash', meterKind: 'token', unit: 'token' }))).toBe(
      '未回传'
    );
  });

  it('shows image output count for legacy rows without usagePart', () => {
    expect(
      fmtUsageQuantity(
        ev({
          billingSku: 'image.gemini.pro',
          meterKind: 'image',
          unit: 'image',
          quantity: 1,
        })
      )
    ).toBe('输出 1 张');
  });

  it('shows input/output parts for composite image billing rows', () => {
    expect(
      fmtUsageQuantity(
        ev({
          billingSku: 'image.gemini.flash',
          meterKind: 'token',
          unit: 'token',
          quantityIn: 500,
          meta: { usagePart: 'input' },
        })
      )
    ).toBe('输入 500 token');
    expect(
      fmtUsageQuantity(
        ev({
          billingSku: 'image.gemini.flash',
          meterKind: 'image',
          unit: 'image',
          quantity: 1,
          meta: { usagePart: 'output', outputKind: 'image' },
        })
      )
    ).toBe('输出 1 张');
  });

  it('aggregates composite group meter summary', () => {
    const taskId = 'task-composite';
    const rows = [
      ev({
        billingSku: 'image.gemini.flash',
        meterKind: 'token',
        unit: 'token',
        quantityIn: 300,
        meta: { taskId, usagePart: 'input' },
      }),
      ev({
        billingSku: 'image.gemini.flash',
        meterKind: 'image',
        unit: 'image',
        quantity: 1,
        meta: { taskId, usagePart: 'output', outputKind: 'image' },
      }),
    ];
    expect(fmtUsageGroupMeterSummary(rows)).toBe('输入 300 token · 输出 1 张');
    expect(sumUsageEventTokenTotals(rows)).toEqual({ in: 300, out: 0, total: 300 });
  });

  it('formats token counts with locale grouping', () => {
    expect(
      fmtUsageQuantity(
        ev({
          billingSku: 'llm.gemini.flash',
          meterKind: 'token',
          unit: 'token',
          quantityIn: 1200,
          quantityOut: 50,
        })
      )
    ).toContain('1,200');
  });

  it('groups events by workflow taskId in meta', () => {
    const taskId = 'wf-task-abc';
    const rows = [
      ev({
        id: 'a',
        billingSku: 'llm.gemini.flash',
        meterKind: 'token',
        unit: 'token',
        quantityIn: 100,
        quantityOut: 20,
        meta: { taskId },
        createdAt: '2026-06-19T10:00:00.000Z',
      }),
      ev({
        id: 'b',
        billingSku: 'image.gemini.pro',
        meterKind: 'image',
        unit: 'image',
        quantity: 1,
        meta: { taskId },
        createdAt: '2026-06-19T10:01:00.000Z',
      }),
    ];
    const groups = groupUsageEventsByTask(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupId).toBe(taskId);
    expect(groups[0]!.events).toHaveLength(2);
    expect(sumUsageEventTokenTotals(groups[0]!.events)).toEqual({ in: 100, out: 20, total: 120 });
  });

  it('isolates events without taskId', () => {
    const rows = [
      ev({ id: 'a', billingSku: 'llm.gemini.flash', meterKind: 'token', unit: 'token' }),
      ev({ id: 'b', billingSku: 'llm.gemini.flash', meterKind: 'token', unit: 'token' }),
    ];
    expect(groupUsageEventsByTask(rows)).toHaveLength(2);
    expect(resolveUsageTaskGroupId(rows[0]!)).not.toBe(resolveUsageTaskGroupId(rows[1]!));
  });

  it('ignores legacy byok meta on gemini-async proxy rows', () => {
    const row = ev({
      billingSku: 'image.gemini.pro',
      meterKind: 'image',
      unit: 'image',
      quantity: 1,
      meta: { byok: true },
      costUsdEst: null,
    });
    expect(isUsageEventByok(row)).toBe(false);
    expect(fmtUsageEstimateCell(row)).not.toBe('自备 Key');
    expect(computeReferenceCostUsd(row)).toBeGreaterThan(0);
  });

  it('shows 自备 Key for explicit byok non-proxy rows', () => {
    const row = ev({
      idempotencyKey: 'user-direct:abc',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      unit: 'token',
      meta: { byok: true },
      costUsdEst: null,
    });
    expect(fmtUsageEstimateCell(row)).toBe('自备 Key');
  });

  it('prefers catalog recompute for composite rows with stale stored cost', () => {
    const row = ev({
      billingSku: 'image.gemini.pro',
      meterKind: 'token',
      unit: 'token',
      quantityOut: 2000,
      costUsdEst: 0.024,
      meta: { usagePart: 'output', outputKind: 'token' },
    });
    expect(fmtUsageEstimateCell(row)).toBe('$0.2400');
  });

  it('aggregates group estimate', () => {
    const taskId = 'task-1';
    const rows = [
      ev({
        billingSku: 'image.gemini.flash',
        meterKind: 'image',
        unit: 'image',
        quantity: 1,
        meta: { taskId },
      }),
      ev({
        billingSku: 'image.gemini.flash',
        meterKind: 'image',
        unit: 'image',
        quantity: 1,
        meta: { taskId },
      }),
    ];
    expect(fmtUsageGroupEstimate(rows)).not.toBe('—');
  });

  it('summary cost shows dash when events exist but total is zero', () => {
    expect(fmtUsageSummaryCost(0, 3)).toBe('—');
    expect(fmtUsageSummaryCost(0.12, 2)).toBe('$0.1200');
  });
});
