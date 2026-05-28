import React from 'react';
import {
  IMAGE_PROCESS_PROCESSORS,
  REMBG_MODEL_OPTIONS,
  type ImageProcessorId,
  normalizeProcessorParams,
} from '../../services/capabilityProcessors/imageProcessProcessors';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from '../ui/CustomDropdown';

export type ImageProcessProcessorFieldsProps = {
  processorId: ImageProcessorId;
  params: Record<string, unknown>;
  onProcessorIdChange: (id: ImageProcessorId) => void;
  onParamsChange: (params: Record<string, unknown>) => void;
  portalZIndex?: { backdrop: number; list: number };
  lockProcessor?: boolean;
};

function patchParams(
  prev: Record<string, unknown>,
  processorId: ImageProcessorId,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return normalizeProcessorParams(processorId, { ...prev, ...patch });
}

export default function ImageProcessProcessorFields({
  processorId,
  params,
  onProcessorIdChange,
  onParamsChange,
  portalZIndex,
  lockProcessor = false,
}: ImageProcessProcessorFieldsProps) {
  const meta = IMAGE_PROCESS_PROCESSORS.find((p) => p.id === processorId);
  const cutMode =
    params.cutMode === 'uniform' || params.cutMode === 'auto' || params.cutMode === 'vision'
      ? params.cutMode
      : 'auto';

  return (
    <div className="space-y-3">
      {!lockProcessor ? (
        <div>
          <span className="text-[8px] font-black text-gray-500 uppercase">处理器类型</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {IMAGE_PROCESS_PROCESSORS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onProcessorIdChange(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-colors ${
                  processorId === p.id
                    ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300'
                    : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'
                }`}
                title={p.desc}
              >
                {p.label}
              </button>
            ))}
          </div>
          {meta?.desc ? <p className="text-[8px] text-gray-600 mt-0.5">{meta.desc}</p> : null}
        </div>
      ) : (
        <div className="text-[9px] text-blue-300/95 font-black uppercase">
          内置 · {meta?.label ?? processorId}
        </div>
      )}

      {processorId === 'cut_image' && (
        <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3 space-y-3">
          <div>
            <span className="text-[8px] font-black text-gray-500 uppercase">切割模式</span>
            <div className="flex gap-1 mt-1">
              {(
                [
                  { value: 'uniform', label: '均匀' },
                  { value: 'auto', label: '自动' },
                  { value: 'vision', label: '视觉' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => onParamsChange(patchParams(params, processorId, { cutMode: mode.value }))}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-colors ${
                    cutMode === mode.value
                      ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300'
                      : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          {cutMode === 'uniform' && (
            <div className="flex gap-2 items-center">
              <label className="flex items-center gap-1.5 text-[9px] text-gray-400">
                <span className="uppercase">行</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={typeof params.uniformRows === 'number' ? params.uniformRows : 2}
                  onChange={(e) =>
                    onParamsChange(
                      patchParams(params, processorId, {
                        uniformRows: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 2))),
                      })
                    )
                  }
                  className="w-14 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-lg px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[9px] text-gray-400">
                <span className="uppercase">列</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={typeof params.uniformCols === 'number' ? params.uniformCols : 2}
                  onChange={(e) =>
                    onParamsChange(
                      patchParams(params, processorId, {
                        uniformCols: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 2))),
                      })
                    )
                  }
                  className="w-14 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-lg px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-[8px] font-black text-gray-500 uppercase">切割溢出（每边像素）</span>
            <input
              type="number"
              min={0}
              max={512}
              value={typeof params.cutOverflowPx === 'number' ? params.cutOverflowPx : 0}
              onChange={(e) =>
                onParamsChange(
                  patchParams(params, processorId, {
                    cutOverflowPx: Math.max(0, Math.min(512, Math.round(Number(e.target.value) || 0))),
                  })
                )
              }
              className="mt-1 w-28 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            />
          </label>
          <label className="block">
            <span className="text-[8px] font-black text-gray-500 uppercase">可选补充说明</span>
            <textarea
              value={typeof params.instruction === 'string' ? params.instruction : ''}
              onChange={(e) => onParamsChange(patchParams(params, processorId, { instruction: e.target.value }))}
              rows={2}
              placeholder="留空即使用内置逻辑"
              className="mt-1 w-full resize-none rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            />
          </label>
        </div>
      )}

      {processorId === 'split_component' && (
        <p className="text-[8px] text-gray-500">
          自动识别图中最大物体区域并裁剪；工作流请拖入图片卡。
        </p>
      )}

      {processorId === 'sam_segment' && (
        <div className="space-y-2">
          <p className="text-[8px] text-gray-500">
            需配对本地伴侣并启动 SamLocal。队列执行时在图像中心取前景点；精细点选请用大图「本机分割」工具。
          </p>
          <label className="block">
            <span className="text-[8px] font-black text-gray-500 uppercase">说明（可选）</span>
            <textarea
              value={typeof params.instruction === 'string' ? params.instruction : ''}
              onChange={(e) => onParamsChange(patchParams(params, processorId, { instruction: e.target.value }))}
              rows={2}
              className="mt-1 w-full resize-none rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            />
          </label>
        </div>
      )}

      {processorId === 'remove_bg' && (
        <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3 space-y-3">
          <label className="flex items-center gap-2 text-[9px] text-gray-400">
            <span className="font-black uppercase">rembg 模型</span>
            <CustomDropdown
              options={REMBG_MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={typeof params.model === 'string' ? params.model : ''}
              onChange={(v) => onParamsChange(patchParams(params, processorId, { model: v || undefined }))}
              placeholder="默认（u2net）"
              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
              portalZIndex={portalZIndex}
            />
          </label>
          <label className="flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={params.alphaMatting === true}
              onChange={(e) => onParamsChange(patchParams(params, processorId, { alphaMatting: e.target.checked || undefined }))}
            />
            <span className="font-black uppercase">Alpha Matting（更慢）</span>
          </label>
        </div>
      )}

      {processorId === 'host_bundle' && (
        <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3 space-y-2">
          <label className="block">
            <span className="text-[9px] text-gray-500 uppercase">扩展包目录名</span>
            <input
              value={typeof params.dirName === 'string' ? params.dirName : ''}
              onChange={(e) => onParamsChange(patchParams(params, processorId, { dirName: e.target.value }))}
              placeholder="与设置页「已安装扩展包」列表中的名称一致"
              className="mt-0.5 w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/45"
            />
          </label>
          <label className="flex items-center gap-2 text-[9px] text-gray-400">
            <span className="font-black uppercase">运行方式</span>
            <CustomDropdown
              options={[
                { value: 'exec', label: '正式运行' },
                { value: 'probe', label: '仅检测' },
              ]}
              value={params.phase === 'probe' ? 'probe' : 'exec'}
              onChange={(v) => onParamsChange(patchParams(params, processorId, { phase: v === 'probe' ? 'probe' : 'exec' }))}
              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
              portalZIndex={portalZIndex}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function defaultParamsForImageProcessor(processorId: ImageProcessorId): Record<string, unknown> {
  switch (processorId) {
    case 'cut_image':
      return normalizeProcessorParams('cut_image', { cutMode: 'auto', uniformRows: 2, uniformCols: 2, cutOverflowPx: 0 });
    case 'remove_bg':
      return normalizeProcessorParams('remove_bg', {});
    case 'host_bundle':
      return normalizeProcessorParams('host_bundle', { phase: 'exec', dirName: '' });
    default:
      return normalizeProcessorParams(processorId, {});
  }
}
