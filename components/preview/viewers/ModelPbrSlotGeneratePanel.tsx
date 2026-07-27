import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from '../../ui/CustomDropdown';
import { isImageProcessPreset } from '../../../services/capabilityEngineKind';
import { loadCapabilityPresets } from '../../../services/capabilityPresetStore';
import {
  MAX_PBR_SLOT_GENERATE_COUNT,
  type WorkflowModelPbrSlot,
  type WorkflowModelPbrSlotCandidate,
} from '../../../services/workflowModelPbrEdits';
import {
  dispatchWorkflowModelPbrTextureAction,
  downloadPbrTextureDataUrl,
} from '../../../services/workflowModelPbrTextureActions';
import { copyWorkflowAssetOriginalImageToClipboard } from '../../../services/workflowAssetClipboard';
import type { CustomAppModule } from '../../../types';
import ModelPbrTextureContextMenu from './ModelPbrTextureContextMenu';

const COUNT_OPTIONS = Array.from({ length: MAX_PBR_SLOT_GENERATE_COUNT }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

export type ModelPbrSlotGenerateJobView = {
  generating: boolean;
  pendingCount: number;
  totalCount: number;
  error: string | null;
};

function listTextureCapablePresets(): CustomAppModule[] {
  return loadCapabilityPresets()
    .filter((p) => {
      if (p.enabled === false) return false;
      if (p.id === 'cut_image') return false;
      if (isImageProcessPreset(p)) return true;
      return p.category === 'image_to_image';
    })
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'zh'));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export type ModelPbrSlotGeneratePanelProps = {
  slot: WorkflowModelPbrSlot;
  slotLabel: string;
  /** 宿主 3D 资产 id（复制 ID / 打开文件夹 / 加入输入框） */
  hostAssetId?: string;
  hostMaterialId?: string;
  /** 顶部「原始贴图」；可为空（空槽时先上传） */
  sourceDataUrl: string | null;
  onSourceDataUrlChange: (dataUrl: string | null, fileName?: string) => void;
  candidates: WorkflowModelPbrSlotCandidate[];
  activeCandidateId?: string;
  /** 解析候选预览（正式资产优先） */
  resolveCandidateSrc?: (candidate: WorkflowModelPbrSlotCandidate) => string;
  onApplyCandidate: (candidate: WorkflowModelPbrSlotCandidate) => void;
  onAddUploadedCandidate: (dataUrl: string, fileName: string, mimeType?: string) => void;
  onRemoveCandidate: (candidateId: string) => void;
  /** 由 Viewer 持有，关面板再开仍可恢复进度 */
  generateJob?: ModelPbrSlotGenerateJobView | null;
  onGenerate: (input: { presetId: string; count: number; inputText?: string }) => void;
};

