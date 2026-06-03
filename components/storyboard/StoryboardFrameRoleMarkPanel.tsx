import React, { useMemo, useState } from 'react';
import type { StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import { resolveStoryboardRowFrameDisplaySrc } from '../../services/storyboardFrameImageUrl';
import { resolveStoryboardFrameRoleMarkDisplayName } from '../../services/storyboardFrameRoleMarks';
import { isStoryboardRoleReplaceEligible } from '../../services/storyboardEditEligibility';
import { storyboardRowIsPassed } from './storyboardRowDisplay';
import {
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

type Props = {
  row: StoryboardTableRow;
  roleAssets: StoryboardRoleAsset[];
  selectedMarkId: string | null;
  readOnly?: boolean;
  onSelectMark: (markId: string) => void;
  onAddMark: (mark: { name: string; x: number; y: number; roleAssetId?: string }) => void;
  onRemoveMark: (markId: string) => void;
  onFocusMark: (markId: string) => void;
};

export default function StoryboardFrameRoleMarkPanel({
  row,
  roleAssets,
  selectedMarkId,
  readOnly = false,
  onSelectMark,
  onAddMark,
  onRemoveMark,
  onFocusMark,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const marks = row.frameRoleMarks ?? [];
  const passed = storyboardRowIsPassed(row);
  const hasImage = Boolean(resolveStoryboardRowFrameDisplaySrc(row));
  const namedAssets = useMemo(
    () => roleAssets.filter((asset) => asset.name.trim()),
    [roleAssets]
  );
  const canEdit = !readOnly && !passed && hasImage;
  const roleReplaceEligible = isStoryboardRoleReplaceEligible(row, roleAssets);

  const addAtCenter = (mark: { name: string; roleAssetId?: string }) => {
    onAddMark({ ...mark, x: 0.5, y: 0.5 });
    setAddOpen(false);
    setCustomName('');
  };

  const submitCustom = () => {
    const name = customName.trim();
    if (!name) return;
    addAtCenter({ name });
  };

  return (
    <div className="mb-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0 text-[9px]`}>
          角色标注 <span className="font-normal text-gray-600">· {marks.length}</span>
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setAddOpen((prev) => !prev)}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} !h-7 shrink-0 !px-2 !text-[9px]`}
          >
            {addOpen ? '收起' : '添加'}
          </button>
        ) : null}
      </div>
      {canEdit && addOpen ? (
        <div className="mb-1.5 space-y-1 rounded-lg border border-white/[0.06] bg-black/20 px-1.5 py-1.5">
          {namedAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => addAtCenter({ name: asset.name.trim(), roleAssetId: asset.id })}
              className="flex w-full items-center rounded-md px-2 py-1 text-left text-[10px] text-gray-200 hover:bg-white/[0.06]"
            >
              {asset.name}
            </button>
          ))}
          <div className="flex gap-1 pt-0.5">
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitCustom();
                }
              }}
              placeholder={namedAssets.length ? '或自定义名称' : '输入角色名'}
              className={`${STORYBOARD_FIELD_INPUT} h-7 min-w-0 flex-1 text-[10px]`}
            />
            <button
              type="button"
              onClick={submitCustom}
              className="shrink-0 rounded-lg bg-white/[0.08] px-2 text-[9px] text-gray-200 hover:bg-white/[0.12]"
            >
              确定
            </button>
          </div>
        </div>
      ) : null}
      {!hasImage ? (
        <p className="text-[9px] leading-snug text-gray-600">请先为镜头配图后再标注角色</p>
      ) : passed ? (
        <p className="text-[9px] leading-snug text-gray-600">已通过镜头不可编辑标注</p>
      ) : marks.length ? (
        <ul className="space-y-1">
          {marks.map((mark) => {
            const label = resolveStoryboardFrameRoleMarkDisplayName(mark, roleAssets);
            const active = selectedMarkId === mark.id;
            return (
              <li
                key={mark.id}
                className={`flex items-center gap-1 rounded-lg border px-1 py-0.5 ${
                  active
                    ? 'border-sky-400/35 bg-sky-500/15 ring-1 ring-sky-400/35'
                    : roleReplaceEligible
                      ? 'border-emerald-400/45 ring-1 ring-emerald-400/40 hover:bg-emerald-500/[0.06]'
                      : 'border-transparent hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectMark(mark.id);
                    onFocusMark(mark.id);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[10px] text-gray-200"
                  title={label}
                >
                  {label}
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label="删除标注"
                    onClick={() => onRemoveMark(mark.id)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-white/[0.06] hover:text-rose-300"
                  >
                    <AppIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[9px] leading-snug text-gray-600">
          {namedAssets.length
            ? '点击添加，或在画板分镜图上右键/点选位置标注'
            : '请先在解析页添加角色资产，或使用画板右键自定义名称'}
        </p>
      )}
    </div>
  );
}
