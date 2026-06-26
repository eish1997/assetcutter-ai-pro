import type { StoryboardParseFieldDef, StoryboardTableDoc, StoryboardTableRow, WorkflowAsset } from '../types';
import { storyboardRowHasFrameRef, resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';
import {
  applyShotFieldsPatch,
  compileShotText,
  compareStoryboardShotNos,
  normalizeFieldCatalog,
  normalizeShotFieldsRecord,
  formatStoryboardNumericShotNo,
  normalizeStoryboardShotNoInput,
  STORYBOARD_PARSE_DEFAULT_PRESET_ID,
  STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
} from './storyboardTableParse';
import { normalizeStoryboardFrameHistory } from './storyboardFrameHistory';
import {
  clampStoryboardRowTimelineLayer,
  resolveStoryboardTimelineLayerCount,
} from './storyboardVideoTimeline';
import {
  duplicateStoryboardFrameRoleMarks,
  normalizeStoryboardFrameRoleMarks,
} from './storyboardFrameRoleMarks';
import {
  duplicateStoryboardRoleAssets,
  normalizeStoryboardRoleAssets,
} from './storyboardRoleAssets';
import {
  duplicateStoryboardSceneAssets,
  normalizeStoryboardSceneAssets,
} from './storyboardSceneAssets';
import { mergeStoryboardNamedAssets } from './storyboardNamedAssetImage';
import { storyboardShotNosMatch } from './storyboardSheetVisionSplit';

const rowId = () => Math.random().toString(36).slice(2, 11);

function normalizeTimelineLayer(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function hasWorkflowStoryboardTablePayload(a: WorkflowAsset): boolean {
  const table = a.storyboardTable;
  return Boolean(table && typeof table === 'object' && Array.isArray(table.rows));
}

/** 显式 kind 或旧数据内嵌 storyboardTable 均视为分镜表资产 */
export function isWorkflowStoryboardTableAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'storyboard_table' || hasWorkflowStoryboardTablePayload(a);
}

/** 加载/自愈：补齐旧数据缺失的 assetKind，并规范化分镜表结构 */
export function upgradeLegacyWorkflowStoryboardTableAsset(asset: WorkflowAsset): WorkflowAsset {
  if (!hasWorkflowStoryboardTablePayload(asset)) return asset;
  if (asset.assetKind === 'storyboard_table') return normalizeStoryboardTableOnAsset(asset);
  return normalizeStoryboardTableOnAsset({ ...asset, assetKind: 'storyboard_table' });
}

/** 合并导入/解析时保留已有分镜图与标注 */
export function preserveStoryboardRowFrameFields(
  row: Pick<
    StoryboardTableRow,
    | 'frameImage'
    | 'frameImageObjectKey'
    | 'frameImageCompanionKey'
    | 'frameImageHistory'
    | 'frameRoleMarks'
  >
): Pick<
  StoryboardTableRow,
  | 'frameImage'
  | 'frameImageObjectKey'
  | 'frameImageCompanionKey'
  | 'frameImageHistory'
  | 'frameRoleMarks'
> {
  return {
    frameImage: row.frameImage,
    frameImageObjectKey: row.frameImageObjectKey,
    frameImageCompanionKey: row.frameImageCompanionKey,
    frameImageHistory: row.frameImageHistory,
    frameRoleMarks: row.frameRoleMarks,
  };
}

export function createStoryboardTableRow(partial?: Partial<StoryboardTableRow>, index = 0): StoryboardTableRow {
  const shotFields = normalizeShotFieldsRecord(partial?.shotFields);
  const shotNoExplicit = partial != null && Object.prototype.hasOwnProperty.call(partial, 'shotNo');
  const rawShotNo = String(partial?.shotNo ?? '').trim();
  let shotNo: string | undefined;
  if (rawShotNo) {
    shotNo = rawShotNo.slice(0, 32);
  } else if (shotNoExplicit) {
    shotNo = undefined;
  } else {
    shotNo = formatStoryboardShotNo(index);
  }
  return {
    id: partial?.id || rowId(),
    index,
    shotNo,
    durationSec: partial?.durationSec ?? null,
    shotRaw: partial?.shotRaw,
    shotFields,
    shotText: partial?.shotText ?? '',
    frameImage: partial?.frameImage,
    frameImageObjectKey: partial?.frameImageObjectKey,
    frameImageCompanionKey: partial?.frameImageCompanionKey,
    frameImageHistory: partial?.frameImageHistory,
    locked: Boolean(partial?.locked),
    timelineLayer: normalizeTimelineLayer(partial?.timelineLayer ?? 0),
    editFeedback:
      typeof partial?.editFeedback === 'string' ? partial.editFeedback : undefined,
    frameRoleMarks: partial?.frameRoleMarks
      ? normalizeStoryboardFrameRoleMarks(partial.frameRoleMarks)
      : undefined,
  };
}

export function reindexStoryboardRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((r, i) => ({ ...r, index: i }));
}

