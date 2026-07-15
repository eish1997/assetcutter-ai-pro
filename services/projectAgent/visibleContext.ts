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
    chips.push(`${attachmentCount} 个上下文资产`);
    details.push(`已挂载 ${attachmentCount} 个可供 Agent 读取的资产或文件`);
  }

  if (input.stale) {
    chips.push('可能过期');
    details.push('当前上下文可能已过期，执行前应重新确认范围');
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
    const title = cleanText(surface.title) ?? '当前编辑草稿';
    return withCommonMeta(
      {
        title,
        chips: ['编辑草稿', targetCount > 0 ? `${targetCount} 个对象` : '当前草稿'],
        targetIds: targetCount > 0 ? targetIds : undefined,
        targetCount: targetCount > 0 ? targetCount : undefined,
        source: 'local_edit',
        risk: 'destructive',
        details: ['可能影响当前编辑草稿，执行前需要确认是否保留原内容'],
      },
      input,
    );
  }

  if (surface.kind === 'lightbox') {
    const title = cleanText(surface.title) ?? '当前预览资产';
    return withCommonMeta(
      {
        title,
        chips: ['当前预览', targetCount > 0 ? '1 个资产' : '预览中'],
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
        title: isBatch ? `已选 ${targetCount} 个资产` : '当前选中资产',
        chips: [isBatch ? `${targetCount} 个资产` : '选中资产', ...(activeSelectionId ? ['当前目标'] : [])],
        targetIds,
        targetCount,
        source: 'selection',
        risk: isBatch ? 'batch' : 'none',
        details: activeSelectionId ? [`当前目标资产：${activeSelectionId}`] : undefined,
      },
      input,
    );
  }

  const attachmentCount = positiveCount(input.attachmentCount);
  if (attachmentCount > 0) {
    return withCommonMeta(
      {
        title: `已挂载 ${attachmentCount} 个上下文资产`,
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
        title: '当前对话上下文',
        chips: ['对话'],
        source: 'conversation',
        risk: 'none',
      },
      input,
    );
  }

  return withCommonMeta(
    {
      title: projectName ? `当前项目：${projectName}` : '当前项目',
      chips: [projectName ?? '项目'],
      source: 'project',
      risk: 'none',
    },
    input,
  );
}
