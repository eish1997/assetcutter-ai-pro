import React, { useState, useMemo, useCallback } from 'react';
import type { WorkflowAsset, CustomAppModule } from '../../../types';
import { triggerImageDownload } from '../../../services/imageDataUrl';
import { appendWorkflowAuditEvent, WORKFLOW_AUDIT_CODES } from '../../../services/workflowAuditEvents';
import AppIcon from '../../ui/AppIcon';
import { ProgressivePreviewImage } from '../../ProgressivePreviewImage';
import { baseActionId } from '../workflowIds';

const ArchivedDetailModal: React.FC<{
  asset: WorkflowAsset;
  assets: WorkflowAsset[];
  modules: CustomAppModule[];
  onClose: () => void;
}> = ({ asset, assets, modules, onClose }) => {
  const resolveGroupImages = useCallback(
    (a: WorkflowAsset, visited: Set<string> = new Set()): string[] => {
      if (visited.has(a.id)) return [];
      visited.add(a.id);
      const out: string[] = [];
      for (const item of a.cutImageGroup ?? []) {
        if (typeof item === 'string') out.push(item);
        else if (item && typeof item === 'object' && 'r2Key' in item) continue;
        else if (item && typeof item === 'object' && 'assetId' in item) {
          const child = assets.find((x) => x.id === item.assetId);
          if (!child) continue;
          if (child.cutImageGroup?.length) out.push(...resolveGroupImages(child, visited));
          else out.push(child.results[child.displayKey] ?? child.original);
        }
      }
      return out;
    },
    [assets]
  );

  const cutImages = useMemo(() => {
    if (!asset.cutImageGroup?.length) return [];
    return resolveGroupImages(asset);
  }, [asset, resolveGroupImages]);

  const [cutContactSheetUrl, setCutContactSheetUrl] = useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const buildContactSheet = async () => {
      if (cutImages.length === 0) {
        setCutContactSheetUrl(null);
        return;
      }
      const maxW = 1200;
      const maxH = 700;
      const pad = 12;
      const gap = 8;
      const count = Math.min(cutImages.length, 12);
      const cols = Math.min(4, count);
      const rows = Math.ceil(count / cols);
      const sheetW = maxW;
      const sheetH = Math.min(maxH, Math.max(220, rows * 200 + pad * 2 + gap * (rows - 1)));

      const canvas = document.createElement('canvas');
      canvas.width = sheetW;
      canvas.height = sheetH;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, sheetW, sheetH);

      const cellW = Math.floor((sheetW - pad * 2 - gap * (cols - 1)) / cols);
      const cellH = Math.floor((sheetH - pad * 2 - gap * (rows - 1)) / rows);

      const loadOne = (src: string) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img);
          img.src = src;
        });
      const imgs = await Promise.all(cutImages.slice(0, count).map(loadOne));

      imgs.forEach((img, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x0 = pad + c * (cellW + gap);
        const y0 = pad + r * (cellH + gap);

        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(x0, y0, cellW, cellH);

        if (!img.naturalWidth || !img.naturalHeight) return;
        const scale = Math.min(cellW / img.naturalWidth, cellH / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dx = x0 + (cellW - dw) / 2;
        const dy = y0 + (cellH - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x0 + 6, y0 + 6, 28, 18);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(String(i + 1), x0 + 12, y0 + 19);
      });

      const url = canvas.toDataURL('image/png');
      if (!cancelled) setCutContactSheetUrl(url);
    };
    void buildContactSheet();
    return () => {
      cancelled = true;
    };
  }, [cutImages]);

  const [cutLightboxIndex, setCutLightboxIndex] = useState<number | null>(null);
  const cutLightboxImage = cutLightboxIndex != null ? cutImages[cutLightboxIndex] : null;

  const stepsForComposite = useMemo(() => {
    const list: { id: string; label: string; image: string; executedAt?: number }[] = [
      { id: 'original', label: '原始', image: asset.original },
    ];
    for (const id of asset.resultOrder) {
      const bid = baseActionId(id);
      const img =
        bid === 'cut_image'
          ? (cutContactSheetUrl ?? cutImages[0] ?? null)
          : (asset.results[id] ?? null);
      if (!img) continue;
      const mod = modules.find((m) => m.id === bid);
      list.push({
        id,
        label: mod?.label ?? bid,
        image: img,
        executedAt: asset.resultMeta?.[id]?.executedAt,
      });
    }
    return list;
  }, [asset, modules, cutImages, cutContactSheetUrl]);

  const stepsForCards = useMemo(() => {
    return stepsForComposite.filter((s) => s.id !== 'cut_image');
  }, [stepsForComposite]);

  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const runDownloadOne = async (image: string, label: string) => {
    await triggerImageDownload(image, `workflow-${label}-${asset.id.slice(0, 6)}`);
  };

  const downloadOne = async (image: string, label: string) => {
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
      assetId: asset.id,
      displayKey: asset.displayKey,
      message: `归档详情：下载单图（${label}）`,
      detail: { context: 'archive_detail_single', label },
    });
    await runDownloadOne(image, label);
  };

  const downloadMany = (images: string[], labelPrefix: string) => {
    const intervalMs = 140;
    if (images.length === 0) return;
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
      assetId: asset.id,
      displayKey: asset.displayKey,
      message: `归档详情：批量下载 ${images.length} 张（${labelPrefix}）`,
      detail: { context: 'archive_detail_bulk', labelPrefix, count: images.length },
    });
    images.forEach((img, idx) => {
      const label = `${labelPrefix}-${String(idx + 1).padStart(2, '0')}`;
      window.setTimeout(() => {
        void runDownloadOne(img, label);
      }, idx * intervalMs);
    });
  };

  const buildComposite = useCallback(() => {
    if (stepsForComposite.length === 0) return;
    const maxW = 1200;
    const maxH = 700;
    const lineHeight = 24;
    const gap = 10;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const loadAll = (): Promise<{ img: HTMLImageElement; drawH: number; drawW: number }[]> => {
      return Promise.all(
        stepsForComposite.map(
          (s) =>
            new Promise<{ img: HTMLImageElement; drawH: number; drawW: number }>((resolve) => {
              const img = new Image();
              img.onload = () => {
                const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
                const drawW = img.naturalWidth * scale;
                const drawH = img.naturalHeight * scale;
                resolve({ img, drawH, drawW });
              };
              img.onerror = () => resolve({ img, drawH: 200, drawW: 300 });
              img.src = s.image;
            })
        )
      );
    };

    loadAll().then((loaded) => {
      let height = 40;
      loaded.forEach((l) => {
        height += lineHeight + gap + l.drawH + gap;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((maxW + 40) * dpr);
      canvas.height = Math.ceil(height * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, maxW + 40, height);
      let y = 20;
      stepsForComposite.forEach((s, i) => {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(s.label + (s.executedAt ? ` · ${new Date(s.executedAt).toLocaleString()}` : ''), 20, y + 16);
        y += lineHeight + gap;
        const { img, drawH, drawW } = loaded[i];
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, 20, y, drawW, drawH);
          y += drawH + gap;
        } else {
          y += 200 + gap;
        }
      });
      setCompositeUrl(canvas.toDataURL('image/png'));
    });
  }, [stepsForComposite]);

  React.useEffect(() => {
    buildComposite();
  }, [buildComposite]);

  const downloadComposite = () => {
    if (!compositeUrl) return;
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
      assetId: asset.id,
      displayKey: asset.displayKey,
      message: '归档详情：下载流程拼图',
      detail: { context: 'archive_detail_flow_composite' },
    });
    void triggerImageDownload(compositeUrl, `workflow-flow-${asset.id.slice(0, 6)}`);
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/55 backdrop-blur-sm p-4 py-10 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="relative max-w-4xl w-full max-h-[90vh] overflow-y-auto no-scrollbar bg-[#14141a]/92 backdrop-blur-md rounded-2xl border border-white/10 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-black uppercase text-blue-400">归档详情 · 生成流程图</h3>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>

        {cutImages.length > 0 && (
          <div className="mb-4 rounded-xl border border-[#2e2e32] bg-[#16161a] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black uppercase text-gray-300">切割图片组（{cutImages.length}）</span>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-gray-500">点击缩略图可单张查看</span>
                <button
                  type="button"
                  onClick={() => downloadMany(cutImages, 'cut')}
                  className="px-2 py-1 rounded-lg bg-[#26262c] text-[8px] font-black uppercase hover:bg-[#383842]"
                  title="逐张触发下载（浏览器可能会拦截过多下载）"
                >
                  批量下载
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {cutImages.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCutLightboxIndex(idx)}
                  className="rounded-lg border border-[#2e2e32] bg-[#141416] overflow-hidden hover:border-[#3b6fb8] transition-colors"
                  title={`第 ${idx + 1} 张`}
                >
                  <ProgressivePreviewImage
                    fullSrc={img}
                    cacheKey={`arch-cut:${asset.id}:${idx}`}
                    thumbMaxEdge={240}
                    className="relative w-full h-20"
                    imgClassName="w-full h-20 object-cover block"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {stepsForCards.map((s, i) => (
            <div key={i} className="rounded-xl border border-[#2e2e32] overflow-hidden bg-[#16161a]">
              <div className="px-3 py-2 flex items-center justify-between border-b border-[#252528]">
                <span className="text-[9px] font-black uppercase text-gray-300">{s.label}</span>
                {s.executedAt != null && (
                  <span className="text-[8px] text-gray-500">{new Date(s.executedAt).toLocaleString()}</span>
                )}
                <button
                  onClick={() => downloadOne(s.image, s.label)}
                  className="px-2 py-1 rounded-lg bg-[#26262c] text-[8px] font-black uppercase hover:bg-[#383842]"
                >
                  下载此张
                </button>
              </div>
              <ProgressivePreviewImage
                fullSrc={s.image}
                cacheKey={`arch-step:${asset.id}:${i}:${s.label}`}
                thumbMaxEdge={480}
                className="relative w-full min-h-[120px] max-h-[320px]"
                imgClassName="w-full max-h-[320px] object-contain bg-[#16161a]"
                alt={s.label}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[9px] text-gray-500">拼合后的流程图（按生成顺序）</span>
          {compositeUrl && (
            <>
              <ProgressivePreviewImage
                fullSrc={compositeUrl}
                cacheKey={`arch-composite:${asset.id}`}
                thumbMaxEdge={360}
                className="relative inline-block max-h-48 max-w-full"
                imgClassName="max-h-48 rounded-lg border border-[#2e2e32] object-contain"
                alt="流程图"
              />
              <button
                onClick={downloadComposite}
                className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase hover:bg-blue-500"
              >
                下载整张流程图
              </button>
            </>
          )}
        </div>
      </div>

      {cutLightboxImage && cutLightboxIndex != null && (
        <div
          className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/78 backdrop-blur-sm p-4"
          onClick={() => setCutLightboxIndex(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCutLightboxIndex(null);
            if (e.key === 'ArrowLeft')
              setCutLightboxIndex((i) => (i == null ? i : (i - 1 + cutImages.length) % cutImages.length));
            if (e.key === 'ArrowRight') setCutLightboxIndex((i) => (i == null ? i : (i + 1) % cutImages.length));
          }}
          aria-label="查看切割图片"
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setCutLightboxIndex(null)}
              className="absolute -top-12 right-0 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
              aria-label="关闭"
            >
              <AppIcon name="close" className="w-4 h-4" />
            </button>
            <img
              src={cutLightboxImage}
              alt=""
              className="w-full max-h-[80vh] object-contain rounded-2xl border border-[#2e2e32] bg-[#16161a]"
            />
            <div className="flex justify-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  void downloadOne(cutLightboxImage, `cut-${cutLightboxIndex + 1}`);
                }}
                className="px-3 py-1 rounded-lg bg-[#1d4ed8] hover:bg-blue-500 text-[9px] font-black"
              >
                下载此张
              </button>
              {cutImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setCutLightboxIndex((i) => (i == null ? i : (i - 1 + cutImages.length) % cutImages.length))
                    }
                    className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black"
                  >
                    上一张
                  </button>
                  <span className="text-[9px] text-gray-500 self-center">
                    {cutLightboxIndex + 1} / {cutImages.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCutLightboxIndex((i) => (i == null ? i : (i + 1) % cutImages.length))}
                    className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black"
                  >
                    下一张
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchivedDetailModal;
