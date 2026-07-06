import type { UsageGeminiMetadata, UsageMeterKind } from '../shared/usageBilling';
import { fmtCredits, usdEstToCredits } from '../shared/credits';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';
import type { UsageEventRow } from './adminClient';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from './usageCost';

export type UsageSummarySlice = {
  eventCount: number;
  totalQuantity: number;
  totalCostUsdEst: number;
  totalCreditsCharged?: number;
  bySku: Array<{
    billingSku: string;
    count: number;
    quantity: number;
    costUsdEst: number;
    creditsCharged?: number;
  }>;
};

export type UserUsageSummary = UsageSummarySlice & {
  today: UsageSummarySlice;
  month: UsageSummarySlice;
  projectId?: string | null;
};

export type UsageEventsQuery = {
  limit?: number;
  billingSku?: string;
  provider?: string;
  projectId?: string;
  workflowStepId?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

type UsageEventsResponse = {
  events: UsageEventRow[];
  total?: number;
  limit?: number;
  nextCursor?: string | null;
};

export async function fetchUserUsageSummary(query: {
  from?: string;
  to?: string;
  projectId?: string;
} = {}): Promise<UserUsageSummary> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.projectId) params.set('projectId', query.projectId);
  const qs = params.toString();
  return requestJson<UserUsageSummary>(apiUrl(`/api/usage/summary${qs ? `?${qs}` : ''}`));
}

export async function fetchUserUsageEvents(query: UsageEventsQuery = {}): Promise<UsageEventsResponse> {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.billingSku) params.set('billingSku', query.billingSku);
  if (query.provider) params.set('provider', query.provider);
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.workflowStepId) params.set('workflowStepId', query.workflowStepId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.cursor) params.set('cursor', query.cursor);
  return requestJson<UsageEventsResponse>(apiUrl(`/api/usage/events/list?${params.toString()}`));
}

export function userUsageExportUrl(query: { from?: string; to?: string; projectId?: string } = {}): string {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.projectId) params.set('projectId', query.projectId);
  const qs = params.toString();
  return apiUrl(`/api/usage/events/export${qs ? `?${qs}` : ''}`);
}

export function fmtUsageCostUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (v < 0.01) return '<$0.01';
  return `$${v.toFixed(4)}`;
}

/** 汇总卡片：有事件但合计为 0 时避免误导性「$0」。 */
export function fmtUsageSummaryCost(
  totalCostUsdEst: number | null | undefined,
  eventCount = 0
): string {
  if (eventCount <= 0) return '—';
  if (totalCostUsdEst != null && totalCostUsdEst > 0) return fmtUsageCostUsd(totalCostUsdEst);
  return '—';
}

/** 汇总卡片：积分消耗合计 */
export function fmtUsageSummaryCredits(
  totalCreditsCharged: number | null | undefined,
  eventCount = 0
): string {
  if (eventCount <= 0) return '—';
  const n = Math.floor(Number(totalCreditsCharged) || 0);
  return fmtCredits(n);
}

export function usageEventCredits(
  ev: Pick<UsageEventRow, 'creditsCharged' | 'costUsdEst' | 'meta' | 'idempotencyKey'>
): number {
  if (isUsageEventByok(ev)) return 0;
  if (ev.creditsCharged != null && ev.creditsCharged > 0) return Math.floor(ev.creditsCharged);
  return usdEstToCredits(ev.costUsdEst);
}

export function fmtUsageEventCredits(
  ev: Pick<UsageEventRow, 'creditsCharged' | 'costUsdEst' | 'meta' | 'idempotencyKey'>
): string {
  if (isUsageEventByok(ev)) return '自备 Key';
  const credits = usageEventCredits(ev);
  return credits > 0 ? fmtCredits(credits) : '—';
}

export function sumUsageEventsCredits(events: UsageEventRow[]): number {
  return events.reduce((sum, ev) => sum + usageEventCredits(ev), 0);
}

export function fmtUsageGroupCredits(events: UsageEventRow[]): string {
  if (events.length > 0 && events.every(isUsageEventByok)) return '自备 Key';
  const total = sumUsageEventsCredits(events);
  return total > 0 ? fmtCredits(total) : '—';
}

export function sliceCreditsTotal(slice: UsageSummarySlice): number {
  if (slice.totalCreditsCharged != null && slice.totalCreditsCharged >= 0) {
    return Math.floor(slice.totalCreditsCharged);
  }
  return slice.bySku.reduce((sum, row) => sum + Math.floor(Number(row.creditsCharged) || 0), 0);
}