export function storyboardRowHasAssignedShotNo(row: Pick<StoryboardTableRow, 'shotNo'>): boolean {
  return Boolean(String(row.shotNo ?? '').trim());
}

/** 编辑页：无镜号镜头保持在前，有镜号按镜号升序 */
export function sortStoryboardRowsByShotNo(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  const unnumbered: StoryboardTableRow[] = [];
  const numbered: StoryboardTableRow[] = [];
  for (const row of rows) {
    if (storyboardRowHasAssignedShotNo(row)) numbered.push(row);
    else unnumbered.push(row);
  }
  numbered.sort((a, b) =>
    compareStoryboardShotNos(String(a.shotNo ?? ''), String(b.shotNo ?? ''))
  );
  return reindexStoryboardRows([...unnumbered, ...numbered]);
}

function finalizeStoryboardRows(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[]
): StoryboardTableRow[] {
  return rows.map((row) => applyShotFieldsPatch(row, catalog, row.shotFields));
}

/** 编辑态标题：保留用户输入的空字符串，不回落默认名 */
export function readStoryboardTableTitleRaw(
  asset: Pick<WorkflowAsset, 'textTitle' | 'storyboardTable'>
): string {
  if (typeof asset.textTitle === 'string') return asset.textTitle;
  if (typeof asset.storyboardTable?.title === 'string') return asset.storyboardTable.title;
  return '';
}

/** 展示/导出用标题：空白时回退「分镜表」 */
export function resolveStoryboardTableTitle(
  asset: Pick<WorkflowAsset, 'textTitle' | 'storyboardTable'>
): string {
  const raw = readStoryboardTableTitleRaw(asset).trim();
  return raw || '分镜表';
}

export function normalizeStoryboardTableDoc(raw: unknown): StoryboardTableDoc {
  if (!raw || typeof raw !== 'object') {
    const catalog: StoryboardParseFieldDef[] = [];
    return {
      fieldCatalog: catalog,
      rows: finalizeStoryboardRows([createStoryboardTableRow({}, 0)], catalog),
    };
  }
  const doc = raw as StoryboardTableDoc;
  const fieldCatalog = normalizeFieldCatalog(doc.fieldCatalog);
  const parsePresetId =
    typeof doc.parsePresetId === 'string' && doc.parsePresetId.trim()
      ? doc.parsePresetId.trim()
      : undefined;
  const optimizePresetId =
    typeof doc.optimizePresetId === 'string' && doc.optimizePresetId.trim()
      ? doc.optimizePresetId.trim()
      : undefined;
  const rowsIn = Array.isArray(doc.rows) ? doc.rows : [];
  const parsed =
    rowsIn.length > 0
      ? rowsIn.map((r, i) => {
          const row = r && typeof r === 'object' ? (r as StoryboardTableRow) : ({} as StoryboardTableRow);
          const durationRaw = row.durationSec;
          let durationSec: number | null = null;
          if (durationRaw != null && String(durationRaw).trim() !== '') {
            const n = Number(durationRaw);
            durationSec = Number.isFinite(n) && n >= 0 ? n : null;
          }
          let shotFields = normalizeShotFieldsRecord(row.shotFields);
          let shotRaw = typeof row.shotRaw === 'string' ? row.shotRaw : undefined;
          const legacyShotText = String(row.shotText ?? '').trim();
          if (!shotRaw && legacyShotText && Object.keys(shotFields).length === 0) {
            shotRaw = legacyShotText;
          }
          return createStoryboardTableRow(
            {
              id: String(row.id || '').trim() || rowId(),
              index: i,
              shotNo: String(row.shotNo ?? '').trim(),
              durationSec,
              shotRaw,
              shotFields,
              shotText: legacyShotText,
              frameImage: String(row.frameImage || '').trim() || undefined,
              frameImageObjectKey: String(row.frameImageObjectKey || '').trim() || undefined,
              frameImageCompanionKey: String(row.frameImageCompanionKey || '').trim() || undefined,
              frameImageHistory: normalizeStoryboardFrameHistory(row.frameImageHistory),
              locked: Boolean(row.locked),
              timelineLayer: normalizeTimelineLayer(row.timelineLayer ?? 0),
              editFeedback: typeof row.editFeedback === 'string' ? row.editFeedback : undefined,
              frameRoleMarks: normalizeStoryboardFrameRoleMarks(row.frameRoleMarks),
            },
            i
          );
        })
      : [createStoryboardTableRow({}, 0)];
  const layerCount = resolveStoryboardTimelineLayerCount(parsed, doc.timelineLayerCount ?? 1);
  const rows = finalizeStoryboardRows(
    reindexStoryboardRows(
      parsed.map((r) => ({
        ...r,
        timelineLayer: clampStoryboardRowTimelineLayer(r.timelineLayer ?? 0, layerCount),
      }))
    ),
    fieldCatalog
  );
  const title =
    doc.title !== undefined && doc.title !== null ? String(doc.title) : undefined;
  const roleAssets = normalizeStoryboardRoleAssets(doc.roleAssets);
  const sceneAssets = normalizeStoryboardSceneAssets(doc.sceneAssets);
  return {
    ...(title !== undefined ? { title } : {}),
    timelineLayerCount: layerCount,
    fieldCatalog,
    ...(parsePresetId ? { parsePresetId } : {}),
    ...(optimizePresetId ? { optimizePresetId } : {}),
    ...(roleAssets.length ? { roleAssets } : {}),
    ...(sceneAssets.length ? { sceneAssets } : {}),
    rows,
  };
}

