import React from 'react';
import type { WorkflowAsset, LibraryItem, BoundingBox } from '../../types';
import type { AcWorkflowExportPayload } from '../../services/workflowDragPipeline';
import { WORKFLOW_IMG_EMPTY_PLACEHOLDER } from '../../services/workflowImageDisplay';

/** 持久化数据异常时可能混入 non string，避免把对象传给 img src 触发 React 抛错 */
export const asWorkflowImageString = (v: unknown): string => (typeof v === 'string' ? v : '');

export function buildLibraryItemsFromWorkflowExport(
  assets: WorkflowAsset[],
  showArchived: boolean,
  getDisplay: (a: WorkflowAsset) => string,
  payload: AcWorkflowExportPayload
): Partial<LibraryItem>[] {
  const items: Partial<LibraryItem>[] = [];
  if (payload.mode === 'roots') {
    const seen = new Set<string>();
    for (const id of payload.assetIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const a = assets.find((x) => x.id === id);
      if (!a || a.archived !== showArchived || a.parentAssetId) continue;
      const data = getDisplay(a);
      if (!data || data === WORKFLOW_IMG_EMPTY_PLACEHOLDER) continue;
      items.push({
        data,
        label: (a.groupLabel && a.groupLabel.trim()) || `工作区-${id.slice(0, 8)}`,
        type: 'SLICE',
        category: 'PREVIEW_STRIP',
      });
    }
  } else {
    for (const { parentId, index: idx } of payload.items) {
      const parent = assets.find((x) => x.id === parentId);
      const raw = parent?.cutImageGroup?.[idx];
      if (raw == null) continue;
      let data: string | null = null;
      if (typeof raw === 'string') data = raw;
      else if (raw && typeof raw === 'object' && 'assetId' in raw) {
        const ch = assets.find((x) => x.id === (raw as { assetId: string }).assetId);
        data = ch ? getDisplay(ch) : null;
      } else if (raw && typeof raw === 'object' && 'r2Key' in raw) {
        data = asWorkflowImageString(parent?.original);
      }
      if (!data || data === WORKFLOW_IMG_EMPTY_PLACEHOLDER) continue;
      items.push({
        data,
        label: `${parent?.groupLabel || '组'} · 子项 ${idx + 1}`,
        type: 'SLICE',
        category: 'PREVIEW_STRIP',
      });
    }
  }
  return items;
}

export function safeUnknownToString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return String(v);
  } catch {
    return '[无法序列化的错误]';
  }
}

export function sanitizeDroppedUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function collectImageLikeUrlsFromText(raw: string): string[] {
  if (!raw) return [];
  const urls = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(sanitizeDroppedUrl)
    .filter((v): v is string => !!v);
  return Array.from(new Set(urls));
}

export function collectImageLikeUrlsFromHtml(rawHtml: string): string[] {
  if (!rawHtml) return [];
  try {
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    const urls = new Set<string>();
    doc.querySelectorAll('img[src]').forEach((img) => {
      const src = sanitizeDroppedUrl(img.getAttribute('src') || '');
      if (src) urls.add(src);
    });
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = sanitizeDroppedUrl(a.getAttribute('href') || '');
      if (href && /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(href)) urls.add(href);
    });
    return Array.from(urls);
  } catch {
    return [];
  }
}

export function dataTransferItemToString(item: DataTransferItem): Promise<string> {
  return new Promise((resolve) => {
    try {
      item.getAsString((s) => resolve(s || ''));
    } catch {
      resolve('');
    }
  });
}

/** 常用功能区 dragOver 兜底：首轮 dragover 可能早于 ref 同步，但 setData 后 types 已有 text/plain */
export function dragTransferHasPlainText(e: React.DragEvent): boolean {
  try {
    const t = e.dataTransfer?.types;
    if (!t) return false;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === 'text/plain') return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** App 传入的 capabilityPresetPanel 常包在 Suspense 外；cloneElement 需把 scrollContainerRef 传到内层 CapabilityPresetSection */
export function cloneCapabilityPresetPanelWithScrollRef(
  panel: React.ReactNode,
  scrollRef: React.RefObject<HTMLDivElement | null>
): React.ReactNode {
  if (!React.isValidElement(panel)) return panel;
  if (panel.type === React.Suspense) {
    const inner = panel.props.children;
    if (React.isValidElement(inner)) {
      return React.cloneElement(panel, {
        children: React.cloneElement(inner as React.ReactElement<{ scrollContainerRef?: React.Ref<HTMLDivElement> }>, {
          scrollContainerRef: scrollRef,
        }),
      });
    }
  }
  return React.cloneElement(panel as React.ReactElement<{ scrollContainerRef?: React.Ref<HTMLDivElement> }>, {
    scrollContainerRef: scrollRef,
  });
}

/** 裁剪图片：根据框选裁剪出多张图；`overflowPx` 为每边向外扩展的像素（基于原图像素，不超出图幅） */
export function cropBoxes(
  inputImage: string,
  boxes: BoundingBox[],
  selectedIndexes: number[],
  overflowPx = 0
): Promise<string[]> {
  const results: string[] = [];
  const img = new Image();
  img.src = inputImage;
  const pad = Math.max(0, Math.min(512, Math.round(overflowPx)));
  return new Promise<string[]>((resolve) => {
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const scaleX = nw / 1000;
      const scaleY = nh / 1000;
      for (const i of selectedIndexes) {
        if (i < 0 || i >= boxes.length) continue;
        const b = boxes[i];
        let x = Math.round(b.xmin * scaleX - pad);
        let y = Math.round(b.ymin * scaleY - pad);
        let w = Math.round((b.xmax - b.xmin) * scaleX + 2 * pad);
        let h = Math.round((b.ymax - b.ymin) * scaleY + 2 * pad);
        x = Math.max(0, x);
        y = Math.max(0, y);
        w = Math.min(nw - x, w);
        h = Math.min(nh - y, h);
        if (w < 1 || h < 1) continue;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        results.push(canvas.toDataURL('image/png'));
      }
      resolve(results);
    };
    img.onerror = () => resolve([]);
  });
}
