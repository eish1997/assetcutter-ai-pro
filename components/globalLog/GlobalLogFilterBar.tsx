import React from 'react';
import {
  type GlobalLogFilterState,
  type GlobalLogLevelFilter,
} from '../../services/globalLogFilter';

const LEVEL_OPTIONS: Array<{ id: GlobalLogLevelFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'important', label: '重要' },
  { id: 'error', label: '错误' },
  { id: 'warn', label: '警告' },
  { id: 'info', label: '信息' },
];

type GlobalLogFilterBarProps = {
  filter: GlobalLogFilterState;
  moduleCounts: Array<{ module: string; count: number }>;
  filteredCount: number;
  totalCount: number;
  showReset: boolean;
  onChange: (patch: Partial<GlobalLogFilterState>) => void;
  onReset: () => void;
};

function chipClass(active: boolean): string {
  return `px-2 py-0.5 rounded-md text-[8px] font-black border transition-colors ${
    active
      ? 'border-blue-500/60 bg-blue-950/35 text-blue-200'
      : 'border-white/[0.08] bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-gray-300'
  }`;
}

function toggleClass(active: boolean): string {
  return `px-2 py-0.5 rounded-md text-[8px] font-black border transition-colors ${
    active
      ? 'border-emerald-500/45 bg-emerald-950/30 text-emerald-200'
      : 'border-white/[0.08] bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-gray-300'
  }`;
}

export function GlobalLogFilterBar({
  filter,
  moduleCounts,
  filteredCount,
  totalCount,
  showReset,
  onChange,
  onReset,
}: GlobalLogFilterBarProps) {
  return (
    <div className="shrink-0 px-4 py-2.5 border-t border-white/[0.06] bg-[#121214] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-gray-500">
          筛选 {filteredCount} / 共 {totalCount} 条
        </span>
        {showReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[9px] text-gray-400 hover:text-gray-200 transition-colors"
          >
            重置筛选
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
        {LEVEL_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange({ level: opt.id })}
            className={chipClass(filter.level === opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {moduleCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1 max-h-[52px] overflow-y-auto no-scrollbar">
          <button
            type="button"
            onClick={() => onChange({ module: 'all' })}
            className={chipClass(filter.module === 'all')}
          >
            全部来源
          </button>
          {moduleCounts.map(({ module, count }) => (
            <button
              key={module}
              type="button"
              onClick={() => onChange({ module })}
              className={chipClass(filter.module === module)}
            >
              {module}({count})
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ retryableOnly: !filter.retryableOnly })}
          className={toggleClass(filter.retryableOnly)}
        >
          可重试
        </button>
        <button
          type="button"
          onClick={() => onChange({ hideAiQueueInfo: !filter.hideAiQueueInfo })}
          className={toggleClass(filter.hideAiQueueInfo)}
        >
          隐藏AI排队
        </button>
        <input
          type="search"
          value={filter.keyword}
          onChange={(e) => onChange({ keyword: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="搜索消息…"
          aria-label="搜索运行日志"
          className="flex-1 min-w-[120px] px-2 py-1 rounded-md border border-white/10 bg-white/[0.04] text-[10px] text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500/40"
        />
      </div>
    </div>
  );
}
