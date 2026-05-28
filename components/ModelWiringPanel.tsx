import React, { useMemo } from 'react';
import { modelWiringRows, type ModelWiringRow, type WiringOutletStepState } from '../services/modelRegistry/modelWiringCatalog';
import type { ChannelId } from '../services/modelRegistry/types';

const ROLE_LABELS = { text: '文本 / 理解', image: '生图' } as const;

const OUTLET_STATE_CLS: Record<WiringOutletStepState, string> = {
  active: 'text-emerald-300 ring-emerald-500/35 bg-emerald-950/35',
  standby: 'text-gray-400 ring-white/[0.1] bg-white/[0.04]',
  pending: 'text-amber-300 ring-amber-500/30 bg-amber-950/25',
  off: 'text-gray-600 ring-white/[0.06] bg-transparent opacity-60',
};

function WiringRowCard({ row }: { row: ModelWiringRow }) {
  return (
    <div className="rounded-lg border border-[#2a2a30] bg-[#141418] px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[10px] font-semibold text-gray-100">{row.skuLabel}</span>
        <code className="text-[9px] text-gray-500">{row.registryId}</code>
        {row.pickedOutletLabel ? (
          <span className="text-[9px] text-emerald-400/90">→ {row.pickedOutletLabel}</span>
        ) : (
          <span className="text-[9px] text-amber-400/90">→ 无可用输出口</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {row.outlets.map((step) => (
          <span
            key={`${row.registryId}-${row.role}-${step.channel}`}
            title={`priority ${step.priority}`}
            className={`rounded-md px-2 py-0.5 text-[8px] font-medium ring-1 ${OUTLET_STATE_CLS[step.state]}`}
          >
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export type ModelWiringPanelProps = {
  enabledChannels: ChannelId[];
};

export default function ModelWiringPanel({ enabledChannels }: ModelWiringPanelProps) {
  const rows = useMemo(() => modelWiringRows(enabledChannels), [enabledChannels]);
  const textRows = rows.filter((r) => r.role === 'text');
  const imageRows = rows.filter((r) => r.role === 'image');

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-1">型号接线</p>
        <p className="text-[9px] text-gray-500 leading-relaxed">
          每个<strong className="text-gray-400">输入口（型号）</strong>按优先级尝试已启用的输出口；绿色为当前生效，灰色为备选，琥珀为已启用待配置，暗色为未启用。
          调整输出口开关或凭证后，此处即时反映。单条接线覆盖由运营 model-ops 配置。
        </p>
      </div>

      {(['text', 'image'] as const).map((role) => {
        const group = role === 'text' ? textRows : imageRows;
        if (group.length === 0) return null;
        return (
          <div key={role} className="space-y-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{ROLE_LABELS[role]}</p>
            <div className="space-y-2">
              {group.map((row) => (
                <div key={`${row.registryId}-${row.role}`}>
                  <WiringRowCard row={row} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
