/**
 * Dev-log copy for non-developers: platform updates only.
 * Avoid internal engineering/process notes such as docs, hooks, tests, and dev-log plumbing.
 */

const PLATFORM_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    /ship\s+Project\s*Agent\s*U4|Project\s*Agent\s*U4|experts?\s+and\s+optimistic\s+send/gi,
    '项目 Agent 升级：支持 @专家、自动挡、进度卡，发送后马上能看到反馈',
  ],
  [
    /project\s*Agent\s*U1\s*dock\s*plus\s*Vertex\s*Gemini-?3\s*global\s*hybrid/gi,
    '工作区加入项目 Agent，生图新模型走更稳的全球通道',
  ],
  [/project\s*Agent|Agent\s*U1|submitTurn|threadStore|Agent\s*dock/gi, '项目 Agent：右侧对话会先出计划，再在画布出活'],
  [/Gemini-?3|Vertex.*hybrid|Publisher\s*404|global\s*hybrid/gi, '生图路由更稳，新模型少报“模型找不到”'],
  [/compose[- ]?style\s+dropdowns?\s+and\s+R2[- ]?backed\s+dev\s*log/gi, '下拉菜单外观统一了'],
  [/compose[- ]?style\s+dropdowns?/gi, '下拉菜单外观'],
  [/CustomDropdown|DropdownSelect/gi, '下拉菜单'],
  [/WorkflowSidebarColumn/gi, '左侧功能区'],
  [/WorkspaceQuickComposeBar|quick\s*compose/gi, '底部输入栏'],
  [/ImagePreviewOverlay|lightbox/gi, '大图预览'],
  [/vercel\.json|SPA\s*rewrite/gi, '网站访问路径'],
  [/chunk|lazy\s*import|dynamically\s+imported\s+module/gi, '页面模块加载'],
  [/\bUI\b/g, '界面'],
  [/\bpill\b|chip/gi, '小标签'],
  [/\bR2\b/g, '云端'],
];

const INTERNAL_RE = /dev\s*log|dev-log|开发日志|receipt|小票|readme|docs|handoff|交接|cursor|hook|test|vitest|build|lint|migration|脚本|内部|文档/i;
const PLATFORM_HINT_RE = /project\s*agent|gemini|vertex|dropdown|compose|ai\s*gateway|provider\s*key|worker|tripo|model\s*3d|3d|video|jimeng|credit|billing|image|workflow|asset|preview|admin|dashboard|console/i;

function stripConventionalPrefix(subject: string): string {
  const s = String(subject || '').trim();
  const m = s.match(/^(feat|fix|chore|docs|refactor|style|test|perf|build|ci)(\([^)]*\))?:\s*(.+)$/i);
  return m ? String(m[3]).trim() : s;
}

function latinRatio(s: string): number {
  return (s.replace(/[^A-Za-z]/g, '').length || 0) / Math.max(s.length, 1);
}

function isEngineeringNoise(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (INTERNAL_RE.test(t) && !PLATFORM_HINT_RE.test(t)) return true;
  if (/^共触发\s*\d+\s*个文件/.test(t)) return true;
  if (/^今天动了约\s*\d+\s*处/.test(t)) return true;
  if (/^文件\s*\d+\s*\+/.test(t)) return true;
  if (/个文件（如\s/.test(t)) return true;
  if (/^(feat|fix|chore|docs|refactor|style|test|perf|build|ci)\b/i.test(t) && t.length < 16) return true;
  return false;
}

function plainFallbackFromEnglish(text: string): string {
  const raw = stripConventionalPrefix(String(text || '').trim())
    .replace(/[-_/]+/g, ' ')
    .replace(/\b(feat|fix|chore|docs|refactor|style|test|perf|build|ci)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!raw || INTERNAL_RE.test(raw)) return '';
  if (/ai\s*gateway|provider\s*key|worker|tripo|model\s*3d|3d|video|jimeng/i.test(raw)) {
    return 'AI Gateway、供应商 Key 池和多模态任务链路继续升级，后续接 3D、视频会更统一';
  }
  if (/admin|permission|role|dashboard|console/i.test(raw)) {
    return '后台管理能力更完整，权限、入口和运营信息更容易查看';
  }
  if (/credit|billing|usage|cost|settlement|reserve/i.test(raw)) {
    return '积分和计费链路更清楚，任务成功、失败和结算更容易追踪';
  }
  if (/image|generate|workflow|asset|preview/i.test(raw)) {
    return '生成任务链路更稳，工作流里的状态和结果回填更清楚';
  }
  return '';
}

function softenEnglishRuns(text: string): string {
  const s = text.trim();
  if (!s || isEngineeringNoise(s)) return '';
  if (latinRatio(s) <= 0.28) return s;
  if (/下拉|dropdown/i.test(s)) return '下拉菜单外观和底部输入栏统一了';
  if (/预览|全景|3[Dd]|equirect/i.test(s)) return '大图预览切换全景、3D 时更稳了';
  if (/积分|credit/i.test(s)) return '积分相关流程更稳了';
  if (/project\s*agent\s*u4|optimistic\s+send|@?expert|child\s*run|auto\s*mode/i.test(s)) {
    return '项目 Agent 升级：支持 @专家、自动挡、进度卡，发送后马上能看到反馈';
  }
  if (/project\s*agent|agent\s*dock|submitturn/i.test(s)) {
    return '工作区右侧多了项目 Agent，说话会先出计划再出活';
  }
  if (/gemini-?3|vertex|hybrid|publisher/i.test(s)) {
    return '生图路由更稳，新模型少报“模型找不到”';
  }
  return plainFallbackFromEnglish(s);
}

export function humanizeDevLogBullet(raw: string): string {
  let s = stripConventionalPrefix(String(raw || '').trim());
  if (!s || (isEngineeringNoise(s) && !PLATFORM_HINT_RE.test(s))) return '';

  for (const [re, to] of PLATFORM_REPLACEMENTS) {
    s = s.replace(re, to);
  }

  s = s.replace(/\b(and|with|for|the|a|an|to|of|in|on|from|into)\b/gi, ' ');
  s = s.replace(/[（(]\s*[A-Za-z][A-Za-z0-9_./+\- ]{1,}\s*[）)]/g, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/[（(]\s*[）)]/g, '').trim();
  s = s.replace(/^[·•\-\u2013\u2014\s]*/, '');
  s = s.replace(/\s*([，。；：])\s*/g, '$1').trim();

  s = softenEnglishRuns(s);
  if (!s || isEngineeringNoise(s)) return '';
  return s.replace(/\(\s*\)/g, '').trim();
}

export function buildPlainDayReceiptSummary(bullets: string[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of bullets) {
    const plain = humanizeDevLogBullet(raw);
    if (!plain || isEngineeringNoise(plain)) continue;
    if (latinRatio(plain) > 0.35) continue;
    const key = plain.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(plain);
    if (out.length >= max) break;
  }

  if (!out.length) out.push('今天主要是内部整理，没有需要写进平台更新的小票内容');
  return out;
}
