import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef } from '../../types';
import type { StoryboardDurationGroup } from '../../services/storyboardGridDurationGroups';
import { storyboardDurationGroupMergeSignature } from '../../services/storyboardGridDurationGroups';
import { mergeStoryboardGroupPreviewDataUrl } from '../../services/storyboardFrameStripMerge';
import { storyboardGroupCompositeFieldItems } from './storyboardRowDisplay';
import { storyboardGroupCompositeDomId } from './storyboardTableDom';
import StoryboardFrameCompositeCard from './StoryboardFrameCompositeCard';

type Props = {
  group: StoryboardDurationGroup;
  fieldCatalog: StoryboardParseFieldDef[];
  active: boolean;
  onSelect: () => void;
  onOpenInEditor?: () => void;
  onPreviewImage: (src: string) => void;
};

function StoryboardDurationGroupCompositeCard({
  group,
  fieldCatalog,
  active,
  onSelect,
  onOpenInEditor,
  onPreviewImage,
}: Props) {
  const mergeSig = useMemo(() => storyboardDurationGroupMergeSignature(group), [group]);
  const groupRef = useRef(group);
  groupRef.current = group;
  const [mergedSrc, setMergedSrc] = useState<string | null>(null);
  const [mergeStatus, setMergeStatus] = useState<'pending' | 'failed' | 'done'>('pending');
  const fieldItems = useMemo(
    () => storyboardGroupCompositeFieldItems(group.rows, fieldCatalog),
    [fieldCatalog, group.rows]
  );

  const fallbackText = useMemo(
    () =>
      group.rows
        .map((row) => storyboardGroupCompositeFieldItems([row], fieldCatalog))
        .flat()
        .map((item) => `【${item.label}】${item.value}`)
        .join('\n'),
    [fieldCatalog, group.rows]
  );

  useEffect(() => {
    let cancelled = false;
    setMergedSrc(null);
    setMergeStatus('pending');
    void mergeStoryboardGroupPreviewDataUrl(groupRef.current).then((url) => {
      if (cancelled) return;
      setMergedSrc(url);
      setMergeStatus(url ? 'done' : 'failed');
    });
    return () => {
      cancelled = true;
    };
  }, [mergeSig]);

  const durationSec = group.totalDurationSec;
  const durationLabel = `${
    Number.isInteger(durationSec) ? durationSec : durationSec.toFixed(1)
  }s${group.hasEstimatedDuration ? '*' : ''}`;
  const anchorRow = group.rows[0]!;
  const showLocked = group.rows.some((r) => r.locked);

  return (
    <StoryboardFrameCompositeCard
      domId={storyboardGroupCompositeDomId(group.id)}
      row={anchorRow}
      index={group.startIndex}
      active={active}
      mergedPreview
      mergeStatus={mergeStatus === 'done' ? undefined : mergeStatus}
      showLocked={showLocked}
      previewSrcOverride={mergedSrc || undefined}
      titleOverride={group.shotRangeLabel}
      durationLabelOverride={durationLabel}
      fieldItems={fieldItems}
      fallbackText={fallbackText}
      onSelect={onSelect}
      onOpenInEditor={onOpenInEditor}
      onPreviewImage={onPreviewImage}
    />
  );
}

function groupCompositePropsEqual(prev: Props, next: Props): boolean {
  if (prev.active !== next.active || prev.fieldCatalog !== next.fieldCatalog) return false;
  if (prev.group.id !== next.group.id) return false;
  return (
    storyboardDurationGroupMergeSignature(prev.group) ===
    storyboardDurationGroupMergeSignature(next.group)
  );
}

export default memo(StoryboardDurationGroupCompositeCard, groupCompositePropsEqual);
