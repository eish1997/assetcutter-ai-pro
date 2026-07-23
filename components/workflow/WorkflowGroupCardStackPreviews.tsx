import React, { memo } from 'react';
import type { WorkflowAsset } from '../../types';
import { resolveGroupMemberCount, resolveGroupMemberPreviewSrc } from '../../services/groupHelpers';
import { previewSrcCacheFingerprint } from '../../services/workflowImageThumb';
import { WorkflowGridImage } from '../ProgressivePreviewImage';
import { WORKFLOW_GROUP_CARD_FACE_CLASS } from './workflowSectionUiConstants';

type StackLayer = {
  memberIndex: number;
  offsetClass: string;
  opacityClass: string;
};

/** 从后往前：第三张在最底，第二张居中 */
const STACK_LAYERS: StackLayer[] = [
  {
    memberIndex: 2,
    offsetClass: 'translate-x-[14px] translate-y-[14px] -rotate-[2deg]',
    opacityClass: 'opacity-70',
  },
  {
    memberIndex: 1,
    offsetClass: 'translate-x-[7px] translate-y-[7px] rotate-[1deg]',
    opacityClass: 'opacity-82',
  },
];

type Props = {
  groupAsset: WorkflowAsset;
  allAssets: WorkflowAsset[];
  getDisplayImage: (a: WorkflowAsset) => string;
  deferThumbnail?: boolean;
  thumbDecodePriority?: 'high' | 'low';
  companionBaseUrl?: string;
  companionProjectId?: string;
};

function WorkflowGroupCardStackPreviewsInner({
  groupAsset,
  allAssets,
  getDisplayImage,
  deferThumbnail = false,
  thumbDecodePriority = 'low',
  companionBaseUrl,
  companionProjectId,
}: Props) {
  const memberCount = resolveGroupMemberCount(groupAsset);
  if (memberCount <= 1) return null;

  return (
    <>
      {STACK_LAYERS.map(({ memberIndex, offsetClass, opacityClass }) => {
        if (memberIndex >= memberCount) return null;
        const src = resolveGroupMemberPreviewSrc(groupAsset, memberIndex, allAssets, getDisplayImage);
        if (!src.trim()) return null;
        const cacheKey = `${groupAsset.id}:stack:${memberIndex}:fp${previewSrcCacheFingerprint(src)}`;
        return (
          <div
            key={memberIndex}
            aria-hidden
            className={`pointer-events-none absolute left-0 top-0 overflow-hidden rounded-2xl bg-[#121214] shadow-lg shadow-black/35 ${WORKFLOW_GROUP_CARD_FACE_CLASS} ${offsetClass} ${opacityClass}`}
          >
            <WorkflowGridImage
              fullSrc={src}
              cacheKey={cacheKey}
              deferThumbnail={deferThumbnail}
              thumbDecodePriority={thumbDecodePriority}
              imageFetchPriority="low"
              thumbMaxEdge={320}
              companionBaseUrl={companionBaseUrl}
              companionProjectId={companionProjectId}
              className="relative h-full w-full"
              imgClassName="block h-full w-full scale-110 object-cover blur-2xl brightness-[0.72] saturate-[0.85]"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            />
          </div>
        );
      })}
    </>
  );
}

export default memo(WorkflowGroupCardStackPreviewsInner);
