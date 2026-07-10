/**
 * P0.5-b：助手气泡安全 Markdown 子集（无 raw HTML，输出 React 节点）。
 * 支持：围栏代码、行内代码、粗体/斜体、标题、列表、段落、http(s) 链接。
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'link'; href: string; children: MdInline[] };

export type MdBlock =
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: MdInline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'ul'; items: MdInline[][] }
  | { type: 'ol'; items: MdInline[][] };

const SAFE_HREF = /^https?:\/\//i;

function isSafeHref(href: string): boolean {
  const t = href.trim();
  return SAFE_HREF.test(t) && !/[\s<>"']/.test(t);
}

/** 解析行内：`code`、**bold**、*em*、[text](url) */
export function parseInlineMarkdown(input: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += s;
    else out.push({ type: 'text', text: s });
  };

  while (i < input.length) {
    // inline code
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end > i + 1) {
        out.push({ type: 'code', text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // bold **
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end > i + 2) {
        out.push({ type: 'strong', children: parseInlineMarkdown(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // italic *
    if (input[i] === '*' && input[i + 1] !== '*') {
      const end = input.indexOf('*', i + 1);
      if (end > i + 1) {
        out.push({ type: 'em', children: parseInlineMarkdown(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    // link [label](url)
    if (input[i] === '[') {
      const closeLabel = input.indexOf(']', i + 1);
      if (closeLabel > i && input[closeLabel + 1] === '(') {
        const closeUrl = input.indexOf(')', closeLabel + 2);
        if (closeUrl > closeLabel + 2) {
          const label = input.slice(i + 1, closeLabel);
          const href = input.slice(closeLabel + 2, closeUrl).trim();
          if (isSafeHref(href)) {
            out.push({ type: 'link', href, children: parseInlineMarkdown(label) });
            i = closeUrl + 1;
            continue;
          }
        }
      }
    }
    pushText(input[i]!);
    i += 1;
  }
  return out;
}

function flushParagraph(buf: string[], blocks: MdBlock[]) {
  const text = buf.join('\n').trim();
  buf.length = 0;
  if (!text) return;
  blocks.push({ type: 'paragraph', children: parseInlineMarkdown(text) });
}

/** 将助手正文解析为块级 AST（不执行 HTML）。 */
export function parseSafeMarkdown(source: string): MdBlock[] {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];

  const blocks: MdBlock[] = [];
  const lines = text.split('\n');
  let i = 0;
  const paraBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // fenced code
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph(paraBuf, blocks);
      const lang = fence[1] || '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      i += 1; // skip closing fence
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(paraBuf, blocks);
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInlineMarkdown(heading[2]!.trim()) });
      i += 1;
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph(paraBuf, blocks);
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push(parseInlineMarkdown((lines[i] ?? '').replace(/^\s*[-*]\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paraBuf, blocks);
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push(parseInlineMarkdown((lines[i] ?? '').replace(/^\s*\d+\.\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // blank → paragraph break
    if (!line.trim()) {
      flushParagraph(paraBuf, blocks);
      i += 1;
      continue;
    }

    paraBuf.push(line);
    i += 1;
  }

  flushParagraph(paraBuf, blocks);
  return blocks;
}
