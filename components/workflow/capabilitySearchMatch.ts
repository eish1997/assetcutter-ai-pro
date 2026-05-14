/**
 * 能力预设检索：从原文提取关键字，按「任一命中」匹配（OR）。
 * 分隔：空白与常见标点；无有效切分时整段小写作为单条关键字。
 *
 * 匹配方向：
 * - 正向：haystack（名称 / id / 分类 / 提示词）包含某一关键字；
 * - 反向：某一关键字包含预设的展示名 / id / 分类，或提示词按标点切出的短句（≥2 字），
 *   用于底部整句口语（如「帮我把图片生成多视角」）仍能命中名称「生成多视角」。
 *
 * 字段规范化：持久化/同步数据异常时 label、instruction 可能非 string，避免 .trim / 拼接抛错。
 */
function safeSearchLower(v: unknown): string {
  try {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim().toLowerCase();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v).trim().toLowerCase();
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v).trim().toLowerCase();
  } catch {
    return '';
  }
}

function safeInstructionSearchSlice(v: unknown, max: number): string {
  try {
    if (v == null) return '';
    const base = typeof v === 'string' ? v : String(v);
    return base.slice(0, max).toLowerCase();
  } catch {
    return '';
  }
}

export function extractCapabilitySearchKeywords(raw: unknown): string[] {
  try {
    const t = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    if (!t) return [];
    const lower = t.toLowerCase();
    const spaced = lower
      .replace(/[\s,，、;；|\\/_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!spaced) return [];
    const parts = spaced.split(' ').filter((p) => p.length > 0);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out.length > 0 ? out : [lower];
  } catch {
    return [];
  }
}

export function haystackMatchesAnyKeyword(haystackLower: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = typeof haystackLower === 'string' ? haystackLower : safeSearchLower(haystackLower);
  return keywords.some((kw) => typeof kw === 'string' && kw.length > 0 && hay.includes(kw));
}

export type CapabilitySearchModuleFields = {
  label: string;
  id: string;
  category: string;
  instruction?: string | null;
};

function instructionSegmentsForSearch(instrLower: string): string[] {
  if (!instrLower) return [];
  const raw = instrLower.split(/[,，。;；！？\n\r]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const t = s.trim();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 展示名较短：对其所有连续子串（长度在此区间内）做「用户句是否包含」判断，无需打全名 */
const LOOSE_LABEL_SUB_MIN = 2;
const LOOSE_LABEL_SUB_MAX = 32;
/** 底部整句口语可能极长；匹配侧只取前段，避免 O(n×字段长) 拖死主线程 */
const LOOSE_MATCH_KW_MAX = 512;

function keywordContainsAnySubstringOfShortField(kw: string, fieldLower: string): boolean {
  if (!kw || fieldLower.length < LOOSE_LABEL_SUB_MIN) return false;
  const kwScan = kw.length > LOOSE_MATCH_KW_MAX ? kw.slice(0, LOOSE_MATCH_KW_MAX) : kw;
  const field = fieldLower.slice(0, LOOSE_LABEL_SUB_MAX);
  const maxLen = Math.min(field.length, LOOSE_LABEL_SUB_MAX);
  for (let len = maxLen; len >= LOOSE_LABEL_SUB_MIN; len--) {
    for (let i = 0; i + len <= field.length; i++) {
      if (kwScan.includes(field.slice(i, i + len))) return true;
    }
  }
  return false;
}

/** id 按分隔符切段，任一段 ≥3 且出现在用户句中则命中（如 multi_view → multi） */
function keywordMatchesIdTokensLoosely(kw: string, idLower: string): boolean {
  if (!kw || !idLower) return false;
  const parts = idLower.split(/[_\-.]+/).filter((p) => p.length >= 3);
  return parts.some((p) => kw.includes(p));
}

/** 预设卡片：名称 / id / 分类 / 提示词，支持口语整句反向包含短字段 */
export function keywordsMatchCapabilityModule(
  keywords: string[],
  mod: CapabilitySearchModuleFields | Record<string, unknown>
): boolean {
  if (keywords.length === 0) return true;
  try {
    const label = safeSearchLower((mod as CapabilitySearchModuleFields).label);
    const id = safeSearchLower((mod as CapabilitySearchModuleFields).id);
    const category = safeSearchLower((mod as CapabilitySearchModuleFields).category);
    const instr = safeInstructionSearchSlice((mod as CapabilitySearchModuleFields).instruction, 240);
    const hay = `${label}\n${id}\n${category}\n${instr}`;
    const instrSegs = instructionSegmentsForSearch(instr);

    return keywords.some((rawKw) => {
      const kw =
        typeof rawKw === 'string'
          ? rawKw.length > LOOSE_MATCH_KW_MAX
            ? rawKw.slice(0, LOOSE_MATCH_KW_MAX)
            : rawKw
          : '';
      if (!kw) return false;
      if (hay.includes(kw)) return true;
      if (label.length >= 2 && kw.includes(label)) return true;
      if (id.length >= 2 && kw.includes(id)) return true;
      if (category.length >= 2 && kw.includes(category)) return true;
      if (instrSegs.some((seg) => kw.includes(seg))) return true;
      if (keywordContainsAnySubstringOfShortField(kw, label)) return true;
      if (keywordMatchesIdTokensLoosely(kw, id)) return true;
      return false;
    });
  } catch {
    return false;
  }
}

/** 复合能力 / 常用项等仅 label + id */
export function keywordsMatchCapabilityLabelId(keywords: string[], label: unknown, id: unknown): boolean {
  if (keywords.length === 0) return true;
  try {
    const l = safeSearchLower(label);
    const i = safeSearchLower(id);
    const hay = `${l}\n${i}`;
    return keywords.some((rawKw) => {
      const kw =
        typeof rawKw === 'string'
          ? rawKw.length > LOOSE_MATCH_KW_MAX
            ? rawKw.slice(0, LOOSE_MATCH_KW_MAX)
            : rawKw
          : '';
      if (!kw) return false;
      if (hay.includes(kw)) return true;
      if (l.length >= 2 && kw.includes(l)) return true;
      if (i.length >= 2 && kw.includes(i)) return true;
      if (keywordContainsAnySubstringOfShortField(kw, l)) return true;
      if (keywordMatchesIdTokensLoosely(kw, i)) return true;
      return false;
    });
  } catch {
    return false;
  }
}
