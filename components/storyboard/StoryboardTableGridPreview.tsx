import React from 'react';
import type { StoryboardTableRow } from '../../types';
import StoryboardFrameCompositeCard from './StoryboardFrameCompositeCard';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_GRID_PREVIEW,
  STORYBOARD_PAD_PANEL,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  onSelect: (rowId: string) => void;
  onOpenInEditor: (rowId: string) => void;
  onPreviewImage: (src: string) => void;
};

/** 全屏纯分镜网格：样式与右侧合成卡一致，按宽度自动 N×M */
export default function StoryboardTableGridPreview({
  rows,
  activeRowId,
  onSelect,
  onOpenInEditor,
  onPreviewImage,
}: Props) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col ${STORYBOARD_PAD_PANEL} pt-1`}>
      <div className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pb-1`}>
        {rows.length === 0 ? (
          <p className="py-12 text-center text-[11px] text-gray-600">暂无镜头</p>
        ) : (
          <div className={STORYBOARD_GRID_PREVIEW}>
            {rows.map((row, i) => (
              <StoryboardFrameCompositeCard
                key={row.id}
                row={row}
                index={i}
                layout="grid"
                active={activeRowId === row.id}
                onSelect={() => onSelect(row.id)}
                onOpenInEditor={() => onOpenInEditor(row.id)}
                onPreviewImage={onPreviewImage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
