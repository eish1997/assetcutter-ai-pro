/**
 * Dev-log copy for non-developers: what changed + how it feels.
 * Prefer Chinese; keep only short product words (如 下拉、小票).
 */

/** Longer / more specific patterns first. */
const JARGON_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    /ship\s+Project\s*Agent\s*U4|Project\s*Agent\s*U4|experts?\s+and\s+optimistic\s+send/gi,
    '项目 Agent 大升级：@专家、自动挡、进度卡、导出记录，发送立刻有反馈',
  ],
  [
    /project\s*Agent\s*U1\s*dock\s*plus\s*Vertex\s*Gemini-?3\s*global\s*hybrid/gi,
    '工作区上了项目 Agent；生图新模型走全球通道，少报「模型找不到」',
  ],
  [/project\s*Agent|Agent\s*U1|submitTurn|threadStore|Agent\s*dock/gi, '项目 Agent（右侧对话会先出计划再出活）'],
  [/Gemini-?3|Vertex.*hybrid|Publisher\s*404|global\s*hybrid/gi, '生图路由（新模型走全球通道）'],
  [/richer\s+thermal\s+receipt\s+and\s+work[- ]?style\s+summaries?/gi, '开发日志小票更好看了，摘要也更白话'],
  [/compose[- ]?style\s+dropdowns?\s+and\s+R2[- ]?backed\s+dev\s*log/gi, '下拉菜单外观统一了，开发日志也上线了'],
  [/compose[- ]?style\s+dropdowns?/gi, '下拉菜单外观'],
  [/R2[- ]?backed\s+dev\s*log/gi, '开发日志（云端保存）'],
  [/thermal\s+receipt/gi, '日结小票'],
  [/work[- ]?style\s+summaries?/gi, '更白话的工作摘要'],
  [/dev[- ]?log/gi, '开发日志'],
  [/CustomDropdown|DropdownSelect/gi, '下拉菜单'],
  [/WorkflowSidebarColumn/gi, '左侧功能区'],
  [/WorkspaceQuickComposeBar|quick\s*compose/gi, '底部输入栏'],
  [/ImagePreviewOverlay|lightbox/gi, '大图预览'],
  [/auth-api/gi, '后台接口'],
  [/vercel\.json|SPA\s*rewrite/gi, '网站发布配置'],
  [/chunk|lazy\s*import|dynamically\s+imported\s+module/gi, '页面模块'],
  [/push\s*后|post-push/gi, '推送成功后'],
  [/tip\s*已对齐/gi, '没有新改动'],
  [/空\s*diff/gi, '没有文件变化'],
  [/\bUI\b/g, '界面'],
  [/\bpill\b/gi, '小标签'],
  [/compose\s*chip\s*\/\s*settings\s*分轨/gi, '输入栏一套、设置页仍用原样'],
  [/compose\s*chip/gi, '输入栏同款小标签'],
  [/\bchip\b/gi, '小标签'],
  [/\bcompose\b/gi, '输入栏'],
  [/settings\s*分轨/gi, '设置页单独样式'],
  [/全局输入框族|全局输入框/g, '底部输入栏'],
  [/功能区组头/g, '左侧功能区标题旁的小按钮'],
  [/筛选标签/g, '筛选小标签'],
  [/快捷栏同款/g, '和底部输入栏一样的'],
  [/时间轴与小票导出/g, '能按天看记录，也能导出小票'],
  [/交接文档与 Cursor 规范同步/g, '内部交接说明也跟着更新了'],
  [/总结上传\s*R2/g, '总结保存到云端'],
  [/\bR2\b/g, '云端'],
];

/** Drop lines that are pure engineering inventory for day-level “本日总结”. */
function isEngineeringNoise(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^共触及\s*\d+\s*个文件/.test(t)) return true;
  if (/^今天动了约\s*\d+\s*处/.test(t)) return true;
  if (/^文件\s*\d+\s*\+/.test(t)) return true;
  if (/个文件（如\s/.test(t)) return true;
  if (/^(feat|fix|chore|docs|refactor|style|test)\b/i.test(t) && t.length < 12) return true;
  return false;
}

function stripConventionalPrefix(subject: string): string {
  const s = String(subject || '').trim();
  const m = s.match(
    /^(feat|fix|chore|docs|refactor|style|test|perf|build|ci)(\([^)]*\))?:\s*(.+)$/i
  );
  return m ? String(m[3]).trim() : s;
}

