/**
 * L5 定价读模型 — 依赖 usage-billing / credit-store，避免 pricing-engine 循环引用。
 */
import { usdEstToCredits } from './credits-math.js';
import { creditsForEvent } from './credit-store.js';
import { listUsageEventsForUser } from './usage-billing-store.js';
import { quoteGateMinCreditsForJob, listPublicPriceCatalog } from './pricing-engine.js';

export { listPublicPriceCatalog, quoteGateMinCreditsForJob };

const JOB_KIND_LABELS = {
  workflow_understand: '工作流 · 理解',
  workflow_text_to_image: '工作流 · 生图',
  workflow_image_edit: '工作流 · 改图',
  workflow_chat: '工作流 · 对话',
  workflow_generate_3d: '工作流 · 3D',
  workflow_generate_video: '工作流 · 视频',
  workflow_jimeng_image: '即梦 · 生图',
  workflow_jimeng_video: '即梦 · 视频',
  workflow_jimeng_digital_human: '即梦 · 数字人',
};

const SKU_PRESENTATION = {
  'llm.gemini.flash': { label: 'Gemini 2.5 Flash 文本' },
  'llm.gemini.pro': { label: 'Gemini 2.5 Pro 文本' },
  'image.gemini.flash': { label: 'Gemini Flash 生图' },
  'image.gemini.pro': { label: 'Gemini Pro 生图' },
};

function presentationForSku(billingSku) {
  const sku = String(billingSku || '').trim();
  return SKU_PRESENTATION[sku]?.label || sku || '—';
}

function jobKindLabel(jobKind) {
  const kind = String(jobKind || '').trim();
  return JOB_KIND_LABELS[kind] || kind || '—';
}

export function quoteJobKinds(jobKinds) {
  const unique = [
    ...new Set((Array.isArray(jobKinds) ? jobKinds : []).map((k) => String(k || '').trim()).filter(Boolean)),
  ];
  const steps = unique.map((jobKind) => ({
    jobKind,
    minCredits: quoteGateMinCreditsForJob(jobKind),
    label: jobKindLabel(jobKind),
  }));
  const totalMinCredits = steps.reduce((sum, s) => sum + s.minCredits, 0);
  return { steps, totalMinCredits };
}

function usageEventMatchesTaskId(row, taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return false;
  if (String(row.upstreamTaskId || '') === tid) return true;
  if (String(row.requestId || '') === tid) return true;
  const rid = String(row.requestId || '');
  if (rid && rid.startsWith(tid)) return true;
  const meta = row.meta;
  if (meta && typeof meta === 'object') {
    if (String(meta.taskId || '') === tid) return true;
    if (String(meta.correlationId || '') === tid) return true;
  }
  return false;
}

function meterSummaryForEvent(ev) {
  const meta = ev?.meta && typeof ev.meta === 'object' ? ev.meta : null;
  if (meta?.usagePart === 'input') {
    const inn = Math.max(0, Number(ev.quantityIn) || 0);
    return inn > 0 ? `输入 ${inn.toLocaleString()} token` : '输入 · 未回传';
  }
  if (meta?.usagePart === 'output') {
    if (ev.meterKind === 'image' || meta.outputKind === 'image') {
      const n = Math.max(0, Number(ev.quantity) || 0);
      return n > 0 ? `输出 ${n} 张` : '输出 · 未回传';
    }
    const out = Math.max(0, Number(ev.quantityOut) || 0);
    return out > 0 ? `输出 ${out.toLocaleString()} token` : '输出 · 未回传';
  }
  if (ev.meterKind === 'image') {
    const n = Math.max(0, Number(ev.quantity) || 0);
    return n > 0 ? `输出 ${n} 张` : '生图 · 未回传';
  }
  if (ev.meterKind === 'task') {
    const n = Math.max(0, Number(ev.quantity) || 0);
    return n > 0 ? `${n} 次` : '任务 · 未回传';
  }
  const inn = Math.max(0, Number(ev.quantityIn) || 0);
  const out = Math.max(0, Number(ev.quantityOut) || 0);
  if (inn > 0 || out > 0) {
    return `${inn.toLocaleString()} in / ${out.toLocaleString()} out`;
  }
  const total = Math.max(0, Number(ev.quantity) || 0);
  if (total > 0) return `${total.toLocaleString()} token`;
  return '未回传';
}

function presentationLabelForEvent(ev) {
  const sku = String(ev?.billingSku || '').trim();
  if (!sku) return '—';
  const base = presentationForSku(sku);
  const meta = ev?.meta && typeof ev.meta === 'object' ? ev.meta : null;
  if (meta?.byok) return `${base}（自备 Key）`;
  if (meta?.usagePart === 'input') return `${base} · 输入`;
  if (meta?.usagePart === 'output') return `${base} · 输出`;
  return base;
}

function eventCredits(ev) {
  if (ev?.meta?.byok === true) return 0;
  if (ev.creditsCharged != null && ev.creditsCharged > 0) return Math.floor(ev.creditsCharged);
  const fromStore = creditsForEvent(ev);
  if (fromStore > 0) return fromStore;
  if (ev.costUsdEst != null && Number.isFinite(Number(ev.costUsdEst)) && Number(ev.costUsdEst) > 0) {
    return usdEstToCredits(ev.costUsdEst);
  }
  return 0;
}

export async function buildUsageReceipt(userId, taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return null;

  const { events: exactEvents } = await listUsageEventsForUser(userId, {
    correlationId: tid,
    limit: 100,
  });

  let events = exactEvents;
  if (!events.length) {
    const { events: recent } = await listUsageEventsForUser(userId, { limit: 500 });
    events = recent.filter((ev) => usageEventMatchesTaskId(ev, tid));
  }

  events = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const lines = events.map((ev) => ({
    label: presentationLabelForEvent(ev),
    billingSku: ev.billingSku,
    credits: eventCredits(ev),
    meterSummary: meterSummaryForEvent(ev),
  }));

  const totalCredits = lines.reduce((sum, line) => sum + line.credits, 0);

  return {
    taskId: tid,
    totalCredits,
    lines,
  };
}
