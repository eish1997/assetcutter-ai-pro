import { workflowChat } from './unifiedAiGateway';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';

type TagBuildInput = {
  actionLabel: string;
  actionId: string;
  presetInstruction?: string;
  promptOverride?: string;
  inputText?: string;
};

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  character: ['人物', '角色', 'human', 'character', 'portrait', 'avatar'],
  creature: ['动物', '生物', 'monster', 'creature', 'pet'],
  vehicle: ['汽车', '机车', '车辆', 'car', 'vehicle', 'bike', 'truck', 'ship', 'aircraft'],
  architecture: ['建筑', '室内', '室外', 'building', 'architecture', 'interior', 'exterior'],
  product: ['产品', '商品', '道具', 'asset', 'prop', 'product'],
  food: ['食物', '美食', 'food', 'dessert', 'drink'],
  nature: ['自然', '植物', '森林', '山', '海', 'flower', 'tree', 'forest', 'mountain', 'ocean'],
};

const STYLE_KEYWORDS: Record<string, string[]> = {
  realistic: ['写实', 'realistic', 'photoreal', 'photo-real'],
  anime: ['动漫', '二次元', 'anime', 'manga'],
  cartoon: ['卡通', 'cartoon', 'pixar'],
  cyberpunk: ['赛博朋克', 'cyberpunk'],
  lowpoly: ['低多边形', 'lowpoly', 'low poly'],
  lineart: ['线稿', 'line art', 'lineart'],
  flat: ['扁平', 'flat design', 'flat'],
  sketch: ['素描', '草图', 'sketch'],
  watercolor: ['水彩', 'watercolor'],
  oilpaint: ['油画', 'oil painting'],
  '3d': ['3d', '三维', '白模', 'clay'],
};

const LIGHTING_KEYWORDS: Record<string, string[]> = {
  studio: ['影棚', '棚拍', 'studio'],
  soft: ['柔光', 'soft light', 'soft lighting'],
  hard: ['硬光', 'hard light'],
  rim: ['轮廓光', 'rim light'],
  neon: ['霓虹', 'neon'],
  daylight: ['日光', 'daylight', 'sunlight'],
  night: ['夜景', 'night'],
  backlit: ['逆光', 'backlit'],
};

const COMPOSITION_KEYWORDS: Record<string, string[]> = {
  closeup: ['特写', 'close-up', 'closeup'],
  fullbody: ['全身', 'full body'],
  front: ['正面', 'front view'],
  side: ['侧面', 'side view'],
  top: ['俯视', 'top view', 'bird view'],
  isometric: ['等距', 'isometric'],
  orthographic: ['正交', 'orthographic'],
  centered: ['居中', 'centered'],
  white_bg: ['白底', 'white background'],
};

const MOOD_KEYWORDS: Record<string, string[]> = {
  cinematic: ['电影感', 'cinematic'],
  dark: ['暗黑', 'dark'],
  bright: ['明亮', 'bright'],
  dreamy: ['梦幻', 'dreamy'],
  futuristic: ['未来感', 'futuristic', 'sci-fi'],
  vintage: ['复古', 'vintage'],
};

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function pushDimensionTags(dst: string[], prefix: string, text: string, table: Record<string, string[]>): void {
  Object.entries(table).forEach(([key, words]) => {
    if (includesAny(text, words)) dst.push(`${prefix}:${key}`);
  });
}

const PREFIX_TO_ZH: Record<string, string> = {
  subject: '主题',
  style: '风格',
  lighting: '光照',
  composition: '构图',
  mood: '氛围',
  material: '材质',
  quality: '质量',
  presentation: '呈现',
  usecase: '用途',
  action: '动作',
  pipeline: '流程',
};

const PREFIX_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(PREFIX_TO_ZH).map(([en, zh]) => [zh, en])
);

const VALUE_TO_ZH: Record<string, string> = {
  character: '人物',
  creature: '生物',
  vehicle: '载具',
  architecture: '建筑',
  product: '产品',
  food: '食物',
  nature: '自然',
  realistic: '写实',
  anime: '动漫',
  cartoon: '卡通',
  cyberpunk: '赛博朋克',
  lowpoly: '低多边形',
  lineart: '线稿',
  flat: '扁平',
  sketch: '素描',
  watercolor: '水彩',
  oilpaint: '油画',
  '3d': '三维',
  studio: '影棚',
  soft: '柔光',
  hard: '硬光',
  rim: '轮廓光',
  neon: '霓虹',
  daylight: '日光',
  night: '夜景',
  backlit: '逆光',
  closeup: '特写',
  fullbody: '全身',
  front: '正面',
  side: '侧面',
  top: '俯视',
  isometric: '等距',
  orthographic: '正交',
  centered: '居中',
  white_bg: '白底',
  cinematic: '电影感',
  dark: '暗黑',
  bright: '明亮',
  dreamy: '梦幻',
  futuristic: '未来感',
  vintage: '复古',
  cutout: '抠图',
  component_split: '组件拆分',
  multi_view: '多视角',
  style_transfer: '风格迁移',
  workflow: '工作流',
};