export function usageEventTokenTotals(
  ev: Pick<UsageEventRow, 'meterKind' | 'quantity' | 'quantityIn' | 'quantityOut' | 'meta'>
): { in: number; out: number; total: number } {
  const meta = ev.meta as
    | { usagePart?: 'input' | 'output'; outputKind?: string; usageMetadata?: UsageGeminiMetadata }
    | null
    | undefined;
  let inn = Math.max(0, Number(ev.quantityIn) || 0);
  let out = Math.max(0, Number(ev.quantityOut) || 0);
  let total = 0;
  const um = meta?.usageMetadata;
  if (um && typeof um === 'object') {
    if (!inn) inn = Math.max(0, Number(um.promptTokenCount) || 0);
    if (!out) out = Math.max(0, Number(um.candidatesTokenCount) || 0);
    total = Math.max(0, Number(um.totalTokenCount) || inn + out);
  }
  if (ev.meterKind === 'token') {
    if (!total) total = Math.max(0, Number(ev.quantity) || 0);
  }
  if (!total && (inn || out)) total = inn + out;

  if (meta?.usagePart === 'input') {
    return { in: inn, out: 0, total: inn };
  }
  if (meta?.usagePart === 'output') {
    if (ev.meterKind === 'image' || meta.outputKind === 'image') {
      return { in: 0, out: 0, total: 0 };
    }
    return { in: 0, out, total: out };
  }
  return { in: inn, out, total };
}

export function sumUsageEventTokenTotals(
  events: Array<Pick<UsageEventRow, 'meterKind' | 'quantity' | 'quantityIn' | 'quantityOut' | 'meta'>>
): { in: number; out: number; total: number } {
  return events.reduce(
    (acc, ev) => {
      const t = usageEventTokenTotals(ev);
      return { in: acc.in + t.in, out: acc.out + t.out, total: acc.total + t.total };
    },
    { in: 0, out: 0, total: 0 }
  );
}

export function fmtUsageTokenTotals(totals: { in: number; out: number; total: number }): string {
  if (totals.in > 0 || totals.out > 0) {
    return `${totals.in.toLocaleString()} in / ${totals.out.toLocaleString()} out`;
  }
  if (totals.total > 0) return `${totals.total.toLocaleString()} token`;
  return '未回传';
}

export function sumUsageImageOutputCount(
  events: Array<Pick<UsageEventRow, 'meterKind' | 'quantity' | 'meta'>>
): number {
  return events.reduce((acc, ev) => {
    const part = (ev.meta as { usagePart?: string; outputKind?: string } | null | undefined)?.usagePart;
    if (ev.meterKind === 'image' && (part === 'output' || !part)) {
      return acc + Math.max(0, Number(ev.quantity) || 0);
    }
    if (part === 'output' && (ev.meta as { outputKind?: string })?.outputKind === 'image') {
      return acc + Math.max(0, Number(ev.quantity) || 0);
    }
    return acc;
  }, 0);
}

export function fmtUsageGroupMeterSummary(events: UsageEventRow[]): string {
  const tokens = sumUsageEventTokenTotals(events);
  const images = sumUsageImageOutputCount(events);
  const parts: string[] = [];
  if (tokens.in > 0) parts.push(`输入 ${tokens.in.toLocaleString()} token`);
  if (tokens.out > 0) parts.push(`输出 ${tokens.out.toLocaleString()} token`);
  if (images > 0) parts.push(`输出 ${images} 张`);
  if (parts.length) return parts.join(' · ');
  return fmtUsageTokenTotals(tokens);
}

/** 计量列：按 usagePart 区分输入/输出；兼容旧单条记录。 */
export function fmtUsageQuantity(
  ev: Pick<UsageEventRow, 'meterKind' | 'quantity' | 'quantityIn' | 'quantityOut' | 'meta'>
): string {
  const meta = ev.meta as { usagePart?: 'input' | 'output'; outputKind?: string } | null | undefined;
  if (meta?.usagePart === 'input') {
    const inn = usageEventTokenTotals(ev).in;
    return inn > 0 ? `输入 ${inn.toLocaleString()} token` : '输入 · 未回传';
  }
  if (meta?.usagePart === 'output') {
    if (ev.meterKind === 'image' || meta.outputKind === 'image') {
      const n = Math.max(0, Number(ev.quantity) || 0);
      return n > 0 ? `输出 ${n} 张` : '输出 · 未回传';
    }
    const out = usageEventTokenTotals(ev).out;
    return out > 0 ? `输出 ${out.toLocaleString()} token` : '输出 · 未回传';
  }
  const totals = usageEventTokenTotals(ev);
  const formatted = fmtUsageTokenTotals(totals);
  if (formatted !== '未回传') return formatted;
  if (ev.meterKind === 'image') {
    const n = Math.max(0, Number(ev.quantity) || 0);
    return n > 0 ? `输出 ${n} 张` : '生图 · 未回传';
  }
  return '未回传';
}

