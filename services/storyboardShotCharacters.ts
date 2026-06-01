import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import type { StoryboardParseFieldItem } from './storyboardTableParse';
import { applyShotFieldsPatch, resolveFieldId } from './storyboardTableParse';

/** 解析/表格中「本镜出场角色名」专用列名 */
export const STORYBOARD_SHOT_CHARACTER_FIELD_LABEL = '镜头内角色';

const DIALOGUE_FIELD_RE = /对白|台词|声音|vo/i;
const SPEAKER_EXCLUDE_RE =
  /^(旁白|画外|画外音|群众|众人|路人|群众甲|群众乙|OS|VO|音效|音乐|环境音|背景音)$/i;

/** 明显非人名的词（道具、场景、光影等） */
const NON_CHARACTER_NAME_RE =
  /手机|电脑|相机|灯光|灯火|城市|夜景|建筑|场景|道路|汽车|天空|背景|色调|氛围|特效|道具|服装|化妆|噪点|画面|镜头|远景|近景|全景|中景|特写|万家|高楼|林立|暖黄|冷色|街道|房间|室内|室外|植物|树木|水面|火焰|风雨|云雾|山河|海湖|江面|桥梁|地铁|公交|火车|飞机|屏幕|窗口|门|桌|椅|床|沙发|树|花|草|石|墙|地板|天花板|光|影|色|调|音|效|声|风|雨|雪|云|雾|霾|星|月|日|夜|晨|昏|午|晚|春|夏|秋|冬/;

export function isShotCharacterFieldLabel(label: string): boolean {
  return /^(镜头内角色|出镜角色|镜头角色|本镜角色)$/.test(label.trim());
}

/** 可填人物名的列（不含服化/光影/道具类） */
export function isExplicitCharacterNameFieldLabel(label: string): boolean {
  const t = label.trim();
  if (isShotCharacterFieldLabel(t)) return true;
  if (/服化|道具|造型|化妆|灯光|光影|氛围|色调|设计|建议|服装|妆造/.test(t)) return false;
  return /^(人物|角色|出镜人物|出场人物|主要人物)$/.test(t);
}

function normalizeToken(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/[（(].*[）)]/g, '').trim();
}

export function looksLikeCharacterName(raw: string): boolean {
  const name = normalizeToken(raw);
  if (!name || name.length > 8) return false;
  if (name.length < 2) return false;
  if (SPEAKER_EXCLUDE_RE.test(name)) return false;
  if (/^[-—–无…\.]+$/.test(name)) return false;
  if (NON_CHARACTER_NAME_RE.test(name)) return false;
  if (/\d/.test(name)) return false;
  if (name.length >= 4 && /的|与|和|在|从|到|了|着|过|里|外|上|下|中|内|旁|边|处|向|被|把|让|给|对|于|而|且|或|及|并|但|却|也|还|就|都|很|更|最|非常|十分|一些|许多|各种|一个|一位|一名|一种|一座|一条|一片|一群|众人/.test(name)) {
    return false;
  }
  return true;
}

/** 从单行文本提取对白说话人（张三：… / 【张三】） */
export function extractSpeakerFromStoryboardLine(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const sepIndex = trimmed.search(/[：:]/);
  if (sepIndex > 0 && sepIndex <= 12) {
    const candidate = trimmed.slice(0, sepIndex);
    return looksLikeCharacterName(candidate) ? normalizeToken(candidate) : null;
  }
  const bracketMatch = trimmed.match(/【([^】]{1,12})】/);
  if (bracketMatch && looksLikeCharacterName(bracketMatch[1]!)) {
    return normalizeToken(bracketMatch[1]!);
  }
  return null;
}

export function parseCharacterNamesFromListText(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of text.split(/[、，,；;|\n/／·]+/)) {
    const token = normalizeToken(part);
    if (!looksLikeCharacterName(token) || seen.has(token)) continue;
    seen.add(token);
    names.push(token);
  }
  return names;
}

function pushUniqueNames(target: string[], seen: Set<string>, names: string[]) {
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    target.push(name);
  }
}

