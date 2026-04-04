import React, { useState } from 'react';
import type { BoundingBox } from '../../../types';
import AppIcon from '../../ui/AppIcon';
import { SiteImage } from '../../SiteImage';

const CutSelectModal: React.FC<{
  inputImage: string;
  boxes: BoundingBox[];
  onConfirm: (selectedIndexes: number[]) => void;
  onCancel: () => void;
}> = ({ inputImage, boxes, onConfirm, onCancel }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set(boxes.map((_, i) => i)));
  const toggle = (i: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const scale = 1000;
  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="relative max-w-4xl w-full max-h-[90vh] overflow-auto rounded-2xl border border-white/10 bg-[#14141a]/92 backdrop-blur-md shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[10px] font-black uppercase text-blue-400">识别到物体，勾选要切割保存的区域</h3>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>
        <div className="relative inline-block max-w-full">
          <SiteImage src={inputImage} alt="" className="max-h-[60vh] w-auto block" loading="eager" />
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ left: 0, top: 0 }}
            viewBox={`0 0 ${scale} ${scale}`}
            preserveAspectRatio="none"
          >
            {boxes.map((b, i) => (
              <rect
                key={i}
                x={b.xmin}
                y={b.ymin}
                width={b.xmax - b.xmin}
                height={b.ymax - b.ymin}
                fill="none"
                stroke={selected.has(i) ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.5)'}
                strokeWidth={selected.has(i) ? 8 : 4}
              />
            ))}
          </svg>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {boxes.map((b, i) => (
            <label
              key={i}
              className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg bg-[#1c1c22] border border-[#2e2e32] hover:bg-[#2e2e36]"
            >
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="rounded" />
              <span className="text-[9px] font-black uppercase">{b.label || `区域 ${i + 1}`}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => onConfirm([...selected])}
            disabled={selected.size === 0}
            className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase disabled:opacity-40"
          >
            确认切割（{selected.size}）
          </button>
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-[#26262c] text-[10px] font-black uppercase">
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

export default CutSelectModal;