export function resolveUsageTaskGroupId(ev: UsageEventRow): string {
  const meta = ev.meta as { taskId?: string } | null | undefined;
  const workflowTaskId = String(meta?.taskId || '').trim();
  if (workflowTaskId) return workflowTaskId;
  return `__singleton__:${ev.id}`;
}

export function usageTaskGroupDisplayId(groupId: string, sample?: UsageEventRow): string {
  if (!groupId.startsWith('__singleton__')) return groupId;
  const req = String(sample?.requestId || sample?.idempotencyKey || '').trim();
  return req || '—';
}

export type UsageTaskGroup = {
  groupId: string;
  displayTaskId: string;
  events: UsageEventRow[];
  tokenTotals: { in: number; out: number; total: number };
  latestAt: string;
};

export function groupUsageEventsByTask(events: UsageEventRow[]): UsageTaskGroup[] {
  const map = new Map<string, UsageEventRow[]>();
  for (const ev of events) {
    const gid = resolveUsageTaskGroupId(ev);
    const list = map.get(gid) || [];
    list.push(ev);
    map.set(gid, list);
  }
  const groups: UsageTaskGroup[] = [];
  for (const [groupId, evs] of map.entries()) {
    const sorted = [...evs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    groups.push({
      groupId,
      displayTaskId: usageTaskGroupDisplayId(groupId, sorted[0]),
      events: sorted,
      tokenTotals: sumUsageEventTokenTotals(sorted),
      latestAt: sorted[0]?.createdAt || '',
    });
  }
  return groups.sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
}

export function resolveUsageEventCostUsd(
  ev: Pick<
    UsageEventRow,
    'billingSku' | 'meterKind' | 'quantityIn' | 'quantityOut' | 'quantity' | 'costUsdEst' | 'meta'
  >
): number | null {
  const meta = ev.meta as { usagePart?: string } | null | undefined;
  const ref = computeReferenceCostUsd(ev);
  if (meta?.usagePart && ref != null && ref > 0) return ref;
  if (ev.costUsdEst != null && Number.isFinite(ev.costUsdEst) && ev.costUsdEst > 0) {
    return ev.costUsdEst;
  }
  return ref;
}

export function fmtUsageGroupEstimate(events: UsageEventRow[]): string {
  let sum = 0;
  let hasPriced = false;
  let byokOnly = events.length > 0;
  for (const ev of events) {
    if (isUsageEventByok(ev)) continue;
    byokOnly = false;
    const priced = resolveUsageEventCostUsd(ev);
    if (priced != null && priced > 0) {
      sum += priced;
      hasPriced = true;
    }
  }
  if (byokOnly) return '自备 Key';
  if (hasPriced) return fmtUsageCostUsd(sum);
  return '—';
}

/** 本站代理记账（gemini-async 等）即使历史 meta 误标 byok 也不按自备 Key 展示。 */
export function isUsageEventByok(ev: Pick<UsageEventRow, 'meta' | 'idempotencyKey'>): boolean {
  if (!(ev.meta && (ev.meta as { byok?: boolean }).byok)) return false;
  const key = String(ev.idempotencyKey || '');
  if (key.startsWith('gemini-async:')) return false;
  return true;
}

export function computeReferenceCostUsd(
  ev: Pick<
    UsageEventRow,
    'billingSku' | 'meterKind' | 'quantityIn' | 'quantityOut' | 'quantity' | 'meta'
  >
): number | null {
  const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, ev.billingSku);
  const meta = ev.meta as { usagePart?: string; outputKind?: string } | null | undefined;
  return estimateUsageCostUsd(entry, {
    meterKind: ev.meterKind as UsageMeterKind,
    quantityIn: ev.quantityIn,
    quantityOut: ev.quantityOut,
    quantity: ev.quantity,
    imageOutputTokens:
      meta?.usagePart === 'output' &&
      ev.meterKind === 'token' &&
      (meta?.outputKind === 'token' || meta?.outputKind === 'image'),
  });
}

export function fmtUsageEstimateCell(ev: UsageEventRow): string {
  if (isUsageEventByok(ev)) return '自备 Key';
  const priced = resolveUsageEventCostUsd(ev);
  if (priced != null && priced > 0) return fmtUsageCostUsd(priced);
  if (ev.costUsdEst === 0) return '$0';
  return '—';
}
