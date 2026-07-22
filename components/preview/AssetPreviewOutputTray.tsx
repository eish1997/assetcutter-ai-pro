import React from 'react';

import type { AssetCapabilityOutputAsset } from './assetPreviewTypes';

type Props = {
  outputs: AssetCapabilityOutputAsset[];
  onClear: () => void;
  onUseAsInput?: (output: AssetCapabilityOutputAsset) => void;
  onSaveOutput?: (output: AssetCapabilityOutputAsset) => void;
};

function outputPreview(output: AssetCapabilityOutputAsset): React.ReactNode {
  if (output.kind === 'text') {
    return (
      <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[9px] leading-4 text-gray-300">
        {output.text || output.url || output.objectKey || output.companionKey || '文本输出'}
      </pre>
    );
  }
  if (output.posterUrl || output.url) {
    return (
      <div className="h-20 overflow-hidden rounded-lg bg-black/30">
        {output.kind === 'image' && (output.posterUrl || output.url) ? (
          <img src={output.posterUrl || output.url} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-gray-500">
            {output.kind.toUpperCase()}
          </div>
        )}
      </div>
    );
  }
  return <div className="text-[9px] text-gray-500">无内联预览</div>;
}

export const AssetPreviewOutputTray: React.FC<Props> = ({
  outputs,
  onClear,
  onUseAsInput,
  onSaveOutput,
}) => {
  if (outputs.length === 0) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-28 left-1/2 z-[2140] flex max-h-[30vh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 gap-2 overflow-x-auto rounded-xl border border-white/10 bg-[#0d0e12]/95 p-2 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl"
      data-image-preview-no-wheel
      data-image-preview-scroll
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-24 shrink-0 px-1 py-1">
        <div className="text-[10px] font-black text-white">生成结果</div>
        <div className="mt-1 text-[8px] leading-4 text-gray-500">可保存、加入输入或继续预览。</div>
        <button
          type="button"
          onClick={onClear}
          className="mt-2 h-7 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[9px] font-bold text-gray-400 hover:bg-white/[0.08] hover:text-white"
        >
          清空
        </button>
      </div>
      {outputs.map((output, index) => (
        <div
          key={`${output.label}:${index}`}
          className="w-56 shrink-0 rounded-lg border border-white/10 bg-white/[0.035] p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[10px] font-bold text-gray-100">{output.label}</div>
            <div className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-black uppercase text-gray-500">
              {output.kind}
            </div>
          </div>
          <div className="mt-2">{outputPreview(output)}</div>
          <div className="mt-2 flex gap-1.5">
            {onUseAsInput ? (
              <button
                type="button"
                onClick={() => onUseAsInput(output)}
                className="h-7 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[9px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
              >
                加入输入
              </button>
            ) : null}
            {onSaveOutput ? (
              <button
                type="button"
                onClick={() => onSaveOutput(output)}
                className="h-7 rounded-md bg-blue-600 px-2 text-[9px] font-black text-white hover:bg-blue-500"
              >
                保存
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AssetPreviewOutputTray;
