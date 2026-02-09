import React, { useRef, useEffect, useState } from 'react';
import type { AppMode, LibraryItem } from '../types';

/** 主推：能力预设 + 工作流批量处理图片 */
const HERO_CARDS: { mode: AppMode; icon: string; title: string; desc: string; accent: string }[] = [
  { mode: 'WORKFLOW', icon: '⚡', title: '工作流', desc: '多图筛选 → 拖拽到功能框 → 一键批量处理图片', accent: 'from-blue-500/20 to-indigo-500/10' },
  { mode: 'CAPABILITY', icon: '◇', title: '能力', desc: '功能预设（拆分组件、转风格、多视角等），工作流中直接调用', accent: 'from-indigo-500/20 to-violet-500/10' },
];

const MORE_CARDS: { mode: AppMode; icon: string; title: string; desc: string; accent: string }[] = [
  { mode: 'DIALOG', icon: '💬', title: '对话', desc: '上传图片 + 描述 → AI 理解 → 生图', accent: 'from-blue-500/20 to-cyan-500/10' },
  { mode: 'TEXTURE', icon: '🖼', title: '贴图', desc: '提取花纹、贴图修缝、生成 PBR 贴图', accent: 'from-violet-500/20 to-purple-500/10' },
  { mode: 'GENERATE_3D', icon: '🧊', title: '生成3D', desc: '混元生3D · 文生/图生/拓扑/纹理', accent: 'from-cyan-500/20 to-blue-500/10' },
  { mode: 'LIBRARY', icon: '📁', title: '仓库', desc: '查看与下载已生成资产', accent: 'from-amber-500/15 to-orange-500/10' },
];

interface HomeSectionProps {
  onNavigate: (mode: AppMode) => void;
  library: LibraryItem[];
  onOpenAsset?: (item: LibraryItem) => void;
}

const CAROUSEL_SIZE = 12;
const CAROUSEL_INTERVAL_MS = 3500;

