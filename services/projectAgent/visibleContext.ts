export type AgentVisibleContextSource =
  | 'project'
  | 'selection'
  | 'lightbox'
  | 'local_edit'
  | 'attachment'
  | 'conversation';

export type AgentVisibleContextRisk = 'none' | 'cost' | 'batch' | 'destructive';

export interface AgentVisibleContextSummary {
  title: string;
  chips: string[];
  targetIds?: string[];
  targetCount?: number;
  source: AgentVisibleContextSource;
  risk?: AgentVisibleContextRisk;
  stale?: boolean;
  details?: string[];
}

export type AgentVisibleSurfaceKind =
  | 'project'
  | 'selection'
  | 'lightbox'
  | 'local_edit'
  | 'conversation';

export interface AgentVisibleSurfaceInput {
  kind?: AgentVisibleSurfaceKind | null;
  targetId?: string | null;
  targetIds?: readonly (string | null | undefined)[] | null;
  title?: string | null;
}

export interface AgentVisibleSelectionInput {
  ids?: readonly (string | null | undefined)[] | null;
  activeId?: string | null;
}

export interface BuildAgentVisibleContextSummaryInput {
  projectName?: string | null;
  surface?: AgentVisibleSurfaceInput | null;
  selection?: AgentVisibleSelectionInput | null;
  attachmentCount?: number | null;
  stale?: boolean | null;
}

function compactIds(ids: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids ?? []) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function cleanText(value: string | null | undefined): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function positiveCount(value: number | null | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0;
}

function withCommonMeta(
  summary: AgentVisibleContextSummary,
  input: BuildAgentVisibleContextSummaryInput,
): AgentVisibleContextSummary {
  const attachmentCount = positiveCount(input.attachmentCount);
  const chips = [...summary.chips];
  const details = [...(summary.details ?? [])];

  if (attachmentCount > 0) {
    chips.push(`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`);
    details.push(`${attachmentCount} attached source${attachmentCount === 1 ? '' : 's'} available`);
  }

  if (input.stale) {
    chips.push('stale');
    details.push('Context may be out of date');
  }

  return {
    ...summary,
    chips,
    stale: input.stale ? true : undefined,
    details: details.length > 0 ? details : undefined,
  };
}

export function buildAgentVisibleContextSummary(
  input: BuildAgentVisibleContextSummaryInput = {},
): AgentVisibleContextSummary {
  const projectName = cleanText(input.projectName);
  const surface = input.surface ?? {};
  const surfaceTargetIds = compactIds([
    ...(surface.targetIds ?? []),
    surface.targetId,
  ]);
  const selectionIds = compactIds(input.selection?.ids);
  const activeSelectionId = cleanText(input.selection?.activeId);
  const targetIds = surfaceTargetIds.length > 0 ? surfaceTargetIds : selectionIds;
  const targetCount = targetIds.length;

  if (surface.kind === 'local_edit') {
    const title = cleanText(surface.title) ?? 'Local edit context';
    return withCommonMeta(
      {
        title,
        chips: ['local edit', targetCount > 0 ? `${targetCount} target${targetCount === 1 ? '' : 's'}` : 'active draft'],
        targetIds: targetCount > 0 ? targetIds : undefined,
        targetCount: targetCount > 0 ? targetCount : undefined,
        source: 'local_edit',
        risk: 'destructive',
        details: ['Changes may overwrite the active edit draft'],
      },
      input,
    );
  }

  if (surface.kind === 'lightbox') {
    const title = cleanText(surface.title) ?? 'Large image preview';
    return withCommonMeta(
      {
        title,
        chips: ['lightbox', targetCount > 0 ? '1 image' : 'preview'],
        targetIds: targetCount > 0 ? targetIds.slice(0, 1) : undefined,
        targetCount: targetCount > 0 ? 1 : undefined,
        source: 'lightbox',
        risk: 'cost',
      },
      input,
    );
  }

  if (targetCount > 0) {
    const isBatch = targetCount > 1;
    return withCommonMeta(
      {
        title: isBatch ? `${targetCount} selected assets` : 'Selected asset',
        chips: [isBatch ? `${targetCount} selected` : 'selected', ...(activeSelectionId ? ['active'] : [])],
        targetIds,
        targetCount,
        source: 'selection',
        risk: isBatch ? 'batch' : 'none',
        details: activeSelectionId ? [`Active target: ${activeSelectionId}`] : undefined,
      },
      input,
    );
  }

  const attachmentCount = positiveCount(input.attachmentCount);
  if (attachmentCount > 0) {
    return withCommonMeta(
      {
        title: `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`,
        chips: [],
        targetCount: attachmentCount,
        source: 'attachment',
        risk: 'cost',
      },
      input,
    );
  }

  if (surface.kind === 'conversation') {
    return withCommonMeta(
      {
        title: 'Conversation context',
        chips: ['conversation'],
        source: 'conversation',
        risk: 'none',
      },
      input,
    );
  }

  return withCommonMeta(
    {
      title: projectName ? `Project: ${projectName}` : 'Project context',
      chips: [projectName ?? 'project'],
      source: 'project',
      risk: 'none',
    },
    input,
  );
}
