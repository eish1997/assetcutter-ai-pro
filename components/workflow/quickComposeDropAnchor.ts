import type { QuickComposeDropAnchor, QuickComposeSegment } from '../../services/quickComposeMention';

export type DropCaretPreview = { left: number; top: number; height: number };

function measureTextPrefixWidth(
  el: HTMLInputElement | HTMLTextAreaElement,
  prefix: string
): number {
  const style = getComputedStyle(el);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return ctx.measureText(prefix).width;
}

export function caretOffsetFromClientX(
  el: HTMLInputElement | HTMLTextAreaElement,
  clientX: number
): number {
  const text = el.value;
  if (!text.length) return 0;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, clientX - rect.left);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= text.length; i += 1) {
    const w = measureTextPrefixWidth(el, text.slice(0, i));
    const dist = Math.abs(w - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function resolveDropAnchorAtPoint(
  clientX: number,
  clientY: number,
  rowEl: HTMLElement,
  segments: QuickComposeSegment[],
  inputRefs: Map<string, HTMLInputElement | HTMLTextAreaElement>
): { anchor: QuickComposeDropAnchor; caret: DropCaretPreview } | null {
  const hit = document.elementFromPoint(clientX, clientY);
  let segEl = hit?.closest('[data-qc-seg-id]') as HTMLElement | null;

  if (!segEl) {
    const nodes = Array.from(rowEl.querySelectorAll('[data-qc-seg-id]')) as HTMLElement[];
    let best: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (clientY < r.top - 8 || clientY > r.bottom + 8) continue;
      const dist = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    segEl = best;
  }

  if (!segEl) {
    const nodes = Array.from(rowEl.querySelectorAll('[data-qc-seg-id]')) as HTMLElement[];
    if (nodes.length === 0) return null;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const fr = first.getBoundingClientRect();
    if (clientX < fr.left) {
      const id = first.dataset.qcSegId!;
      const r = first.getBoundingClientRect();
      return { anchor: { mode: 'before', segmentId: id }, caret: { left: r.left, top: r.top, height: r.height } };
    }
    const lr = last.getBoundingClientRect();
    if (clientX > lr.right) {
      const id = last.dataset.qcSegId!;
      return { anchor: { mode: 'after', segmentId: id }, caret: { left: lr.right, top: lr.top, height: lr.height } };
    }
    return null;
  }

  const segId = segEl.dataset.qcSegId!;
  const seg = segments.find((s) => s.id === segId);
  if (!seg) return null;

  if (seg.type === 'text') {
    const input = inputRefs.get(segId);
    if (!input) return null;
    const offset = caretOffsetFromClientX(input, clientX);
    const rect = input.getBoundingClientRect();
    const caretLeft = rect.left + measureTextPrefixWidth(input, input.value.slice(0, offset));
    return {
      anchor: { mode: 'text', segmentId: segId, offset },
      caret: { left: caretLeft, top: rect.top, height: rect.height },
    };
  }

  const r = segEl.getBoundingClientRect();
  const mid = r.left + r.width / 2;
  if (clientX < mid) {
    return {
      anchor: { mode: 'before', segmentId: segId },
      caret: { left: r.left, top: r.top, height: r.height },
    };
  }
  return {
    anchor: { mode: 'after', segmentId: segId },
    caret: { left: r.right, top: r.top, height: r.height },
  };
}