function storyboardRowHasImportText(row: StoryboardTableRow): boolean {
  if ((row.shotRaw || '').trim()) return true;
  return Object.values(row.shotFields || {}).some((value) => String(value || '').trim());
}

function mergeStoryboardImportShotFields(
  base: Record<string, string> | undefined,
  other: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = { ...(base || {}) };
  for (const [key, value] of Object.entries(other || {})) {
    const next = String(value || '').trim();
    if (!next) continue;
    const cur = String(out[key] || '').trim();
    if (!cur) out[key] = next;
  }
  return out;
}

function mergeStoryboardTableRowPair(
  base: StoryboardTableRow,
  other: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[]
): StoryboardTableRow {
  const frameSource = storyboardRowHasFrameRef(base)
    ? base
    : storyboardRowHasFrameRef(other)
      ? other
      : base;
  const textSource = storyboardRowHasImportText(base)
    ? base
    : storyboardRowHasImportText(other)
      ? other
      : base;
  const shotFields = mergeStoryboardImportShotFields(base.shotFields, other.shotFields);
  const merged = {
    ...base,
    ...other,
    id: base.id,
    shotNo: base.shotNo?.trim() ? base.shotNo : other.shotNo,
    durationSec: base.durationSec ?? other.durationSec,
    shotRaw: textSource.shotRaw ?? base.shotRaw ?? other.shotRaw,
    shotFields,
    locked: Boolean(base.locked || other.locked),
    timelineLayer: base.timelineLayer ?? other.timelineLayer,
    editFeedback: base.editFeedback ?? other.editFeedback,
    frameRoleMarks: base.frameRoleMarks?.length ? base.frameRoleMarks : other.frameRoleMarks,
    ...preserveStoryboardRowFrameFields(frameSource),
    frameImageHistory:
      (base.frameImageHistory?.length ? base.frameImageHistory : undefined) ??
      other.frameImageHistory,
  };
  return applyShotFieldsPatch(merged, fieldCatalog, merged.shotFields);
}

