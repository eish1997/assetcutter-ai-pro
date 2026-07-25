import React from 'react';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { Generate3DPreset } from '../../types';

const PRO_FORMAT_OPTIONS = [
  { value: '', label: 'OBJ+GLB（默认）' },
  { value: 'FBX', label: 'FBX' },
  { value: 'STL', label: 'STL' },
  { value: 'USDZ', label: 'USDZ' },
] as const;

const RAPID_FORMAT_OPTIONS = [
  { value: 'GLB', label: 'GLB' },
  { value: 'FBX', label: 'FBX' },
  { value: 'OBJ', label: 'OBJ' },
  { value: 'STL', label: 'STL' },
  { value: 'USDZ', label: 'USDZ' },
  { value: 'MP4', label: 'MP4' },
] as const;

type Props = {
  value: Generate3DPreset;
  onChange: (next: Generate3DPreset) => void;
  triggerClassName?: string;
  portalZIndex?: { backdrop: number; list: number };
};

const TencentGenerate3DPresetFields: React.FC<Props> = ({
  value,
  onChange,
  triggerClassName,
  portalZIndex,
}) => {
  const isPro = (value.module ?? 'pro') === 'pro';
  const isLowPoly = value.generateType === 'LowPoly';

  return (
    <div className="w-full space-y-2">
      <div className="text-[8px] text-gray-500 leading-relaxed">
        工作流拖<strong className="text-gray-400">图片</strong>到该能力即可图生 3D（暂不支持多视角与文生）。
        用户主路走 AI Gateway 平台 Key；<code className="text-gray-400">VITE_TENCENT_PROXY</code> 仅本地诊断。
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1.5 text-[9px]">
          <span>子能力</span>
          <CustomDropdown
            options={[
              { value: 'pro', label: '专业版' },
              { value: 'rapid', label: '极速版' },
            ]}
            value={value.module ?? 'pro'}
            onChange={(v) => onChange({ ...value, module: v as 'pro' | 'rapid' })}
            triggerClassName={triggerClassName}
            portalZIndex={portalZIndex}
          />
        </label>
        {isPro ? (
          <>
            <label className="flex items-center gap-1.5 text-[9px]">
              <span>版本</span>
              <CustomDropdown
                options={[
                  { value: '3.0', label: '3.0' },
                  { value: '3.1', label: '3.1' },
                ]}
                value={value.model ?? '3.0'}
                onChange={(v) => onChange({ ...value, model: v as '3.0' | '3.1' })}
                triggerClassName={triggerClassName}
                portalZIndex={portalZIndex}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[9px]">
              <span>类型</span>
              <CustomDropdown
                options={[
                  { value: 'Normal', label: '带纹理' },
                  { value: 'LowPoly', label: '智能拓扑' },
                  { value: 'Geometry', label: '白模' },
                  { value: 'Sketch', label: '草图' },
                ]}
                value={value.generateType ?? 'Normal'}
                onChange={(v) =>
                  onChange({
                    ...value,
                    generateType: v as Generate3DPreset['generateType'],
                  })
                }
                triggerClassName={triggerClassName}
                portalZIndex={portalZIndex}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[9px]">
              <span>面数</span>
              <input
                type="number"
                min={isLowPoly ? 3000 : 10000}
                max={1500000}
                step={10000}
                value={value.faceCount ?? 100000}
                onChange={(e) =>
                  onChange({
                    ...value,
                    faceCount: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                className="w-24 rounded bg-white/[0.06] px-2 py-1 text-[9px] ring-1 ring-white/[0.08]"
              />
            </label>
            {isLowPoly ? (
              <label className="flex items-center gap-1.5 text-[9px]">
                <span>多边形</span>
                <CustomDropdown
                  options={[
                    { value: 'triangle', label: '三角' },
                    { value: 'quadrilateral', label: '四边' },
                  ]}
                  value={value.polygonType ?? 'triangle'}
                  onChange={(v) =>
                    onChange({ ...value, polygonType: v as 'triangle' | 'quadrilateral' })
                  }
                  triggerClassName={triggerClassName}
                  portalZIndex={portalZIndex}
                />
              </label>
            ) : null}
            <label className="flex items-center gap-1.5 text-[9px]">
              <span>格式</span>
              <CustomDropdown
                options={PRO_FORMAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={value.resultFormat ?? ''}
                onChange={(v) => onChange({ ...value, resultFormat: v || undefined })}
                triggerClassName={triggerClassName}
                portalZIndex={portalZIndex}
              />
            </label>
          </>
        ) : (
          <label className="flex items-center gap-1.5 text-[9px]">
            <span>格式</span>
            <CustomDropdown
              options={RAPID_FORMAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={value.resultFormat ?? 'GLB'}
              onChange={(v) => onChange({ ...value, resultFormat: v })}
              triggerClassName={triggerClassName}
              portalZIndex={portalZIndex}
            />
          </label>
        )}
        <label className="flex items-center gap-1.5 text-[9px]">
          <input
            type="checkbox"
            checked={value.enablePBR ?? false}
            onChange={(e) => onChange({ ...value, enablePBR: e.target.checked })}
          />
          <span>PBR</span>
        </label>
      </div>
    </div>
  );
};

export default TencentGenerate3DPresetFields;
