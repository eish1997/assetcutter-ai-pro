import React from 'react';

interface TextureSlotProps {
  type: string;
  imageUrl: string | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  isLoading?: boolean;
}

const TextureSlot: React.FC<TextureSlotProps> = ({ type, imageUrl, onUpload, onClear, isLoading }) => {
  return (
    <div className="relative group rounded-xl bg-black/40 border border-white/10 overflow-hidden flex flex-col aspect-square">
      <div className="p-3 border-b border-white/10 bg-white/5 flex justify-between items-center z-10">
        <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">{type}</span>
        {imageUrl && !isLoading && (
          <button
            type="button"
            onClick={onClear}
            className="p-1 hover:bg-white/10 rounded-full text-gray-500 hover:text-red-400 transition-colors"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex-1 relative flex items-center justify-center">
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-gray-500 animate-pulse">生成中…</span>
          </div>
        ) : imageUrl ? (
          <img src={imageUrl} alt={type} className="w-full h-full object-cover" />
        ) : (
          <label className="flex flex-col items-center justify-center cursor-pointer w-full h-full hover:bg-white/5 transition-colors">
            <span className="mb-2 text-gray-500 group-hover:text-blue-400 transition-colors text-xl">↑</span>
            <span className="text-[10px] text-gray-500">上传贴图</span>
            <input type="file" className="hidden" accept="image/*" onChange={onUpload} />
          </label>
        )}
      </div>
    </div>
  );
};

export default TextureSlot;
