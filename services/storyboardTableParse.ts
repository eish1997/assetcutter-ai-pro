import type {
  CustomAppModule,
  StoryboardParseFieldDef,
  StoryboardTableRow,
} from '../types';
import { ensureShotCharacterFieldOnRow } from './storyboardShotCharacters';
import { resolveTextModelForPreset, type CapabilityExecuteContext } from './capabilityExecutor';
import { workflowChat } from './unifiedAiGateway';

export const STORYBOARD_PARSE_PRESET_KEY = 'ac_storyboard_parse_preset_v1';
export const STORYBOARD_PARSE_DEFAULT_PRESET_ID = 'storyboard_parse_structured_v1';
export const STORYBOARD_OPTIMIZE_PRESET_KEY = 'ac_storyboard_optimize_preset_v1';
export const STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID = 'storyboard_optimize_structured_v1';
export const STORYBOARD_OPTIMIZE_ALLOW_DIALOGUE_KEY = 'ac_storyboard_optimize_allow_dialogue_v1';

export const STORYBOARD_PARSE_BATCH_CONCURRENCY = 2;
export const STORYBOARD_PARSE_MAX_FIELDS = 16;
export const STORYBOARD_CATALOG_SOFT_WARN = 12;

const STORYBOARD_LLM_JSON_OPTIONS = { responseMimeType: 'application/json' as const };

const EXCLUDE_REDRAW_LABEL = /对白|台词|音效|备注|音乐|旁白/;

const SHOT_NO_LABEL_RE = /^(镜头号|镜号|镜次|分镜号?|序号|编号|scene|seq(?:uence)?|shot\s*(?:no|number|id)?\.?)$/i;
const DURATION_LABEL_RE = /^(时长|持续时间|时间|长度|帧数?|frames?|duration|dur\.?)$/i;

export function isSystemShotNoLabel(label: string): boolean {
  return SHOT_NO_LABEL_RE.test(label.trim());
}

export function isSystemDurationLabel(label: string): boolean {
  return DURATION_LABEL_RE.test(label.trim());
}

export function isSystemParseFieldLabel(label: string): boolean {
  return isSystemShotNoLabel(label) || isSystemDurationLabel(label);
}

export function parseShotNoFromParsedValue(raw: string): string {
  const t = raw
    .trim()
    .replace(/^(镜头号|镜号)\s*[：:]\s*/i, '')
    .trim();
  return t.slice(0, 32);
}

