import React, { useMemo, useState } from 'react';
import {
  STORYBOARD_PARSE_PAGE_FIXED_LABELS,
  isParsePagePlaceholderFieldLabel,
  type StoryboardParsePageFieldParseResult,
  type StoryboardParsePageFixedLabel,
} from '../../services/storyboardParsePageCore';
import { STORYBOARD_FIELD_INPUT, STORYBOARD_TOOL_BTN_NEUTRAL } from './storyboardTableUi';

type Props = {
  result: StoryboardParsePageFieldParseResult;
  removedDynamicLabels: ReadonlySet<string>;
  addedDynamicLabels: ReadonlySet<string>;
  readOnly?: boolean;
  onToggleDynamic: (label: string) => void;
  onAddDynamic: (label: string) => void;
  onRenameDynamic?: (oldLabel: string, newLabel: string) => void;
};

function FixedFieldChip({
  label,
  detected,
}: {
  label: StoryboardParsePageFixedLabel;
  detected: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ${
        detected
          ? 'bg-white/[0.08] text-gray-100 ring-white/15'
          : 'bg-white/[0.03] text-gray-500 ring-white/[0.06]'
      }`}
      title={detected ? '本次文本中识别到该字段' : '固定字段（本次未识别到内容）'}
    >
      {label}
    </span>
  );
}

function DynamicFieldChip({
  label,
  hint,
  placeholder,
  readOnly,
  onToggle,
  onRename,
}: {
  label: string;
  hint?: string;
  placeholder: boolean;
  readOnly?: boolean;
  onToggle: () => void;
  onRename?: (newLabel: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startRename = () => {
    setDraft(label);
    setEditing(true);
  };

  const commitRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === label) return;
    onRename?.(next);
  };

  if (editing && !readOnly) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={commitRename}
          className={`${STORYBOARD_FIELD_INPUT} !h-6 w-[5.5rem] !py-0 !text-[10px]`}
        />
      </span>
    );
  }

  return (
    <span
      title={hint}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] ring-1 ${
        placeholder
          ? 'bg-amber-400/10 text-amber-100 ring-amber-400/30'
          : 'bg-sky-500/10 text-sky-100 ring-sky-400/25'
      }`}
    >
      {label}
      {placeholder && !readOnly ? (
        <button
          type="button"
          className="rounded px-0.5 text-[9px] leading-none text-amber-200/90 hover:bg-amber-400/20 hover:text-white"
          onClick={startRename}
        >
          命名
        </button>
      ) : null}
      {readOnly ? null : (
        <button
          type="button"
          className={`rounded px-0.5 text-[10px] leading-none hover:text-white ${
            placeholder ? 'text-amber-200/80 hover:bg-amber-400/20' : 'text-sky-200/80 hover:bg-sky-500/20'
          }`}
          aria-label={`移除字段 ${label}`}
          onClick={onToggle}
        >
          ×
        </button>
      )}
    </span>
  );
}

export default function StoryboardParseFieldTagPanel({
  result,
  removedDynamicLabels,
  addedDynamicLabels,
  readOnly = false,
  onToggleDynamic,
  onAddDynamic,
  onRenameDynamic,
}: Props) {
  const [draftLabel, setDraftLabel] = useState('');

  const visibleDynamic = useMemo(() => {
    const fromParse = result.dynamicLabels.filter((label) => !removedDynamicLabels.has(label));
    const added = [...addedDynamicLabels].filter((label) => !fromParse.includes(label));
    return [...fromParse, ...added];
  }, [addedDynamicLabels, removedDynamicLabels, result.dynamicLabels]);

  const visiblePlaceholders = useMemo(
    () => visibleDynamic.filter((label) => isParsePagePlaceholderFieldLabel(label)),
    [visibleDynamic]
  );

  const submitAdd = () => {
    const label = draftLabel.trim();
    if (!label) return;
    onAddDynamic(label);
    setDraftLabel('');
  };

  return (
    <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-gray-300">解析字段</span>
        <span className="text-[9px] tabular-nums text-gray-500">已识别 {result.shotBlocks.length} 镜</span>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] text-gray-500">固定字段</p>
        <div className="flex flex-wrap gap-1">
          {STORYBOARD_PARSE_PAGE_FIXED_LABELS.map((label) => (
            <FixedFieldChip
              key={label}
              label={label}
              detected={result.detectedFixedLabels.includes(label)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] text-gray-500">扩展字段（可移除或添加）</p>
        <div className="flex flex-wrap gap-1">
          {visibleDynamic.map((label) => {
            const hint = result.dynamicLabelHints[label];
            const placeholder = isParsePagePlaceholderFieldLabel(label);
            return (
              <DynamicFieldChip
                key={label}
                label={label}
                hint={hint && hint !== label ? hint : placeholder ? hint : undefined}
                placeholder={placeholder}
                readOnly={readOnly}
                onToggle={() => onToggleDynamic(label)}
                onRename={onRenameDynamic ? (newLabel) => onRenameDynamic(label, newLabel) : undefined}
              />
            );
          })}
          {!visibleDynamic.length ? (
            <span className="text-[9px] text-gray-600">暂无扩展字段，可自行添加</span>
          ) : null}
        </div>
        {visiblePlaceholders.length ? (
          <p className="text-[9px] leading-relaxed text-amber-200/80">
            {visiblePlaceholders.length} 个未识别列：悬停查看样例，点「命名」重命名或 × 移除后再生成分镜文本
          </p>
        ) : null}
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitAdd();
                }
              }}
              placeholder="添加字段名"
              className={`${STORYBOARD_FIELD_INPUT} !h-7 w-[7.5rem] !py-1 !text-[10px]`}
            />
            <button
              type="button"
              disabled={!draftLabel.trim()}
              onClick={submitAdd}
              className={`${STORYBOARD_TOOL_BTN_NEUTRAL} !h-7 !px-2 !text-[10px] disabled:opacity-40`}
            >
              添加
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
