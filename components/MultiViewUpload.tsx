/**
 * 多视角上传：8 个视角围绕中心「物体」的轨道式交互，点击每个视角槽上传对应图片
 */
import React, { useRef } from 'react';
import { PRO_VIEW_IDS, PRO_VIEW_LABELS } from '../services/tencentService';

export type ViewId = (typeof PRO_VIEW_IDS)[number];

interface MultiViewUploadProps {
  /** 各视角已上传的 base64（含 data: 前缀也可） */
  images: Partial<Record<ViewId, string>>;
  onChange: (images: Partial<Record<ViewId, string>>) => void;
  /** 最少需要几张（默认 2） */
  minCount?: number;
  /** 3.1 支持八视图，3.0 可只显示 4 或 6 */
  maxViews?: 8 | 6 | 4;
  className?: string;
}

const RADIUS = 72;
const SLOT_SIZE = 44;

const MultiViewUpload: React.FC<MultiViewUploadProps> = ({
  images,
  onChange,
  minCount = 2,
  maxViews = 8,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeViewRef = useRef<ViewId | null>(null);

  const viewIds = PRO_VIEW_IDS.slice(0, maxViews) as ViewId[];

  const handleSlotClick = (viewId: ViewId) => {
    activeViewRef.current = viewId;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const viewId = activeViewRef.current;
    if (!file || !viewId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onChange({ ...images, [viewId]: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const removeSlot = (viewId: ViewId, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = { ...images };
    delete next[viewId];
    onChange(next);
  };

  const filledCount = viewIds.filter((id) => images[id]).length;

  return (
    <div className={`relative ${className}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      {/* 中心：物体示意 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-2xl border border-white/20 bg-black/40 flex items-center justify-center">
        <span className="text-[9px] font-black text-white/60 uppercase">物体</span>
      </div>
      {/* 8 个视角槽沿圆周排列：0° 前, 45° 右前, 90° 右, ... */}
      <div className="relative w-[180px] h-[180px] mx-auto">
        {viewIds.map((viewId, i) => {
          const angle = (i * 360) / viewIds.length - 90;
          const rad = (angle * Math.PI) / 180;
          const x = 90 + RADIUS * Math.cos(rad);
          const y = 90 + RADIUS * Math.sin(rad);
          const hasImage = !!images[viewId];
          return (
            <div
              key={viewId}
              className="absolute cursor-pointer group"
              style={{
                left: x - SLOT_SIZE / 2,
                top: y - SLOT_SIZE / 2,
                width: SLOT_SIZE,
                height: SLOT_SIZE,
              }}
              onClick={() => handleSlotClick(viewId)}
            >
              <div
                className={`w-full h-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition-all duration-200 ${
                  hasImage
                    ? 'border-blue-500/60 bg-blue-500/10 shadow-lg shadow-blue-500/20'
                    : 'border-white/20 bg-white/5 hover:border-blue-500/40 hover:bg-white/10'
                }`}
              >
                {hasImage ? (
                  <>
                    <img
                      src={images[viewId]}
                      alt={PRO_VIEW_LABELS[viewId]}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={(e) => removeSlot(viewId, e)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500/90 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span className="text-[18px] text-white/40 font-light leading-none">+</span>
                )}
              </div>
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-black text-gray-500 uppercase">
                {PRO_VIEW_LABELS[viewId]}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[9px] text-gray-500 mt-10">
        已选 {filledCount}/{viewIds.length} 视角 · 至少 {minCount} 张可提交 · 点击「+」上传对应视角
      </p>
    </div>
  );
};

export default MultiViewUpload;