export default function ModelPbrSlotGeneratePanel({
  slot,
  slotLabel,
  hostAssetId,
  hostMaterialId,
  sourceDataUrl,
  onSourceDataUrlChange,
  candidates,
  activeCandidateId,
  resolveCandidateSrc,
  onApplyCandidate,
  onAddUploadedCandidate,
  onRemoveCandidate,
  generateJob,
  onGenerate,
}: ModelPbrSlotGeneratePanelProps) {
  const candidateSrc = (cand: WorkflowModelPbrSlotCandidate) =>
    (resolveCandidateSrc ? resolveCandidateSrc(cand) : '') || String(cand.dataUrl || '').trim();
  const presets = useMemo(() => listTextureCapablePresets(), []);
  const presetOptions = useMemo(
    () => presets.map((p) => ({ value: p.id, label: p.label })),
    [presets]
  );
  const [presetId, setPresetId] = useState(() => presets[0]?.id || '');
  const [count, setCount] = useState(1);
  const [extraPrompt, setExtraPrompt] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [candidateMenu, setCandidateMenu] = useState<{
    candidate: WorkflowModelPbrSlotCandidate;
    x: number;
    y: number;
  } | null>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const generating = Boolean(generateJob?.generating);
  const pendingCount = Math.max(0, generateJob?.pendingCount ?? 0);
  const totalCount = Math.max(0, generateJob?.totalCount ?? count);
  const error = localError || generateJob?.error || null;

  useEffect(() => {
    if (!presetId && presets[0]?.id) setPresetId(presets[0].id);
  }, [presetId, presets]);

  const handleGenerate = () => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      setLocalError('请选择能力预设');
      return;
    }
    if (!sourceDataUrl) {
      setLocalError('请先上传或放入原始贴图');
      return;
    }
    if (generating) return;
    setLocalError(null);
    const n = Math.min(MAX_PBR_SLOT_GENERATE_COUNT, Math.max(1, count));
    onGenerate({
      presetId: preset.id,
      count: n,
      inputText: extraPrompt.trim() || undefined,
    });
  };

  const pickSourceFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onSourceDataUrlChange(dataUrl, file.name);
      setLocalError(null);
    } catch {
      setLocalError('读取原始贴图失败');
    }
  };

  const pickUploadCandidate = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onAddUploadedCandidate(dataUrl, file.name || 'upload.png', file.type || undefined);
      setLocalError(null);
    } catch {
      setLocalError('上传失败');
    }
  };

  const progressLabel =
    generating && totalCount > 0
      ? `生成中… ${Math.min(totalCount, totalCount - pendingCount + (pendingCount > 0 ? 1 : 0))}/${totalCount}`
      : generating
        ? '生成中…'
        : '生成';

  const menuCandidate = candidateMenu?.candidate;

  return (
    <div
      className="flex h-full w-[10.125rem] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d0e12]/92 text-gray-200 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl"
      data-image-preview-no-wheel
      data-model-pbr-generate-panel
      data-ac-allow-context-menu
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="shrink-0 space-y-1 border-b border-white/10 p-1.5">
        <div className="text-[8px] font-black uppercase tracking-wide text-gray-500">{slotLabel}</div>
        <button
          type="button"
          title="上传原始贴图"
          onClick={() => sourceInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = (Array.from(e.dataTransfer.files || []) as File[]).find((f) => f.type.startsWith('image/'));
            void pickSourceFile(file);
          }}
          className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/30 hover:bg-white/[0.06]"
        >
          {sourceDataUrl ? (
            <img src={sourceDataUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          ) : (
            <span className="text-[9px] text-gray-500">原始贴图 +</span>
          )}
        </button>
        <input
          ref={sourceInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            void pickSourceFile(file);
          }}
        />
        <div className="flex items-center gap-1">
          <CustomDropdown
            value={presetId}
            options={presetOptions.length > 0 ? presetOptions : [{ value: '', label: '无可用预设', disabled: true }]}
            onChange={setPresetId}
            placeholder="预设"
            triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} min-w-0 flex-1 py-1 text-[9px]`}
            portalZIndex={{ backdrop: 2400, list: 2401 }}
            listMinWidth={180}
            disabled={generating}
          />
          <CustomDropdown
            value={String(count)}
            options={COUNT_OPTIONS}
            onChange={(v) => setCount(Math.max(1, Math.min(MAX_PBR_SLOT_GENERATE_COUNT, Number(v) || 1)))}
            triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} w-[2.6rem] shrink-0 py-1 text-[9px]`}
            portalZIndex={{ backdrop: 2400, list: 2401 }}
            disabled={generating}
          />
        </div>
        <div className="flex items-stretch gap-1">
          <input
            type="text"
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            placeholder="补充信息"
            disabled={generating}
            className="min-w-0 flex-1 rounded-md bg-white/[0.05] px-1.5 py-1 text-[9px] text-gray-200 ring-1 ring-white/[0.08] outline-none placeholder:text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500/45 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={generating || !presetId}
            onClick={handleGenerate}
            className="shrink-0 rounded-md bg-white/[0.1] px-2 py-1 text-[9px] font-bold text-white ring-1 ring-white/15 transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {progressLabel}
          </button>
        </div>
        {error ? <div className="text-[8px] leading-snug text-amber-300/90">{error}</div> : null}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5" data-image-preview-scroll>
        {candidates.map((cand) => {
          const active = cand.id === activeCandidateId;
          const src = candidateSrc(cand);
          return (
            <button
              key={cand.id}
              type="button"
              title="点击应用 · 右键更多"
              data-ac-allow-context-menu
              onClick={() => onApplyCandidate(cand)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCandidateMenu({ candidate: cand, x: e.clientX, y: e.clientY });
              }}
              className={`relative block h-14 w-full overflow-hidden rounded-md border bg-black/30 ${
                active ? 'border-blue-400/70 ring-1 ring-blue-300/50' : 'border-white/10 hover:border-white/25'
              }`}
            >
              {src ? (
                <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <span className="flex h-full items-center justify-center text-[9px] text-gray-500">无预览</span>
              )}
            </button>
          );
        })}
        {Array.from({ length: pendingCount }).map((_, i) => (
          <div
            key={`pending-${slot}-${i}`}
            className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-blue-400/35 bg-blue-500/[0.06] text-[9px] text-blue-200/80"
          >
            <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            <span className="relative z-[1]">生成中…</span>
          </div>
        ))}
        <button
          type="button"
          title="手动上传候选"
          onClick={() => uploadInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = (Array.from(e.dataTransfer.files || []) as File[]).find((f) => f.type.startsWith('image/'));
            void pickUploadCandidate(file);
          }}
          className="flex h-14 w-full items-center justify-center rounded-md border border-dashed border-white/15 bg-white/[0.03] text-[14px] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
        >
          +
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            void pickUploadCandidate(file);
          }}
        />
      </div>

      <ModelPbrTextureContextMenu
        open={Boolean(candidateMenu && menuCandidate)}
        x={candidateMenu?.x ?? 0}
        y={candidateMenu?.y ?? 0}
        canDelete
        canOpenFolder={Boolean(menuCandidate?.assetId || hostAssetId)}
        openFolderDisabledReason={
          menuCandidate?.assetId || hostAssetId ? undefined : '缺少贴图或宿主资产'
        }
        onDelete={() => {
          if (menuCandidate) onRemoveCandidate(menuCandidate.id);
        }}
        onDownload={() => {
          if (!menuCandidate) return;
          const src = candidateSrc(menuCandidate);
          if (!src) return;
          void downloadPbrTextureDataUrl(src, menuCandidate.fileName);
        }}
        onAddToCompose={() => {
          if (!menuCandidate || !hostAssetId) return;
          dispatchWorkflowModelPbrTextureAction({
            action: 'add-to-compose',
            assetId: hostAssetId,
            ...(menuCandidate.assetId ? { textureAssetId: menuCandidate.assetId } : {}),
            dataUrl: candidateSrc(menuCandidate) || undefined,
            fileName: menuCandidate.fileName,
            slots: [slot],
            ...(hostMaterialId ? { materialIds: [hostMaterialId] } : {}),
            textureLabel: menuCandidate.fileName || slotLabel,
          });
        }}
        onCopy={() => {
          if (!menuCandidate) return;
          const src = candidateSrc(menuCandidate);
          if (!src) return;
          void copyWorkflowAssetOriginalImageToClipboard({ imageSrc: src });
        }}
        onCopyId={() => {
          if (!menuCandidate) return;
          void navigator.clipboard?.writeText(menuCandidate.assetId || menuCandidate.id);
        }}
        onOpenFolder={
          hostAssetId || menuCandidate?.assetId || menuCandidate
            ? () => {
                if (!menuCandidate) return;
                const src = candidateSrc(menuCandidate);
                dispatchWorkflowModelPbrTextureAction({
                  action: 'open-folder',
                  assetId: hostAssetId || menuCandidate.assetId || '',
                  ...(menuCandidate.assetId ? { textureAssetId: menuCandidate.assetId } : {}),
                  ...(src ? { dataUrl: src } : {}),
                  ...(menuCandidate.fileName ? { fileName: menuCandidate.fileName } : {}),
                  slot,
                  ...(hostMaterialId ? { materialId: hostMaterialId } : {}),
                });
              }
            : undefined
        }
        onClose={() => setCandidateMenu(null)}
      />
    </div>
  );
}