/** 云同步 / bundle 合并：按 row.id、镜号对齐，分镜图与文本取「有内容的一侧」 */
export function mergeStoryboardTableDocs(
  baseRaw: unknown,
  otherRaw: unknown
): StoryboardTableDoc {
  const base = normalizeStoryboardTableDoc(baseRaw);
  const other = normalizeStoryboardTableDoc(otherRaw);
  const fieldCatalog = base.fieldCatalog.length ? base.fieldCatalog : other.fieldCatalog;
  const mergedById = new Map<string, StoryboardTableRow>();
  const order: string[] = [];

  const remember = (row: StoryboardTableRow) => {
    if (!row.id || mergedById.has(row.id)) return;
    mergedById.set(row.id, row);
    order.push(row.id);
  };

  for (const row of base.rows) {
    remember(row);
  }

  for (const otherRow of other.rows) {
    const existingById = mergedById.get(otherRow.id);
    if (existingById) {
      mergedById.set(otherRow.id, mergeStoryboardTableRowPair(existingById, otherRow, fieldCatalog));
      continue;
    }
    const existingByShot = [...mergedById.values()].find(
      (row) =>
        row.shotNo?.trim() &&
        otherRow.shotNo?.trim() &&
        storyboardShotNosMatch(row.shotNo, otherRow.shotNo)
    );
    if (existingByShot) {
      mergedById.set(
        existingByShot.id,
        mergeStoryboardTableRowPair(existingByShot, otherRow, fieldCatalog)
      );
      continue;
    }
    remember(otherRow);
  }

  const rows = reindexStoryboardRows(order.map((id) => mergedById.get(id)!));
  return {
    ...base,
    ...other,
    title: base.title?.trim() ? base.title : other.title,
    fieldCatalog,
    timelineLayerCount: Math.max(base.timelineLayerCount ?? 1, other.timelineLayerCount ?? 1),
    parsePresetId: base.parsePresetId || other.parsePresetId,
    optimizePresetId: base.optimizePresetId || other.optimizePresetId,
    roleAssets: mergeStoryboardNamedAssets(base.roleAssets, other.roleAssets, normalizeStoryboardRoleAssets),
    sceneAssets: mergeStoryboardNamedAssets(base.sceneAssets, other.sceneAssets, normalizeStoryboardSceneAssets),
    rows: finalizeStoryboardRows(rows, fieldCatalog),
  };
}

export function normalizeStoryboardTableOnAsset(asset: WorkflowAsset): WorkflowAsset {
  if (!isWorkflowStoryboardTableAsset(asset)) return asset;
  const table = normalizeStoryboardTableDoc(asset.storyboardTable);
  const titleRaw = readStoryboardTableTitleRaw(asset);
  const { isGroup: _ig, assetIds: _ai, cutImageGroup: _cig, parentAssetId: _pid, ...rest } = asset;
  return {
    ...rest,
    assetKind: 'storyboard_table',
    textTitle: titleRaw,
    original: '',
    displayKey: 'original',
    results: rest.results ?? {},
    storyboardTable: {
      ...table,
      title: titleRaw,
      parsePresetId: table.parsePresetId || STORYBOARD_PARSE_DEFAULT_PRESET_ID,
      optimizePresetId: table.optimizePresetId || STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
    },
  };
}

export function createEmptyStoryboardTableAsset(
  id: string,
  title?: string,
  parsePresetId: string = STORYBOARD_PARSE_DEFAULT_PRESET_ID
): WorkflowAsset {
  const label = title !== undefined ? title.trim() || '分镜表' : '分镜表';
  return normalizeStoryboardTableOnAsset({
    id,
    assetKind: 'storyboard_table',
    textTitle: label,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: Date.now(),
    storyboardTable: {
      title: label,
      fieldCatalog: [],
      parsePresetId,
      optimizePresetId: STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
      rows: [createStoryboardTableRow({}, 0), createStoryboardTableRow({}, 1), createStoryboardTableRow({}, 2)],
    },
  });
}

export function storyboardTableOutlineLabel(a: WorkflowAsset): string {
  const t = resolveStoryboardTableTitle(a);
  const n = a.storyboardTable?.rows?.length ?? 0;
  return `${t} · ${n} 镜`;
}

export function storyboardTableCoverImage(a: WorkflowAsset): string {
  const rows = a.storyboardTable?.rows ?? [];
  for (const r of rows) {
    const img = resolveStoryboardRowFrameDisplaySrc(r);
    if (img) return img;
  }
  return '';
}

/** 前 n 个有图镜头的缩略图（表卡胶片条） */
export function storyboardTablePreviewImages(a: WorkflowAsset, limit = 4): string[] {
  const rows = a.storyboardTable?.rows ?? [];
  const out: string[] = [];
  for (const r of rows) {
    const img = resolveStoryboardRowFrameDisplaySrc(r);
    if (!img) continue;
    out.push(img);
    if (out.length >= limit) break;
  }
  return out;
}