const HomeSection: React.FC<HomeSectionProps> = ({ onNavigate, library, onOpenAsset }) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const assets = library.slice(0, CAROUSEL_SIZE);
  const hasImage = (item: LibraryItem) => typeof item.data === 'string' && (item.data.startsWith('data:image') || item.data.startsWith('http'));

  useEffect(() => {
    if (assets.length <= 1) return;
    const t = setInterval(() => {
      setCarouselIndex((i) => (i + 1) % assets.length);
    }, CAROUSEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [assets.length]);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el || assets.length === 0) return;
    const card = el.querySelector(`[data-index="${carouselIndex}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [carouselIndex, assets.length]);

  return (
    <div className="relative min-h-[70vh]">
      <div className="relative max-w-4xl mx-auto space-y-14 pt-8 pb-14 px-4 sm:px-6">
        {/* Hero */}
        <header className="text-center">
          <h1 className="home-hero-title text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-[0.2em] sm:tracking-[0.3em]">
            AssetCutter AI Pro
          </h1>
          <p className="text-[11px] sm:text-xs text-gray-400 mt-4 uppercase tracking-[0.35em] font-medium">
            智能资产生产
          </p>
          <div className="mt-3 h-px w-24 mx-auto bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
          <p className="text-[10px] text-gray-500 mt-3 tracking-widest">
            能力预设 · 工作流批量处理图片
          </p>
        </header>

        {/* 主推：工作流 + 能力 */}
        <section>
          <h2 className="text-[9px] font-black uppercase tracking-[0.4em] text-blue-400/80 mb-1 text-center">
            主推
          </h2>
          <p className="text-[10px] text-gray-500 mb-4 text-center">能力预设 + 工作流批量处理图片</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {HERO_CARDS.map(({ mode, icon, title, desc, accent }, i) => (
              <button
                key={mode}
                type="button"
                onClick={() => onNavigate(mode)}
                className={`home-card glass rounded-2xl border border-blue-500/20 p-6 text-left transition-all duration-300 group relative overflow-hidden min-h-[140px] flex flex-col ${accent}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 from-white/5 to-transparent" />
                <span className="relative text-4xl block mb-3 opacity-90 group-hover:scale-110 group-hover:drop-shadow-lg transition-all duration-300">
                  {icon}
                </span>
                <div className="relative text-[12px] font-black uppercase tracking-wider text-white">
                  {title}
                </div>
                <div className="relative text-[10px] text-gray-500 mt-1.5 leading-snug group-hover:text-gray-400 transition-colors flex-1">
                  {desc}
                </div>
                <span className="relative inline-block mt-3 text-[9px] font-black uppercase text-blue-400/80 opacity-0 group-hover:opacity-100 transition-opacity">
                  进入 →
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 更多功能 */}
        <section>
          <h2 className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-500 mb-5 text-center">
            更多功能
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MORE_CARDS.map(({ mode, icon, title, desc, accent }, i) => (
              <button
                key={mode}
                type="button"
                onClick={() => onNavigate(mode)}
                className={`home-card glass rounded-2xl border border-white/10 p-6 text-left transition-all duration-300 group relative overflow-hidden min-h-[160px] flex flex-col ${accent}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 from-white/5 to-transparent" />
                <span className="relative text-4xl block mb-4 opacity-90 group-hover:scale-110 group-hover:drop-shadow-lg transition-all duration-300">
                  {icon}
                </span>
                <div className="relative text-[12px] font-black uppercase tracking-wider text-white">
                  {title}
                </div>
                <div className="relative text-[10px] text-gray-500 mt-1.5 leading-snug group-hover:text-gray-400 transition-colors flex-1">
                  {desc}
                </div>
                <span className="relative inline-block mt-3 text-[9px] font-black uppercase text-blue-400/80 opacity-0 group-hover:opacity-100 transition-opacity">
                  进入 →
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 参考资产轮播 */}
        <section className="animate-in fade-in duration-500">
          <h2 className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-500 mb-3 text-center">
            参考资产
          </h2>
          {assets.length > 0 ? (
            <>
              <div
                ref={carouselRef}
                className="flex gap-3 overflow-x-auto pb-2 no-scrollbar snap-x snap-mandatory scroll-smooth"
                style={{ scrollbarWidth: 'none' }}
              >
                {assets.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    data-index={i}
                    onClick={() => (onOpenAsset ? onOpenAsset(item) : onNavigate('LIBRARY'))}
                    className="shrink-0 w-28 h-28 rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:border-blue-500/30 transition-all snap-center flex flex-col"
                  >
                    {hasImage(item) ? (
                      <img
                        src={item.data}
                        alt={item.label}
                        className="w-full h-20 object-cover"
                      />
                    ) : (
                      <div className="w-full h-20 flex items-center justify-center text-2xl text-gray-600">
                        🧊
                      </div>
                    )}
                    <span className="flex-1 min-h-0 px-1.5 py-1 text-[9px] text-gray-400 truncate text-center">
                      {item.label || '未命名'}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex justify-center gap-1.5 mt-2">
                {assets.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`第 ${i + 1} 项`}
                    onClick={() => setCarouselIndex(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === carouselIndex ? 'bg-blue-500' : 'bg-white/20'}`}
                  />
                ))}
              </div>
              <div className="text-center mt-2">
                <button
                  type="button"
                  onClick={() => onNavigate('LIBRARY')}
                  className="text-[10px] font-black uppercase text-blue-400 hover:text-blue-300 transition-colors"
                >
                  查看全部 →
                </button>
              </div>
            </>
          ) : (
            <div className="glass rounded-2xl border border-white/10 p-6 text-center">
              <p className="text-[11px] text-gray-500 mb-3">暂无资产，前往对话 / 贴图生成后会自动入库</p>
              <button
                type="button"
                onClick={() => onNavigate('LIBRARY')}
                className="text-[10px] font-black uppercase text-blue-400 hover:text-blue-300"
              >
                打开仓库
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HomeSection;
