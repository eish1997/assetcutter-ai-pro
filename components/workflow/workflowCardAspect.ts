import { readSessionJson, writeSessionJson } from '../../services/clientPersist';

const WORKFLOW_CARD_ASPECT_SESSION_KEY = 'ac:workflowCardAspect';

export function readSessionWorkflowCardAspects(): Record<string, number> {
  return readSessionJson(WORKFLOW_CARD_ASPECT_SESSION_KEY, {}, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  });
}

export function persistWorkflowCardAspects(record: Record<string, number>): void {
  writeSessionJson(WORKFLOW_CARD_ASPECT_SESSION_KEY, record);
}

export function clampWorkflowCardAspectRatio(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.max(0.5, Math.min(2, w / h));
}

/** 约定宽高比夹在 [1:2, 2:1]；允许用 1 修正 session/占位错误写入的默认方图 */
export function mergeCardAspectFromIntrinsic(
  prev: Record<string, number>,
  key: string,
  w: number,
  h: number
): Record<string, number> | null {
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = clampWorkflowCardAspectRatio(w, h);
  const cur = prev[key];
  if (cur != null && cur !== 1) return null;
  if (cur === 1 && Math.abs(ratio - 1) < 0.08) return null;
  if (cur === ratio) return null;
  return { ...prev, [key]: ratio };
}
