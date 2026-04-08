import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CustomAppModule } from '../../../types';
import AppIcon from '../../ui/AppIcon';

export type PromptTweakTarget =
  | {
      assetId: string;
      inputImage: string;
      inputSourceDisplayKey?: string;
      sourceGroupAssetId?: string;
      sourceItemIndex?: number;
      /** 文字资产卡片拖入时 */
      inputText?: string;
    }
  | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number };

const PromptTweakModal: React.FC<{
  preset: CustomAppModule;
  targets: PromptTweakTarget[];
  onConfirm: (editedPrompt: string) => void;
  onCancel: () => void;
}> = ({ preset, targets, onConfirm, onCancel }) => {
  const [text, setText] = useState(preset.instruction || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText(preset.instruction || '');
  }, [preset.id, preset.instruction]);
  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-md shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black uppercase text-blue-400">微调提示词 · {preset.label}</span>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white rounded"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[9px] text-gray-500 mb-2">可修改下方提示词后加入执行队列（{targets.length} 项）</p>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full min-h-[120px] rounded-xl bg-[#1c1c22] border border-[#2e2e32] px-3 py-2 text-[11px] text-white placeholder-white/40 focus:border-blue-500 outline-none resize-y"
          placeholder="预设提示词"
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => onConfirm(text)}
            className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase hover:bg-blue-500"
          >
            确定并加入队列
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-[#26262c] text-[10px] font-black uppercase hover:bg-[#383842]"
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PromptTweakModal;
