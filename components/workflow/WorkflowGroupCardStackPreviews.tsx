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
  /** 磁盘文件夹没有组成员资产时，仍画出两层空卡，对齐原来的成组堆叠 */
  forceStack?: boolean;
  /** 直接给封面层用的 src（作坊文件夹预览），优先于组成员查找 */
  memberSrcs?: string[];
  deferThumbnail?: boolean;
  thumbDecodePriority?: 'high' | 'low';
  companionBaseUrl?: string;
  companionProjectId?: string;
};

function WorkflowGroupCardStackPreviewsInner({
  groupAsset,
  allAssets,
  getDisplayImage,
  forceStack = false,
  memberSrcs,
  deferThumbnail = false,
  thumbDecodePriority = 'low',
  companionBaseUrl,
  companionProjectId,
}: Props) {
  const memberCount = Math.max(
    resolveGroupMemberCount(groupAsset),
    Array.isArray(memberSrcs) ? memberSrcs.filter((s) => String(s || '').trim()).length : 0,
  );
  if (memberCount <= 1 && !forceStack) return null;

  return (
    <>
      {STACK_LAYERS.map(({ memberIndex, offsetClass, opacityClass }) => {
        if (!forceStack && memberIndex >= memberCount) return null;
        const fromList = Array.isArray(memberSrcs) ? String(memberSrcs[memberIndex] || '').trim() : '';
        const src =
          fromList || resolveGroupMemberPreviewSrc(groupAsset, memberIndex, allAssets, getDisplayImage);
        return (
          <div
            key={memberIndex}
            aria-hidden
            className={`pointer-events-none absolute left-0 top-0 overflow-hidden rounded-2xl bg-[#121214] shadow-lg shadow-black/35 ring-1 ring-white/[0.06] ${WORKFLOW_GROUP_CARD_FACE_CLASS} ${offsetClass} ${opacityClass}`}
          >
            {src.trim() ? (
              <WorkflowGridImage
                fullSrc={src}
                cacheKey={`${groupAsset.id}:stack:${memberIndex}:fp${previewSrcCacheFingerprint(src)}`}
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
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export default memo(WorkflowGroupCardStackPreviewsInner);