export function buildWorkflowImageTags(input: TagBuildInput): string[] {
  const text = [
    input.actionLabel,
    input.actionId,
    input.presetInstruction || '',
    input.promptOverride || '',
    input.inputText || '',
  ]
    .join('\n')
    .toLowerCase();

  const out: string[] = [];
  pushDimensionTags(out, 'subject', text, SUBJECT_KEYWORDS);
  pushDimensionTags(out, 'style', text, STYLE_KEYWORDS);
  pushDimensionTags(out, 'lighting', text, LIGHTING_KEYWORDS);
  pushDimensionTags(out, 'composition', text, COMPOSITION_KEYWORDS);
  pushDimensionTags(out, 'mood', text, MOOD_KEYWORDS);

  if (input.actionId === 'cut_image') out.push('usecase:cutout');
  if (input.actionId === 'split_component') out.push('usecase:component_split');
  if (input.actionId === 'multi_view') out.push('composition:multi_view');
  if (input.actionId === 'style_transfer') out.push('usecase:style_transfer');

  out.push('pipeline:workflow');
  out.push(`action:${input.actionId}`);

  return toChineseWorkflowTags(Array.from(new Set(out)));
}

type RefineInput = {
  coarseTags: string[];
  actionId: string;
  actionLabel: string;
  promptHint?: string;
  /** 与设置页 `modelText` 一致；未传则用全站默认 registryId */
  textModelRegistryId?: string;
};

function normalizeTagCandidate(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (!v.includes(':')) return null;
  const [prefix, rest] = v.split(':', 2);
  if (!prefix || !rest) return null;
  const okPrefix = new Set([
    'subject',
    'style',
    'lighting',
    'composition',
    'mood',
    'material',
    'quality',
    'presentation',
    'usecase',
    'action',
    'pipeline',
  ]);
  if (!okPrefix.has(prefix)) return null;
  const rhs = rest.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!rhs) return null;
  return `${prefix}:${rhs}`;
}

function normalizeSingleTagToChinese(raw: string): string | null {
  const v = raw.trim();
  if (!v || !v.includes(':')) return null;
  const [p0, r0] = v.split(':', 2);
  const p = p0.trim().toLowerCase();
  const r = r0.trim().toLowerCase();
  if (!p || !r) return null;
  const enPrefix = PREFIX_TO_EN[p] || p;
  const zhPrefix = PREFIX_TO_ZH[enPrefix];
  if (!zhPrefix) return null;
  const normalizedValue = r.replace(/[^a-z0-9_\u4e00-\u9fa5-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalizedValue) return null;
  const zhValue = VALUE_TO_ZH[normalizedValue] || normalizedValue;
  return `${zhPrefix}:${zhValue}`;
}

export function toChineseWorkflowTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((x) => normalizeSingleTagToChinese(x))
        .filter((x): x is string => Boolean(x))
    )
  ).slice(0, 20);
}

export function normalizeWorkflowTagMapToChinese(
  map: Record<string, string[] | undefined> | undefined
): { next: Record<string, string[]> | undefined; changed: boolean } {
  if (!map) return { next: map as undefined, changed: false };
  let changed = false;
  const next: Record<string, string[]> = {};
  Object.entries(map).forEach(([k, arr]) => {
    const src = Array.isArray(arr) ? arr : [];
    const zh = toChineseWorkflowTags(src);
    next[k] = zh;
    if (zh.length !== src.length || zh.some((v, i) => v !== src[i])) changed = true;
  });
  return { next, changed };
}

export async function refineWorkflowImageTagsLowCost(input: RefineInput): Promise<string[]> {
  const prompt = [
    '你是图片资产标签助手。请在不看图片的前提下，仅根据以下文本上下文补全更可检索的标签。',
    '要求：',
    '1) 仅输出 JSON，格式：{"tags":["中文维度:中文值", ...]}',
    '2) 标签总数 <= 20',
    '3) 允许维度：主题/风格/光照/构图/氛围/材质/质量/呈现/用途/动作/流程',
    '4) 保留已有 coarseTags，可新增更细维度但不要发明无依据事实',
    `actionId=${input.actionId}`,
    `actionLabel=${input.actionLabel}`,
    `coarseTags=${JSON.stringify(input.coarseTags)}`,
    `promptHint=${input.promptHint || ''}`,
  ].join('\n');
  const textModel = (input.textModelRegistryId || '').trim() || DEFAULT_MODEL_TEXT;
  const raw = await workflowChat([{ role: 'user', parts: [{ text: prompt }] }], textModel);
  const parsed = (() => {
    try {
      return JSON.parse(raw || '{}') as { tags?: unknown };
    } catch {
      return { tags: [] as unknown[] };
    }
  })();
  const aiTags = Array.isArray(parsed.tags) ? parsed.tags : [];
  const merged = [...input.coarseTags, ...aiTags.map((x) => String(x))];
  const normalized = merged
    .map((x) => normalizeTagCandidate(x) ?? x)
    .filter((x): x is string => Boolean(x));
  return toChineseWorkflowTags(normalized);
}