function latinRatio(s: string): number {
  return (s.replace(/[^A-Za-z]/g, '').length || 0) / Math.max(s.length, 1);
}

function plainFallbackFromEnglish(text: string): string {
  const s = stripConventionalPrefix(String(text || '').trim());
  if (!s) return '这次改动已整理成开发记录，方便回看发生了什么';
  const cleaned = s
    .replace(/[-_/]+/g, ' ')
    .replace(/\b(feat|fix|chore|docs|refactor|style|test|perf|build|ci)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/ai\s*gateway|provider\s*key|worker|tripo|model\s*3d|3d/i.test(cleaned)) {
    return '这次主要推进 AI Gateway、供应商 Key 池和多模态 worker，让后续接 3D、视频、音乐时走统一任务链路';
  }
  if (/admin|permission|role|dashboard|console/i.test(cleaned)) {
    return '这次主要整理后台管理能力，让权限、入口和运营信息更容易看懂和维护';
  }
  if (/credit|billing|usage|cost|settlement|reserve/i.test(cleaned)) {
    return '这次主要整理积分和计费链路，让任务成功、失败和结算记录更清楚';
  }
  if (/image|video|music|model|generate|workflow/i.test(cleaned)) {
    return '这次主要整理生成任务链路，让工作流里的生成、状态和结果回填更稳';
  }
  return `这次主要整理「${cleaned}」，让相关流程更清楚、更可追踪`;
}

/** If still English-heavy, collapse to a short Chinese feel line. */
function softenEnglishRuns(text: string): string {
  const s = text.trim();
  if (latinRatio(s) <= 0.28) return s;
  if (/小票|receipt/i.test(s)) return '开发日志小票样式和摘要文案更好读了';
  if (/下拉|dropdown/i.test(s)) return '下拉菜单外观和底部输入栏统一了';
  if (/预览|全景|3[Dd]|equirect/i.test(s)) return '大图预览切换全景、3D 时更稳了';
  if (/积分|credit/i.test(s)) return '积分相关流程更稳了';
  if (/project\s*agent\s*u4|optimistic\s+send|@?expert|child\s*run|auto\s*mode/i.test(s)) {
    return '项目 Agent 大升级：@专家、自动挡、进度卡、导出记录，发送立刻有反馈';
  }
  if (/project\s*agent|agent\s*dock|submitturn/i.test(s)) {
    return '工作区右侧多了项目 Agent，说话会先出计划再出活';
  }
  if (/gemini-?3|vertex|hybrid|publisher/i.test(s)) {
    return '生图路由更稳了，新模型少报「模型找不到」';
  }
  if (/开发日志|dev\s*log/i.test(s)) return '开发日志记录与展示有更新';
  return plainFallbackFromEnglish(s);
}

/**
 * One bullet → plain Chinese for non-developers.
 */
export function humanizeDevLogBullet(raw: string): string {
  let s = stripConventionalPrefix(String(raw || '').trim());
  if (!s) return '';

  for (const [re, to] of JARGON_REPLACEMENTS) {
    s = s.replace(re, to);
  }

  // Drop leftover English glue words / parentheticals
  s = s.replace(/\b(and|with|for|the|a|an|to|of|in|on|from|into)\b/gi, ' ');
  s = s.replace(/[（(]\s*[A-Za-z][A-Za-z0-9_./+\- ]{1,}\s*[）)]/g, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/[，,]\s*[，,]/g, '，').trim();
  s = s.replace(/^[·•\-–—]\s*/, '');
  s = s.replace(/\s*([，。；：])\s*/g, '$1').trim();

  s = softenEnglishRuns(s);

  s = s
    .replace(/：+/g, '：')
    .replace(/（\s*）/g, '')
    .replace(/\(\s*\)/g, '')
    .trim();

  return s;
}

/**
 * Day-level「本日总结」: plain bullets, no sections, no file-count inventory.
 */
export function buildPlainDayReceiptSummary(bullets: string[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of bullets) {
    if (isEngineeringNoise(String(raw || ''))) continue;
    const plain = humanizeDevLogBullet(raw);
    if (!plain || isEngineeringNoise(plain)) continue;
    if (latinRatio(plain) > 0.28) continue;
    const key = plain.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(plain);
    if (out.length >= max) break;
  }

  if (!out.length) out.push('今天暂无适合写进小票的改动说明');
  return out;
}
