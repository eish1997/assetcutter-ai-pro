import React, { useState } from 'react';
import TextureSlot from './TextureSlot';
import { generatePBRTexture } from '../services/geminiService';

const PBR_TEXTURE_IDS = ['ao', 'curvature', 'normal', 'position'] as const;
const PBR_TEXTURE_LABELS: Record<string, string> = {
  ao: 'AO',
  curvature: 'Curvature',
  normal: 'WS Normal',
  position: 'Position',
  base_color: 'Base Color',
  roughness: 'Roughness',
  metallic: 'Metallic',
};

interface TextureMapItem {
  id: string;
  type: string;
  url: string | null;
  base64: string | null;
}

type GenStatus = 'idle' | 'generating_base' | 'confirming' | 'generating_pbr' | 'completed';

const INITIAL_MAPS: TextureMapItem[] = PBR_TEXTURE_IDS.map((id) => ({
  id,
  type: PBR_TEXTURE_LABELS[id] ?? id,
  url: null,
  base64: null,
}));

interface GenerateTextureSectionProps {
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
}

const GenerateTextureSection: React.FC<GenerateTextureSectionProps> = ({ onLog }) => {
  const [functionalMaps, setFunctionalMaps] = useState<TextureMapItem[]>(INITIAL_MAPS);
  const [prompt, setPrompt] = useState('');
  const [baseColorMap, setBaseColorMap] = useState<TextureMapItem | null>(null);
  const [pbrMaps, setPbrMaps] = useState<TextureMapItem[]>([]);
  const [status, setStatus] = useState<GenStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const url = URL.createObjectURL(file);
      setFunctionalMaps((prev) =>
        prev.map((m) => (m.id === id ? { ...m, url, base64 } : m))
      );
    };
    reader.readAsDataURL(file);
  };

  const clearMap = (id: string) => {
    setFunctionalMaps((prev) =>
      prev.map((m) => (m.id === id ? { ...m, url: null, base64: null } : m))
    );
  };

  const handleGenerateBaseColor = async () => {
    const uploaded = functionalMaps.filter((m) => m.base64);
    if (uploaded.length === 0) {
      setError('请至少上传一张功能贴图。');
      return;
    }
    if (!prompt.trim()) {
      setError('请输入材质/视觉需求描述。');
      return;
    }
    setError(null);
    setStatus('generating_base');
    onLog?.('info', '开始生成 Base Color…', undefined);
    try {
      const result = await generatePBRTexture(
        uploaded.map((m) => ({ type: m.type, base64: m.base64 })),
        prompt.trim(),
        'BASE_COLOR'
      );
      setBaseColorMap({
        id: 'base_color',
        type: 'Base Color',
        url: result,
        base64: result,
      });
      setStatus('confirming');
      onLog?.('info', 'Base Color 生成完成', undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Base Color 生成失败';
      setError(msg);
      setStatus('idle');
      onLog?.('error', msg, String(err));
    }
  };

  const handleConfirmAndGeneratePBR = async () => {
    if (!baseColorMap?.base64) return;
    const uploaded = functionalMaps.filter((m) => m.base64);
    setError(null);
    setStatus('generating_pbr');
    onLog?.('info', '正在生成 Roughness / Metallic…', undefined);
    try {
      const [roughness, metallic] = await Promise.all([
        generatePBRTexture(
          uploaded.map((m) => ({ type: m.type, base64: m.base64 })),
          'Generate matching roughness',
          'ROUGHNESS',
          { base64: baseColorMap.base64 }
        ),
        generatePBRTexture(
          uploaded.map((m) => ({ type: m.type, base64: m.base64 })),
          'Generate matching metallic',
          'METALLIC',
          { base64: baseColorMap.base64 }
        ),
      ]);
      setPbrMaps([
        { id: 'roughness', type: 'Roughness', url: roughness, base64: roughness },
        { id: 'metallic', type: 'Metallic', url: metallic, base64: metallic },
      ]);
      setStatus('completed');
      onLog?.('info', 'PBR 贴图组生成完成', undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Roughness/Metallic 生成失败';
      setError(msg);
      setStatus('confirming');
      onLog?.('error', msg, String(err));
    }
  };

  const resetAll = () => {
    setFunctionalMaps(INITIAL_MAPS);
    setBaseColorMap(null);
    setPbrMaps([]);
    setPrompt('');
    setStatus('idle');
    setError(null);
  };

  const downloadTexture = (url: string, type: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type.replace(/\s+/g, '_').toLowerCase()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isReady = functionalMaps.some((m) => m.base64);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-4 space-y-4">
          <div className="glass p-6 rounded-2xl border border-white/10 bg-black/40 space-y-6">
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                1. 上传功能贴图
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {functionalMaps.map((map) => (
                  <TextureSlot
                    key={map.id}
                    type={map.type}
                    imageUrl={map.url}
                    onUpload={(e) => handleFileUpload(map.id, e)}
                    onClear={() => clearMap(map.id)}
                  />
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                2. 材质/视觉需求
              </h3>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：生锈的深蓝漆面金属，缝隙有污渍…"
                className="w-full h-28 bg-white/5 border border-white/10 rounded-xl p-3 text-[11px] text-white placeholder:text-gray-600 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                disabled={status !== 'idle' && status !== 'confirming'}
              />
            </div>
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] rounded-xl">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleGenerateBaseColor}
                disabled={!isReady || !prompt.trim() || status === 'generating_base' || status === 'generating_pbr'}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-gray-500 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all"
              >
                {status === 'generating_base' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    生成中…
                  </>
                ) : (
                  '生成 Base Color'
                )}
              </button>
              {status === 'confirming' && (
                <button
                  type="button"
                  onClick={handleConfirmAndGeneratePBR}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all"
                >
                  确认并生成 Roughness / Metallic
                </button>
              )}
              {status === 'completed' && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="w-full py-2.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-[10px] font-black uppercase transition-all"
                >
                  新建项目
                </button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            建议上传全部四张功能贴图。AI 会结合 AO、曲率、法线、位置信息生成符合 PBR 的 Base Color，再生成 Roughness / Metallic。
          </p>
        </aside>

        <main className="lg:col-span-8">
          <div className="glass rounded-2xl border border-white/10 overflow-hidden min-h-[400px] flex flex-col">
            <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">贴图预览</span>
              {status === 'completed' && (
                <button
                  type="button"
                  onClick={() => baseColorMap && downloadTexture(baseColorMap.url!, 'base_color')}
                  className="text-[10px] font-black uppercase text-blue-400 hover:text-blue-300"
                >
                  下载 Base Color
                </button>
              )}
            </div>
            <div className="flex-1 p-6 flex flex-col gap-6">
              <div>
                <h3 className="text-[10px] font-black uppercase text-gray-500 mb-2">Base Color (Albedo)</h3>
                <div className="aspect-[16/9] bg-black/40 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center overflow-hidden">
                  {status === 'generating_base' ? (
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-[10px]">正在生成…</span>
                    </div>
                  ) : baseColorMap ? (
                    <div className="w-full h-full relative group">
                      <img src={baseColorMap.url!} className="w-full h-full object-contain" alt="Base Color" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => downloadTexture(baseColorMap.url!, 'base_color')}
                          className="px-4 py-2 bg-white text-black rounded-xl text-[10px] font-black uppercase"
                        >
                          下载
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-600 text-[10px]">等待生成</span>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-[10px] font-black uppercase text-gray-500 mb-2">Roughness / Metallic</h3>
                <div className="grid grid-cols-2 gap-4">
                  {status === 'generating_pbr' ? (
                    [1, 2].map((i) => (
                      <div
                        key={i}
                        className="aspect-square bg-black/40 rounded-xl border border-white/10 flex items-center justify-center"
                      >
                        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                      </div>
                    ))
                  ) : pbrMaps.length > 0 ? (
                    pbrMaps.map((map) => (
                      <div
                        key={map.id}
                        className="group relative aspect-square bg-black/40 rounded-xl border border-white/10 overflow-hidden"
                      >
                        <div className="absolute top-2 left-2 z-10 text-[9px] font-black uppercase bg-black/70 px-2 py-1 rounded text-gray-300">
                          {map.type}
                        </div>
                        <img src={map.url!} className="w-full h-full object-cover" alt={map.type} />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            type="button"
                            onClick={() => downloadTexture(map.url!, map.type)}
                            className="px-3 py-1.5 bg-white text-black rounded-lg text-[9px] font-black uppercase"
                          >
                            下载
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    [1, 2].map((i) => (
                      <div
                        key={i}
                        className="aspect-square bg-black/20 rounded-xl border border-dashed border-white/10 flex items-center justify-center text-gray-600 text-[10px]"
                      >
                        —
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default GenerateTextureSection;
