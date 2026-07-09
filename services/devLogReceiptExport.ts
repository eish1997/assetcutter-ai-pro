import type { DevLogEntry } from '../types/devLog';
import { buildDayReceiptSummary } from './devLogClient';

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

function shortSha(sha: string) {
  return String(sha || '').slice(0, 7);
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

/** Plain-text thermal receipt (also used as canvas source). */
export function buildDevLogReceiptText(dayKey: string, entries: DevLogEntry[]): string {
  const W = 32;
  const daySummary = buildDayReceiptSummary(entries);
  const lines: string[] = [];
  lines.push(padLine('=', W));
  lines.push('  AssetCutter · DEV LOG');
  lines.push(padLine('-', W));
  lines.push('       日结小票');
  lines.push(`       ${dayKey}`);
  lines.push(padLine('=', W));
  lines.push('【本日总结】');
  for (const s of daySummary) {
    for (const w of wrapText(`  ${s}`, W)) lines.push(w);
  }
  lines.push(padLine('-', W));

  const sorted = [...entries].sort((a, b) => String(a.pushedAt).localeCompare(String(b.pushedAt)));
  sorted.forEach((e, idx) => {
    lines.push(`#${idx + 1}  ${formatTime(e.pushedAt)}  push`);
    lines.push(`  ${shortSha(e.fromSha) || '∅'} → ${shortSha(e.toSha)}`);
    for (const b of (e.summaryBullets || []).slice(0, 5)) {
      for (const w of wrapText(`  · ${b}`, W)) lines.push(w);
    }
    lines.push(padLine('-', W));
  });

  const files = sorted.reduce((n, e) => n + (e.stats?.filesChanged || 0), 0);
  lines.push(`笔数 ............ ${sorted.length}`);
  lines.push(`文件触达 ........ ${files}`);
  lines.push(padLine('=', W));
  lines.push('  谢谢惠顾 · 继续迭代');
  lines.push(padLine('=', W));
  return lines.join('\n');
}

/**
 * Render receipt text to PNG via canvas and trigger download.
 */
export async function downloadDevLogReceiptPng(dayKey: string, entries: DevLogEntry[]): Promise<void> {
  const text = buildDevLogReceiptText(dayKey, entries);
  const rows = text.split('\n');
  const padX = 20;
  const padY = 24;
  const lineH = 16;
  const font = '13px "Cascadia Mono", "Sarasa Mono SC", "Consolas", "Courier New", monospace';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  ctx.font = font;
  let maxW = 0;
  for (const row of rows) {
    maxW = Math.max(maxW, ctx.measureText(row).width);
  }
  canvas.width = Math.ceil(maxW + padX * 2);
  canvas.height = Math.ceil(rows.length * lineH + padY * 2);

  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = font;
  ctx.textBaseline = 'top';
  rows.forEach((row, i) => {
    ctx.fillText(row, padX, padY + i * lineH);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 导出失败');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dev-log-${dayKey}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
