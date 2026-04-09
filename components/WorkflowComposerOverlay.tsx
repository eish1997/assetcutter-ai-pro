import React, { useCallback, useEffect, useState } from 'react';
import { PreviewShell } from './preview';
import CapabilitySetCanvas from './CapabilitySetCanvas';
import type { CustomAppModule } from '../types';
import type { CapabilitySet } from '../types';
import type { CapabilityAssetCandidate } from './CapabilitySetCanvas';

export type WorkflowComposerOverlayProps = {
  open: boolean;
  onClose: () => void;
  /** 切换打开内容时重置画布 */
  sessionKey: number;
  presets: CustomAppModule[];
  initialSet: CapabilitySet | null;
  onSave: (set: CapabilitySet) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  getPartialTestInputImage?: () => string | null;
  assetCandidates?: CapabilityAssetCandidate[];
};

/**
 * 全屏「工作流创建」：布局类似大图预览壳层，内嵌能力集合画布（左侧可拖预设、画板连线、多输出节点）。
 */
export default function WorkflowComposerOverlay({
  open,
  onClose,
  sessionKey,
  presets,
  initialSet,
  onSave,
  onLog,
  getPartialTestInputImage,
  assetCandidates = [],
}: WorkflowComposerOverlayProps) {
  const [setLabel, setSetLabel] = useState(initialSet?.label ?? '新建工作流');

  useEffect(() => {
    if (!open) return;
    setSetLabel(initialSet?.label ?? '新建工作流');
  }, [open, initialSet, sessionKey]);

  const handleSave = useCallback(
    (set: CapabilitySet) => {
      onSave(set);
      onClose();
    },
    [onSave, onClose]
  );

  if (!open) return null;

  return (
    <PreviewShell
      open={open}
      onClose={onClose}
      focusKey={sessionKey}
      zIndexClassName="z-[2100]"
      backdropTintClassName="bg-black/38 backdrop-blur-xl"
    >
      <div className="relative h-full min-h-0 w-full overflow-hidden" key={sessionKey}>
        {/* 与大图预览右上角「关闭」一致 */}
        <div className="absolute right-4 top-4 z-[35] flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl bg-[#1a1a1e]/95 border border-[#2e2e32] text-[10px] font-black text-white hover:bg-[#2a2a32]"
          >
            关闭
          </button>
        </div>
        <div className="absolute inset-0 min-h-0">
          <CapabilitySetCanvas
            presets={presets}
            initialSet={initialSet}
            setLabel={setLabel}
            onSetLabelChange={setSetLabel}
            onSave={handleSave}
            onClose={onClose}
            layoutVariant="overlayGlass"
            onLog={onLog}
            getPartialTestInputImage={getPartialTestInputImage}
            assetCandidates={assetCandidates}
          />
        </div>
      </div>
    </PreviewShell>
  );
}