/** 从已结构化字段推断本镜角色名（不含服化/光影/画面描述） */
export function inferCharacterNamesFromFieldItems(items: StoryboardParseFieldItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const item of items) {
    const label = item.label.trim();
    const value = item.value.trim();
    if (!value) continue;
    if (isShotCharacterFieldLabel(label) || isExplicitCharacterNameFieldLabel(label)) {
      pushUniqueNames(names, seen, parseCharacterNamesFromListText(value));
    }
  }

  for (const item of items) {
    const label = item.label.trim();
    const value = item.value.trim();
    if (!value || !DIALOGUE_FIELD_RE.test(label)) continue;
    for (const part of value.split(/[；;|\n]/)) {
      const speaker = extractSpeakerFromStoryboardLine(part);
      if (speaker) pushUniqueNames(names, seen, [speaker]);
    }
  }

  return names;
}

function findShotCharacterFieldDef(catalog: StoryboardParseFieldDef[]): StoryboardParseFieldDef | undefined {
  return catalog.find((def) => isShotCharacterFieldLabel(def.label));
}

function collectDialogueSpeakersFromRow(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const def of catalog) {
    if (!DIALOGUE_FIELD_RE.test(def.label)) continue;
    const value = String(row.shotFields[def.id] || '').trim();
    if (!value) continue;
    for (const part of value.split(/[；;|\n]/)) {
      const speaker = extractSpeakerFromStoryboardLine(part);
      if (speaker) pushUniqueNames(names, seen, [speaker]);
    }
  }
  return names;
}

/** 从表格行读取角色名：优先「镜头内角色」，其次人物/角色列，最后对白说话人 */
export function inferCharacterNamesFromShotRow(
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  const shotField = findShotCharacterFieldDef(catalog);
  if (shotField) {
    const value = String(row.shotFields[shotField.id] || '').trim();
    if (value) pushUniqueNames(names, seen, parseCharacterNamesFromListText(value));
  }

  if (names.length) return names;

  for (const def of catalog) {
    if (!isExplicitCharacterNameFieldLabel(def.label) || isShotCharacterFieldLabel(def.label)) continue;
    const value = String(row.shotFields[def.id] || '').trim();
    if (value) pushUniqueNames(names, seen, parseCharacterNamesFromListText(value));
  }

  pushUniqueNames(names, seen, collectDialogueSpeakersFromRow(row, catalog));
  return names;
}

/** 解析/导入后：若识别到角色名则写入「镜头内角色」列 */
export function ensureShotCharacterFieldOnRow(
  catalog: StoryboardParseFieldDef[],
  row: StoryboardTableRow,
  parsedItems?: StoryboardParseFieldItem[]
): { catalog: StoryboardParseFieldDef[]; row: StoryboardTableRow } {
  let nextCatalog = [...catalog];

  const existingDef = findShotCharacterFieldDef(nextCatalog);
  const existingValue = existingDef ? String(row.shotFields[existingDef.id] || '').trim() : '';
  if (existingValue) {
    const validated = parseCharacterNamesFromListText(existingValue);
    if (validated.length && existingDef) {
      const shotFields = { ...row.shotFields, [existingDef.id]: validated.join('、') };
      return { catalog: nextCatalog, row: applyShotFieldsPatch(row, nextCatalog, shotFields) };
    }
  }

  const inferred = parsedItems?.length
    ? inferCharacterNamesFromFieldItems(parsedItems)
    : inferCharacterNamesFromShotRow(row, nextCatalog);

  if (!inferred.length) {
    return { catalog: nextCatalog, row };
  }

  const fieldId = existingDef?.id ?? resolveFieldId(nextCatalog, STORYBOARD_SHOT_CHARACTER_FIELD_LABEL);
  if (!existingDef) {
    const maxOrder = nextCatalog.reduce((max, def) => Math.max(max, def.order), -1);
    nextCatalog = [
      ...nextCatalog,
      {
        id: fieldId,
        label: STORYBOARD_SHOT_CHARACTER_FIELD_LABEL,
        order: maxOrder + 1,
        kind: 'text' as const,
        redrawInclude: false,
      },
    ].sort((a, b) => a.order - b.order);
  }

  const shotFields = {
    ...row.shotFields,
    [fieldId]: inferred.join('、'),
  };
  return {
    catalog: nextCatalog,
    row: applyShotFieldsPatch(row, nextCatalog, shotFields),
  };
}