export function parseDurationSecFromParsedValue(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const frameMatch = t.match(/^(\d+(?:\.\d+)?)\s*帧$/);
  if (frameMatch) {
    const frames = Number(frameMatch[1]);
    return Number.isFinite(frames) && frames >= 0 ? frames / 24 : null;
  }
  const withoutUnit = t.replace(/[秒sS]+$/, '').trim();
  const n = Number(withoutUnit);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function partitionParsedFields(fields: StoryboardParseFieldItem[]): {
  shotNo?: string;
  durationSec?: number;
  dynamic: StoryboardParseFieldItem[];
} {
  let shotNo: string | undefined;
  let durationSec: number | undefined;
  const dynamic: StoryboardParseFieldItem[] = [];
  for (const item of fields) {
    const label = item.label.trim();
    const value = item.value.trim();
    if (!label || !value) continue;
    if (isSystemShotNoLabel(label)) {
      const parsed = parseShotNoFromParsedValue(value);
      if (parsed) shotNo = parsed;
      continue;
    }
    if (isSystemDurationLabel(label)) {
      const parsed = parseDurationSecFromParsedValue(value);
      if (parsed != null) durationSec = parsed;
      continue;
    }
    dynamic.push(item);
  }
  return { shotNo, durationSec, dynamic };
}

export function purgeSystemFieldValuesFromShotFields(
  catalog: StoryboardParseFieldDef[],
  shotFields: Record<string, string>
): Record<string, string> {
  const next = { ...shotFields };
  for (const def of catalog) {
    if (isSystemParseFieldLabel(def.label)) {
      delete next[def.id];
    }
  }
  return next;
}

export type StoryboardParseFieldItem = {
  label: string;
  value: string;
  kind?: 'text' | 'multiline';
  redrawInclude?: boolean;
};

export type StoryboardParseModelOutput = {
  fields: StoryboardParseFieldItem[];
};

export const DEFAULT_STORYBOARD_PARSE_INSTRUCTION = `你是分镜脚本结构化助手。根据用户输入的分镜文本，拆成若干语义字段。

要求：
1. 字段名（label）由你根据内容自行决定，例如：画面、对白、景别、机位、动作、音效、备注等。
2. 没有信息的维度不要编造，不要输出空字段。
3. 同一语义全程使用相同 label（例如始终用「对白」，不要有时写「台词」）。
4. 保留原文措辞，不要擅自翻译或合并不同维度。
5. 镜头号、时长若出现在原文中：label 必须用「镜头号」「时长」，value 为原文中的值；系统将填入固定列（不进入动态字段）。不要编造。
6. 对「画面」「动作」「景别」「机位」类字段设 redrawInclude: true；对「对白」「音效」「备注」类设 false。
7. 若本镜出现具名角色（人物姓名，非道具/场景/光影/服化描述）：额外输出 label「镜头内角色」，value 为角色名，多个用顿号「、」分隔；无具名角色则不输出该字段。
8. 「镜头内角色」必须设 redrawInclude: false。

只输出 JSON，不要 markdown 代码块：
{
  "fields": [
    { "label": "镜头号", "value": "03" },
    { "label": "时长", "value": "2.5" },
    { "label": "景别", "value": "中景", "redrawInclude": true },
    { "label": "画面", "value": "…", "redrawInclude": true, "kind": "multiline" },
    { "label": "对白", "value": "…", "redrawInclude": false }
  ]
}`;

export function getBuiltinStoryboardParsePreset(): CustomAppModule {
  return {
    id: STORYBOARD_PARSE_DEFAULT_PRESET_ID,
    label: '分镜结构化解析',
    category: 'text_to_text',
    engine: 'gen_text',
    enabled: true,
    order: 0,
    instruction: DEFAULT_STORYBOARD_PARSE_INSTRUCTION,
  };
}

/** 表头可选解析预设：优先 storyboard_parse_*；否则回退内置虚拟预设（无需能力商店同步） */
export function listStoryboardParsePresets(presets: CustomAppModule[]): CustomAppModule[] {
  const builtin = getBuiltinStoryboardParsePreset();
  const tagged = presets.filter((p) => {
    if (p.enabled === false) return false;
    if (p.category !== 'text_to_text') return false;
    return p.id.startsWith('storyboard_parse_') || p.id === builtin.id;
  });
  const byId = new Map<string, CustomAppModule>();
  for (const p of tagged) byId.set(p.id, p);
  if (!byId.has(builtin.id)) {
    byId.set(builtin.id, builtin);
  }
  const list = [...byId.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (list.length > 0) return list;
  return presets.filter((p) => p.enabled !== false && p.category === 'text_to_text');
}

export function pickDefaultStoryboardParsePresetId(presets: CustomAppModule[]): string {
  const list = listStoryboardParsePresets(presets);
  const seeded = list.find((p) => p.id === STORYBOARD_PARSE_DEFAULT_PRESET_ID);
  if (seeded) return seeded.id;
  return list[0]?.id ?? '';
}

export const DEFAULT_STORYBOARD_OPTIMIZE_INSTRUCTION = `你是分镜脚本结构化优化助手。输入为已有结构化字段（JSON），请润色画面类描述，使其更适合分镜绘制与 AI 生图。

约束：
1. 只输出 JSON，不要 markdown 代码块。
2. 输出 fields 数组，每项仅含 id 与 value；id 必须与输入完全一致。
3. 禁止新增、删除或合并字段 id。
4. redrawInclude 为 false 的字段（对白、音效、备注等）：必须逐字保留 value，不要改写。
5. 仅当用户消息标明「允许润色对白」时，方可改写对白类字段。

输入格式：
{
  "catalog": [{ "id": "...", "label": "...", "redrawInclude": true }],
  "fields": [{ "id": "...", "value": "..." }]
}

输出格式：
{
  "fields": [{ "id": "...", "value": "润色后…" }]
}`;

export type StoryboardOptimizeFieldItem = {
  id: string;
  value: string;
};

export type StoryboardOptimizeModelOutput = {
  fields: StoryboardOptimizeFieldItem[];
};

export function getBuiltinStoryboardOptimizePreset(): CustomAppModule {
  return {
    id: STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
    label: '分镜结构化优化',
    category: 'text_to_text',
    engine: 'gen_text',
    enabled: true,
    order: 1,
    instruction: DEFAULT_STORYBOARD_OPTIMIZE_INSTRUCTION,
  };
}

export function listStoryboardOptimizePresets(presets: CustomAppModule[]): CustomAppModule[] {
  const builtin = getBuiltinStoryboardOptimizePreset();
  const tagged = presets.filter((p) => {
    if (p.enabled === false) return false;
    if (p.category !== 'text_to_text') return false;
    return p.id.startsWith('storyboard_optimize_') || p.id === builtin.id;
  });
  const byId = new Map<string, CustomAppModule>();
  for (const p of tagged) byId.set(p.id, p);
  if (!byId.has(builtin.id)) {
    byId.set(builtin.id, builtin);
  }
  return [...byId.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function pickDefaultStoryboardOptimizePresetId(presets: CustomAppModule[]): string {
  const list = listStoryboardOptimizePresets(presets);
  const seeded = list.find((p) => p.id === STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID);
  if (seeded) return seeded.id;
  return list[0]?.id ?? '';
}

export function maybeWarnLargeFieldCatalog(
  catalog: StoryboardParseFieldDef[],
  onWarn?: (message: string) => void
): void {
  if (catalog.length > STORYBOARD_CATALOG_SOFT_WARN) {
    onWarn?.(`字段列较多（${catalog.length} 列），建议合并相似维度`);
  }
}

export function inferRedrawInclude(label: string, explicit?: boolean): boolean {
  if (/^(镜头内角色|出镜角色|镜头角色|本镜角色)$/.test(label.trim())) return false;
  if (typeof explicit === 'boolean') return explicit;
  return !EXCLUDE_REDRAW_LABEL.test(label.trim());
}

export function slugifyFieldLabel(label: string): string {
  const trimmed = label.trim().toLowerCase();
  const slug = trimmed
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug ? `f_${slug}` : 'f_field';
}

export function resolveFieldId(catalog: StoryboardParseFieldDef[], label: string): string {
  const normalized = label.trim();
  const existing = catalog.find((f) => f.label.trim() === normalized);
  if (existing) return existing.id;
  const base = slugifyFieldLabel(normalized);
  if (!catalog.some((f) => f.id === base)) return base;
  let i = 2;
  while (catalog.some((f) => f.id === `${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

export function normalizeFieldCatalog(raw: unknown): StoryboardParseFieldDef[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryboardParseFieldDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as StoryboardParseFieldDef;
    const label = String(row.label || '').trim();
    if (!label) continue;
    const id = String(row.id || '').trim() || resolveFieldId(out, label);
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = row.kind === 'multiline' ? 'multiline' : 'text';
    out.push({
      id,
      label,
      order: Number.isFinite(row.order) ? Number(row.order) : out.length,
      redrawInclude: typeof row.redrawInclude === 'boolean' ? row.redrawInclude : inferRedrawInclude(label),
      kind,
    });
  }
  return out.sort((a, b) => a.order - b.order).map((f, i) => ({ ...f, order: i }));
}

export function normalizeShotFieldsRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key || '').trim();
    if (!id) continue;
    out[id] = String(value ?? '');
  }
  return out;
}

function clampFieldValue(value: string, kind: 'text' | 'multiline'): string {
  const max = kind === 'multiline' ? 4000 : 500;
  return value.length > max ? value.slice(0, max) : value;
}

export function normalizeParseModelOutput(raw: string): StoryboardParseModelOutput {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('结构化解析返回非 JSON：' + String(e));
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray((obj as StoryboardParseModelOutput).fields)) {
    throw new Error('结构化解析 JSON 缺少 fields 数组');
  }
  const fields: StoryboardParseFieldItem[] = [];
  for (const item of (obj as StoryboardParseModelOutput).fields) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim();
    const value = String(item.value || '').trim();
    if (!label || !value) continue;
    const kind = item.kind === 'multiline' ? 'multiline' : 'text';
    fields.push({
      label,
      value: clampFieldValue(value, kind),
      kind,
      redrawInclude: typeof item.redrawInclude === 'boolean' ? item.redrawInclude : undefined,
    });
    if (fields.length >= STORYBOARD_PARSE_MAX_FIELDS) break;
  }
  if (!fields.length) throw new Error('结构化解析未返回有效字段');
  return { fields };
}

export function resolveStoryboardParseInput(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): string {
  const raw = (row.shotRaw || '').trim();
  if (raw) return raw;
  return compileShotText(catalog, row.shotFields).trim();
}

export function buildCatalogParseHint(catalog: StoryboardParseFieldDef[]): string {
  const labels = catalog
    .filter((f) => !isSystemParseFieldLabel(f.label))
    .map((f) => f.label.trim())
    .filter(Boolean);
  if (!labels.length) return '';
  return `\n\n【本表已有字段】输出时必须优先使用下列 label（字面一致）：${labels.join('、')}。可补充新维度，但不要改已有字段名。`;
}

export function compileShotText(
  catalog: StoryboardParseFieldDef[],
  fields: Record<string, string>
): string {
  const lines: string[] = [];
  for (const def of catalog) {
    const value = String(fields[def.id] || '').trim();
    if (!value) continue;
    lines.push(`【${def.label}】${value}`);
  }
  return lines.join('\n');
}

export function pickPrimaryVisualField(
  catalog: StoryboardParseFieldDef[],
  fields: Record<string, string>
): { id: string; label: string; value: string } | null {
  const visualLabel = /画面|镜头(?!号)|视觉|prompt/i;
  for (const def of catalog) {
    if (!visualLabel.test(def.label)) continue;
    const value = String(fields[def.id] || '').trim();
    if (value) return { id: def.id, label: def.label, value };
  }
  for (const def of catalog) {
    if (!def.redrawInclude) continue;
    const value = String(fields[def.id] || '').trim();
    if (value) return { id: def.id, label: def.label, value };
  }
  return null;
}

export function compileRedrawPrompt(
  row: Pick<StoryboardTableRow, 'shotNo' | 'shotFields'>,
  catalog: StoryboardParseFieldDef[],
  promptExtra?: string
): string {
  const parts: string[] = [];
  const shotNo = (row.shotNo || '').trim();
  if (shotNo) parts.push(`【镜头号 ${shotNo}】`);
  for (const def of catalog) {
    if (!def.redrawInclude) continue;
    const value = String(row.shotFields[def.id] || '').trim();
    if (!value) continue;
    parts.push(`【${def.label}】${value}`);
  }
  const extra = (promptExtra || '').trim();
  if (extra) parts.push(extra);
  return parts.join('\n').trim();
}

export function applyShotFieldsPatch(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[],
  nextFields: Record<string, string>
): StoryboardTableRow {
  const shotFields = { ...nextFields };
  return {
    ...row,
    shotFields,
    shotText: compileShotText(catalog, shotFields),
  };
}

export function mergeParseFieldsIntoCatalog(
  catalog: StoryboardParseFieldDef[],
  parsed: StoryboardParseFieldItem[]
): StoryboardParseFieldDef[] {
  const next = [...catalog];
  let maxOrder = next.reduce((m, f) => Math.max(m, f.order), -1);
  for (const item of parsed) {
    const label = item.label.trim();
    if (!label) continue;
    if (isSystemParseFieldLabel(label)) continue;
    const id = resolveFieldId(next, label);
    const existing = next.find((f) => f.id === id);
    const kind = item.kind === 'multiline' ? 'multiline' : 'text';
    const redrawInclude = inferRedrawInclude(label, item.redrawInclude);
    if (existing) {
      existing.label = label;
      if (item.kind) existing.kind = kind;
    } else {
      maxOrder += 1;
      next.push({ id, label, order: maxOrder, kind, redrawInclude });
    }
  }
  return next.sort((a, b) => a.order - b.order);
}

export function mergeParseResultIntoRow(
  catalog: StoryboardParseFieldDef[],
  row: StoryboardTableRow,
  parsed: StoryboardParseModelOutput,
  rawInput: string
): { catalog: StoryboardParseFieldDef[]; row: StoryboardTableRow } {
  const { shotNo, durationSec, dynamic } = partitionParsedFields(parsed.fields);
  const nextCatalog = mergeParseFieldsIntoCatalog(catalog, dynamic);
  let nextFields = purgeSystemFieldValuesFromShotFields(nextCatalog, {
    ...row.shotFields,
  });
  for (const item of dynamic) {
    const id = resolveFieldId(nextCatalog, item.label.trim());
    const def = nextCatalog.find((f) => f.id === id);
    const kind = def?.kind === 'multiline' ? 'multiline' : 'text';
    nextFields[id] = clampFieldValue(item.value.trim(), kind);
  }
  nextFields = purgeSystemFieldValuesFromShotFields(nextCatalog, nextFields);
  let patched = applyShotFieldsPatch(row, nextCatalog, nextFields);
  const ensured = ensureShotCharacterFieldOnRow(nextCatalog, patched, dynamic);
  return {
    catalog: ensured.catalog,
    row: {
      ...ensured.row,
      shotRaw: rawInput.trim(),
      ...(shotNo !== undefined ? { shotNo } : {}),
      ...(durationSec !== undefined ? { durationSec } : {}),
    },
  };
}

export async function parseStoryboardTextWithPreset(
  input: string,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  options?: { fieldCatalog?: StoryboardParseFieldDef[] }
): Promise<StoryboardParseModelOutput> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('请先填写原文或结构化内容');
  const sys = (preset.instruction || '').trim() || DEFAULT_STORYBOARD_PARSE_INSTRUCTION;
  const catalogHint = options?.fieldCatalog?.length
    ? buildCatalogParseHint(options.fieldCatalog)
    : '';
  const body = `${sys}${catalogHint}\n\n---\n\n${trimmed.slice(0, 8000)}`;
  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · 结构化解析中…`);
  const raw = await workflowChat(
    [{ role: 'user', parts: [{ text: body }] }],
    resolveTextModelForPreset(preset, ctx),
    STORYBOARD_LLM_JSON_OPTIONS
  );
  const out = normalizeParseModelOutput(raw);
  ctx.onLog?.('info', `分镜表 · 结构化解析完成（${out.fields.length} 个字段）`);
  return out;
}

export async function parseStoryboardRowWithPreset(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[],
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext
): Promise<{ catalog: StoryboardParseFieldDef[]; row: StoryboardTableRow }> {
  const input = resolveStoryboardParseInput(row, catalog);
  if (!input) throw new Error('请先填写原文或结构化内容');
  const parsed = await parseStoryboardTextWithPreset(input, preset, ctx, { fieldCatalog: catalog });
  return mergeParseResultIntoRow(catalog, row, parsed, input);
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await mapper(items[i]!, i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type StoryboardBatchParseRowResult =
  | { rowId: string; ok: true }
  | { rowId: string; ok: false; error: string };

export async function parseStoryboardRowsBatch(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[],
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  options?: { concurrency?: number; shouldSkip?: (row: StoryboardTableRow) => boolean }
): Promise<{
  catalog: StoryboardParseFieldDef[];
  rows: StoryboardTableRow[];
  results: StoryboardBatchParseRowResult[];
}> {
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const targets = rows.filter((r) => !(options?.shouldSkip?.(r) ?? false));
  const concurrency = options?.concurrency ?? STORYBOARD_PARSE_BATCH_CONCURRENCY;

  type ParseOutcome =
    | { rowId: string; ok: true; parsed: StoryboardParseModelOutput; input: string }
    | { rowId: string; ok: false; error: string };

  const outcomes = await mapLimit(targets, concurrency, async (row): Promise<ParseOutcome> => {
    try {
      const input = resolveStoryboardParseInput(row, catalog);
      if (!input) throw new Error('请先填写原文或结构化内容');
      const parsed = await parseStoryboardTextWithPreset(input, preset, ctx, { fieldCatalog: catalog });
      return { rowId: row.id, ok: true, parsed, input };
    } catch (e) {
      return {
        rowId: row.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  const outcomeById = new Map(outcomes.map((o) => [o.rowId, o]));
  let nextCatalog = catalog;
  const results: StoryboardBatchParseRowResult[] = [];

  for (const row of targets) {
    const outcome = outcomeById.get(row.id);
    if (!outcome) continue;
    if (!outcome.ok) {
      results.push({ rowId: row.id, ok: false, error: outcome.error });
      continue;
    }
    try {
      const merged = mergeParseResultIntoRow(nextCatalog, row, outcome.parsed, outcome.input);
      nextCatalog = merged.catalog;
      rowMap.set(merged.row.id, merged.row);
      results.push({ rowId: row.id, ok: true });
    } catch (e) {
      results.push({
        rowId: row.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    catalog: nextCatalog,
    rows: rows.map((r) => rowMap.get(r.id) ?? r),
    results,
  };
}

export function normalizeOptimizeModelOutput(
  raw: string,
  catalog: StoryboardParseFieldDef[]
): StoryboardOptimizeModelOutput {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('结构化优化返回非 JSON：' + String(e));
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray((obj as StoryboardOptimizeModelOutput).fields)) {
    throw new Error('结构化优化 JSON 缺少 fields 数组');
  }
  const allowed = new Set(catalog.map((f) => f.id));
  const fields: StoryboardOptimizeFieldItem[] = [];
  for (const item of (obj as StoryboardOptimizeModelOutput).fields) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const value = String(item.value ?? '').trim();
    if (!id || !allowed.has(id) || !value) continue;
    const def = catalog.find((f) => f.id === id);
    const kind = def?.kind === 'multiline' ? 'multiline' : 'text';
    fields.push({ id, value: clampFieldValue(value, kind) });
  }
  if (!fields.length) throw new Error('结构化优化未返回有效字段');
  return { fields };
}

export function buildOptimizeModelPayload(
  catalog: StoryboardParseFieldDef[],
  row: StoryboardTableRow
): { catalog: Array<Pick<StoryboardParseFieldDef, 'id' | 'label' | 'redrawInclude'>>; fields: StoryboardOptimizeFieldItem[] } {
  const fields: StoryboardOptimizeFieldItem[] = [];
  for (const def of catalog) {
    const value = String(row.shotFields[def.id] || '').trim();
    if (!value) continue;
    fields.push({ id: def.id, value });
  }
  return {
    catalog: catalog.map((f) => ({
      id: f.id,
      label: f.label,
      redrawInclude: f.redrawInclude,
    })),
    fields,
  };
}

export function rowHasStructuredFieldValues(
  catalog: StoryboardParseFieldDef[],
  row: Pick<StoryboardTableRow, 'shotFields'>
): boolean {
  return catalog.some((f) => String(row.shotFields[f.id] || '').trim().length > 0);
}

export function mergeOptimizeResultIntoRow(
  catalog: StoryboardParseFieldDef[],
  row: StoryboardTableRow,
  optimized: StoryboardOptimizeModelOutput,
  options?: { allowDialogueEdit?: boolean }
): StoryboardTableRow {
  const nextFields = { ...row.shotFields };
  for (const item of optimized.fields) {
    const def = catalog.find((f) => f.id === item.id);
    if (!def) continue;
    if (!def.redrawInclude && !options?.allowDialogueEdit) continue;
    const kind = def.kind === 'multiline' ? 'multiline' : 'text';
    nextFields[item.id] = clampFieldValue(item.value.trim(), kind);
  }
  return applyShotFieldsPatch(row, catalog, nextFields);
}

export async function optimizeStoryboardTextWithPreset(
  catalog: StoryboardParseFieldDef[],
  row: StoryboardTableRow,
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  options?: { allowDialogueEdit?: boolean }
): Promise<StoryboardOptimizeModelOutput> {
  const payload = buildOptimizeModelPayload(catalog, row);
  if (!payload.fields.length) throw new Error('请先解析或填写结构化字段');
  const sys = (preset.instruction || '').trim() || DEFAULT_STORYBOARD_OPTIMIZE_INSTRUCTION;
  const allowLine = options?.allowDialogueEdit ? '\n\n允许润色对白类字段。' : '';
  const body = `${sys}\n\n---\n\n${JSON.stringify(payload)}${allowLine}`;
  const label = preset.label || preset.id;
  ctx.onLog?.('info', `分镜表 · ${label} · 结构化优化中…`);
  const raw = await workflowChat(
    [{ role: 'user', parts: [{ text: body }] }],
    resolveTextModelForPreset(preset, ctx),
    STORYBOARD_LLM_JSON_OPTIONS
  );
  const out = normalizeOptimizeModelOutput(raw, catalog);
  ctx.onLog?.('info', `分镜表 · 结构化优化完成（${out.fields.length} 个字段）`);
  return out;
}

export async function optimizeStoryboardRowWithPreset(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[],
  preset: CustomAppModule,
  ctx: CapabilityExecuteContext,
  options?: { allowDialogueEdit?: boolean }
): Promise<StoryboardTableRow> {
  if (!catalog.length) throw new Error('请先解析出结构化字段');
  const optimized = await optimizeStoryboardTextWithPreset(catalog, row, preset, ctx, options);
  return mergeOptimizeResultIntoRow(catalog, row, optimized, options);
}

export function shotFieldsShallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
