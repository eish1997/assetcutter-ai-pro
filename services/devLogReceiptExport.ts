import type { DevLogEntry } from '../types/devLog';
import { buildDayReceiptSummary } from './devLogClient';

const RECEIPT_W = 340;
const PAD_X = 22;
const CONTENT_W = RECEIPT_W - PAD_X * 2;

function shortSha(sha: string) {
  return String(sha || '').slice(0, 7);
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

function formatDayLabel(dayKey: string) {
  const m = String(dayKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dayKey;
  return `${m[1]} 年 ${m[2]} 月 ${m[3]} 日`;
}

function wrapByWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const chars = Array.from(String(text || ''));
  const lines: string[] = [];
  let cur = '';
  for (const c of chars) {
    const next = cur + c;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = c;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function padLine(ch: string, width: number) {
  return ch.repeat(width);
}

function wrapText(text: string, width: number): string[] {
  const chars = Array.from(String(text || ''));
  const lines: string[] = [];
  let cur = '';
  for (const c of chars) {
    if (Array.from(cur).length >= width) {
      lines.push(cur);
      cur = '';
    }
    cur += c;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Plain-text thermal receipt (clipboard). */
export function buildDevLogReceiptText(dayKey: string, entries: DevLogEntry[]): string {
  const W = 34;
  const daySummary = buildDayReceiptSummary(entries);
  const lines: string[] = [];
  lines.push(padLine('=', W));
  lines.push('   AssetCutter · DEV LOG');
  lines.push(padLine('-', W));
  lines.push('         日 结 小 票');
  lines.push(`      ${formatDayLabel(dayKey)}`);
  lines.push(padLine('=', W));
  lines.push('【本日总结】');
  daySummary.forEach((s, i) => {
    for (const w of wrapText(` ${i + 1}. ${s}`, W)) lines.push(w);
  });
  lines.push(padLine('-', W));

  const sorted = [...entries].sort((a, b) => String(a.pushedAt).localeCompare(String(b.pushedAt)));
  sorted.forEach((e, idx) => {
    lines.push(`#${idx + 1}  ${formatTime(e.pushedAt)}`);
    lines.push(`    ${shortSha(e.fromSha) || '∅'} → ${shortSha(e.toSha)}`);
    for (const b of (e.summaryBullets || []).slice(0, 6)) {
      for (const w of wrapText(`    · ${b}`, W)) lines.push(w);
    }
    const st = e.stats;
    if (st) {
      lines.push(`    文件 ${st.filesChanged ?? 0}  +${st.insertions ?? 0}/-${st.deletions ?? 0}`);
    }
    lines.push(padLine('-', W));
  });

  const files = sorted.reduce((n, e) => n + (e.stats?.filesChanged || 0), 0);
  const ins = sorted.reduce((n, e) => n + (e.stats?.insertions || 0), 0);
  const del = sorted.reduce((n, e) => n + (e.stats?.deletions || 0), 0);
  lines.push(`笔数${'.'.repeat(18)}${String(sorted.length).padStart(4)}`);
  lines.push(`文件触达${'.'.repeat(14)}${String(files).padStart(4)}`);
  lines.push(`增删行${'.'.repeat(16)}+${ins}/-${del}`);
  lines.push(padLine('=', W));
  lines.push('    谢谢惠顾 · 继续迭代');
  lines.push(`    NO.${dayKey.replace(/-/g, '')}`);
  lines.push(padLine('=', W));
  return lines.join('\n');
}

type DrawCmd =
  | { t: 'gap'; h: number }
  | { t: 'rule'; style: 'solid' | 'dash' | 'double' }
  | { t: 'text'; text: string; size: number; weight?: string; align?: CanvasTextAlign; color?: string }
  | { t: 'bullet'; text: string; index?: number }
  | { t: 'kv'; label: string; value: string }
  | { t: 'barcode' };

function buildDrawCommands(dayKey: string, entries: DevLogEntry[]): DrawCmd[] {
  const daySummary = buildDayReceiptSummary(entries);
  const sorted = [...entries].sort((a, b) => String(a.pushedAt).localeCompare(String(b.pushedAt)));
  const cmds: DrawCmd[] = [];

  cmds.push({ t: 'gap', h: 6 });
  cmds.push({ t: 'text', text: 'AssetCutter', size: 20, weight: '800', align: 'center' });
  cmds.push({ t: 'gap', h: 2 });
  cmds.push({ t: 'text', text: 'D E V   L O G', size: 10, weight: '600', align: 'center', color: '#444' });
  cmds.push({ t: 'gap', h: 10 });
  cmds.push({ t: 'rule', style: 'double' });
  cmds.push({ t: 'gap', h: 10 });
  cmds.push({ t: 'text', text: '日 结 小 票', size: 15, weight: '700', align: 'center' });
  cmds.push({ t: 'gap', h: 4 });
  cmds.push({ t: 'text', text: formatDayLabel(dayKey), size: 11, align: 'center', color: '#333' });
  cmds.push({ t: 'gap', h: 8 });
  cmds.push({ t: 'rule', style: 'dash' });
  cmds.push({ t: 'gap', h: 10 });

  cmds.push({ t: 'text', text: '【本日总结】', size: 12, weight: '700' });
  cmds.push({ t: 'gap', h: 6 });
  daySummary.forEach((s, i) => {
    cmds.push({ t: 'bullet', text: s, index: i + 1 });
    cmds.push({ t: 'gap', h: 4 });
  });
  cmds.push({ t: 'gap', h: 4 });
  cmds.push({ t: 'rule', style: 'dash' });
  cmds.push({ t: 'gap', h: 10 });

  sorted.forEach((e, idx) => {
    cmds.push({
      t: 'text',
      text: `#${idx + 1}  PUSH  ${formatTime(e.pushedAt)}`,
      size: 11,
      weight: '700',
    });
    cmds.push({ t: 'gap', h: 3 });
    cmds.push({
      t: 'text',
      text: `${shortSha(e.fromSha) || '∅'}  →  ${shortSha(e.toSha)}`,
      size: 10,
      color: '#444',
    });
    cmds.push({ t: 'gap', h: 6 });
    for (const b of (e.summaryBullets || []).slice(0, 6)) {
      cmds.push({ t: 'bullet', text: b });
      cmds.push({ t: 'gap', h: 3 });
    }
    const st = e.stats;
    if (st) {
      cmds.push({ t: 'gap', h: 2 });
      cmds.push({
        t: 'text',
        text: `文件 ${st.filesChanged ?? 0}    +${st.insertions ?? 0} / −${st.deletions ?? 0}`,
        size: 9,
        color: '#555',
      });
    }
    cmds.push({ t: 'gap', h: 8 });
    cmds.push({ t: 'rule', style: 'dash' });
    cmds.push({ t: 'gap', h: 10 });
  });

  const files = sorted.reduce((n, e) => n + (e.stats?.filesChanged || 0), 0);
  const ins = sorted.reduce((n, e) => n + (e.stats?.insertions || 0), 0);
  const del = sorted.reduce((n, e) => n + (e.stats?.deletions || 0), 0);
  cmds.push({ t: 'kv', label: '笔数', value: String(sorted.length) });
  cmds.push({ t: 'gap', h: 4 });
  cmds.push({ t: 'kv', label: '文件触达', value: String(files) });
  cmds.push({ t: 'gap', h: 4 });
  cmds.push({ t: 'kv', label: '增删行', value: `+${ins} / −${del}` });
  cmds.push({ t: 'gap', h: 12 });
  cmds.push({ t: 'rule', style: 'double' });
  cmds.push({ t: 'gap', h: 12 });
  cmds.push({ t: 'barcode' });
  cmds.push({ t: 'gap', h: 8 });
  cmds.push({ t: 'text', text: '谢谢惠顾 · 继续迭代', size: 11, weight: '600', align: 'center' });
  cmds.push({ t: 'gap', h: 4 });
  cmds.push({
    t: 'text',
    text: `NO.${dayKey.replace(/-/g, '')}-${shortSha(sorted[sorted.length - 1]?.toSha || '0000000')}`,
    size: 9,
    align: 'center',
    color: '#666',
  });
  cmds.push({ t: 'gap', h: 8 });

  return cmds;
}

function fontStack(weight: string, size: number) {
  return `${weight} ${size}px "IBM Plex Mono", "Cascadia Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Consolas", monospace`;
}

function drawPaperGrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() * 18) | 0;
    d[i] = 245 - n;
    d[i + 1] = 242 - n;
    d[i + 2] = 232 - n;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function measureCommands(ctx: CanvasRenderingContext2D, cmds: DrawCmd[]): number {
  let y = 0;
  for (const cmd of cmds) {
    if (cmd.t === 'gap') {
      y += cmd.h;
      continue;
    }
    if (cmd.t === 'rule') {
      y += cmd.style === 'double' ? 8 : 6;
      continue;
    }
    if (cmd.t === 'barcode') {
      y += 36;
      continue;
    }
    if (cmd.t === 'kv') {
      y += 14;
      continue;
    }
    if (cmd.t === 'bullet') {
      const prefix = cmd.index != null ? `${cmd.index}. ` : '· ';
      ctx.font = fontStack('400', 11);
      const lines = wrapByWidth(ctx, prefix + cmd.text, CONTENT_W - 4);
      y += lines.length * 15;
      continue;
    }
    if (cmd.t === 'text') {
      ctx.font = fontStack(cmd.weight || '400', cmd.size);
      const lines = wrapByWidth(ctx, cmd.text, CONTENT_W);
      y += lines.length * (cmd.size + 4);
    }
  }
  return y;
}

function paintCommands(ctx: CanvasRenderingContext2D, cmds: DrawCmd[], startY: number) {
  let y = startY;
  const ink = '#1c1c1c';

  for (const cmd of cmds) {
    if (cmd.t === 'gap') {
      y += cmd.h;
      continue;
    }

    if (cmd.t === 'rule') {
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      if (cmd.style === 'dash') {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD_X, y + 2);
        ctx.lineTo(RECEIPT_W - PAD_X, y + 2);
        ctx.stroke();
        ctx.setLineDash([]);
        y += 6;
      } else if (cmd.style === 'double') {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(PAD_X, y);
        ctx.lineTo(RECEIPT_W - PAD_X, y);
        ctx.moveTo(PAD_X, y + 4);
        ctx.lineTo(RECEIPT_W - PAD_X, y + 4);
        ctx.stroke();
        y += 8;
      } else {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(PAD_X, y + 2);
        ctx.lineTo(RECEIPT_W - PAD_X, y + 2);
        ctx.stroke();
        y += 6;
      }
      continue;
    }

    if (cmd.t === 'kv') {
      ctx.fillStyle = ink;
      ctx.font = fontStack('500', 11);
      ctx.textAlign = 'left';
      ctx.fillText(cmd.label, PAD_X, y);
      const labelW = ctx.measureText(cmd.label).width;
      const valueW = ctx.measureText(cmd.value).width;
      const dotsStart = PAD_X + labelW + 6;
      const dotsEnd = RECEIPT_W - PAD_X - valueW - 6;
      ctx.fillStyle = '#888';
      ctx.font = fontStack('400', 10);
      let x = dotsStart;
      while (x < dotsEnd) {
        ctx.fillText('.', x, y);
        x += 5;
      }
      ctx.fillStyle = ink;
      ctx.font = fontStack('700', 11);
      ctx.textAlign = 'right';
      ctx.fillText(cmd.value, RECEIPT_W - PAD_X, y);
      ctx.textAlign = 'left';
      y += 14;
      continue;
    }

    if (cmd.t === 'barcode') {
      const barY = y;
      const barH = 28;
      let x = PAD_X + 8;
      const end = RECEIPT_W - PAD_X - 8;
      ctx.fillStyle = ink;
      let i = 0;
      while (x < end) {
        const w = ((i * 17 + 11) % 5) + 1;
        if (i % 3 !== 0) ctx.fillRect(x, barY, w, barH);
        x += w + 1;
        i += 1;
      }
      y += 36;
      continue;
    }

    if (cmd.t === 'bullet') {
      const prefix = cmd.index != null ? `${cmd.index}. ` : '· ';
      ctx.font = fontStack('400', 11);
      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      const lines = wrapByWidth(ctx, prefix + cmd.text, CONTENT_W - 4);
      for (const line of lines) {
        ctx.fillText(line, PAD_X + 2, y);
        y += 15;
      }
      continue;
    }

    if (cmd.t === 'text') {
      ctx.font = fontStack(cmd.weight || '400', cmd.size);
      ctx.fillStyle = cmd.color || ink;
      ctx.textAlign = cmd.align || 'left';
      const lines = wrapByWidth(ctx, cmd.text, CONTENT_W);
      for (const line of lines) {
        const x =
          cmd.align === 'center' ? RECEIPT_W / 2 : cmd.align === 'right' ? RECEIPT_W - PAD_X : PAD_X;
        ctx.fillText(line, x, y);
        y += cmd.size + 4;
      }
      ctx.textAlign = 'left';
    }
  }
  return y;
}

/**
 * Render a thermal-style receipt PNG and trigger download.
 */
export async function downloadDevLogReceiptPng(dayKey: string, entries: DevLogEntry[]): Promise<void> {
  const cmds = buildDrawCommands(dayKey, entries);
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  if (!mctx) throw new Error('无法创建画布');

  const jagged = 10;
  const bodyH = measureCommands(mctx, cmds);
  const topPad = 18;
  const bottomPad = 16;
  const paperH = jagged + topPad + bodyH + bottomPad + jagged;
  const shadowPad = 16;
  const canvas = document.createElement('canvas');
  canvas.width = RECEIPT_W + shadowPad * 2;
  canvas.height = paperH + shadowPad * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  // Backdrop
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(shadowPad + 4, shadowPad + 6, RECEIPT_W, paperH);

  // Paper body with grain
  const paperX = shadowPad;
  const paperY = shadowPad;
  ctx.save();
  ctx.translate(paperX, paperY);

  // Clip to jagged paper silhouette
  ctx.beginPath();
  // top jagged
  ctx.moveTo(0, jagged);
  for (let x = 0; x <= RECEIPT_W; x += 10) {
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x + 10, jagged);
  }
  // right + bottom jagged
  ctx.lineTo(RECEIPT_W, paperH - jagged);
  for (let x = RECEIPT_W; x >= 0; x -= 10) {
    ctx.lineTo(x - 5, paperH);
    ctx.lineTo(x - 10, paperH - jagged);
  }
  ctx.closePath();
  ctx.clip();

  drawPaperGrain(ctx, RECEIPT_W, paperH);

  // Slight warm wash
  ctx.fillStyle = 'rgba(255, 248, 230, 0.35)';
  ctx.fillRect(0, 0, RECEIPT_W, paperH);

  // Inner content
  ctx.textBaseline = 'top';
  paintCommands(ctx, cmds, jagged + topPad);

  // Edge darken
  const edgeGrad = ctx.createLinearGradient(0, 0, 0, paperH);
  edgeGrad.addColorStop(0, 'rgba(0,0,0,0.06)');
  edgeGrad.addColorStop(0.05, 'rgba(0,0,0,0)');
  edgeGrad.addColorStop(0.95, 'rgba(0,0,0,0)');
  edgeGrad.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, RECEIPT_W, paperH);

  ctx.restore();

  // Redraw jagged silhouette stroke for crisp edge
  ctx.save();
  ctx.translate(paperX, paperY);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, jagged);
  for (let x = 0; x <= RECEIPT_W; x += 10) {
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x + 10, jagged);
  }
  ctx.lineTo(RECEIPT_W, paperH - jagged);
  for (let x = RECEIPT_W; x >= 0; x -= 10) {
    ctx.lineTo(x - 5, paperH);
    ctx.lineTo(x - 10, paperH - jagged);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 导出失败');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dev-log-${dayKey}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