export type StoryboardTableStats = {
  rowCount: number;
  lockedCount: number;
  withImageCount: number;
  /** 各行秒数之和；存在未填秒数时 `hasGaps` 为 true */
  totalDurationSec: number;
  hasGaps: boolean;
};

export function computeStoryboardTableStats(doc: StoryboardTableDoc): StoryboardTableStats {
  const rows = doc.rows ?? [];
  let totalDurationSec = 0;
  let hasGaps = false;
  let withImageCount = 0;
  let lockedCount = 0;
  for (const r of rows) {
    if (r.locked) lockedCount += 1;
    if (storyboardRowHasFrameRef(r)) withImageCount += 1;
    if (r.durationSec == null || !Number.isFinite(r.durationSec)) {
      hasGaps = true;
    } else {
      totalDurationSec += r.durationSec;
    }
  }
  return {
    rowCount: rows.length,
    lockedCount,
    withImageCount,
    totalDurationSec,
    hasGaps,
  };
}

export function formatStoryboardShotNo(index: number): string {
  return formatStoryboardNumericShotNo(String(Math.max(0, index) + 1));
}

export function duplicateStoryboardRow(source: StoryboardTableRow, index: number): StoryboardTableRow {
  return createStoryboardTableRow(
    {
      shotNo: source.shotNo ? `${source.shotNo}'` : formatStoryboardShotNo(index),
      durationSec: source.durationSec ?? null,
      shotRaw: source.shotRaw,
      shotFields: { ...source.shotFields },
      shotText: source.shotText,
      frameImage: source.frameImage,
      frameImageObjectKey: source.frameImageObjectKey,
      frameImageCompanionKey: source.frameImageCompanionKey,
      locked: false,
      timelineLayer: source.timelineLayer ?? 0,
      frameRoleMarks: duplicateStoryboardFrameRoleMarks(source.frameRoleMarks),
    },
    index
  );
}

/** 复制分镜表资产：新资产 id + 各行新 row id，避免与源表冲突 */
export function duplicateStoryboardTableOnAsset(asset: WorkflowAsset, newAssetId: string): WorkflowAsset {
  if (!isWorkflowStoryboardTableAsset(asset)) return asset;
  const table = asset.storyboardTable;
  const rows = (table?.rows ?? []).map((r, i) => duplicateStoryboardRow(r, i));
  const {
    isGroup: _ig,
    assetIds: _ai,
    cutImageGroup: _cig,
    parentAssetId: _pid,
    modelCompanionKeys: _mck,
    ...rest
  } = asset;
  return normalizeStoryboardTableOnAsset({
    ...rest,
    id: newAssetId,
    modelCompanionKeys: undefined,
    archived: false,
    hiddenInGrid: false,
    createdAt: Date.now(),
    storyboardTable: {
      ...table,
      fieldCatalog: table?.fieldCatalog ? [...table.fieldCatalog] : [],
      roleAssets: duplicateStoryboardRoleAssets(table?.roleAssets ?? []),
      sceneAssets: duplicateStoryboardSceneAssets(table?.sceneAssets ?? []),
      rows,
    },
  });
}

/** 为空镜头号填 001、002…；已有纯数字镜号统一补齐为三位 */
export function applyAutoShotNumbers(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((r, i) => {
    const current = (r.shotNo || '').trim();
    const shotNo = current ? normalizeStoryboardShotNoInput(current) : formatStoryboardShotNo(i);
    return { ...r, shotNo };
  });
}

/** 按数组物理顺序重编 001、002…，消除镜号重复与乱序 */
export function applySequentialShotNumbers(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return reindexStoryboardRows(
    rows.map((r, i) => ({
      ...r,
      shotNo: formatStoryboardShotNo(i),
    }))
  );
}

/** 大纲拖拽松手位置：overIndex 行上/下半区 → 插入索引 */
export function computeStoryboardOutlineDropIndex(
  draggingIndex: number,
  overIndex: number,
  clientY: number,
  overRect: Pick<DOMRect, 'top' | 'height'>,
  rowCount: number
): number {
  if (rowCount <= 1) return 0;
  const after = clientY >= overRect.top + overRect.height / 2;
  let to = after ? overIndex + 1 : overIndex;
  if (draggingIndex < to) to -= 1;
  return Math.max(0, Math.min(rowCount - 1, to));
}
