import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['components', 'services'];
const sourceExt = /\.(?:tsx?|jsx?)$/;

const visibleTextLinePatterns = [
  /onLog\?\./,
  /onNotify\?\./,
  /\bnotify\(/,
  /\btoast\b/,
  /\bsetActionInfo\(/,
  /\bset[A-Z]\w*(?:Error|Message|Status|Info|Label)\(/,
  /\b(?:aria-label|title|placeholder)=/,
  /\b(?:label|title|message|error|description|hint|tooltip|text):\s*['"`]/,
];

const mojibakePatterns = [
  /\uFFFD/,
  /(?:\?){4,}/,
  /[鎴鍥搴鐢閫璐绱妫棰瀹彂鐞涓浠姝鏂璇閸閺娑鐏婊绋绾诲]/,
  /[濞妴瀵婢缁閹鐠閻濡楁潏娴鐗]/,
  /[锟鈧偓]/,
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (sourceExt.test(entry.name)) out.push(full);
  }
  return out;
}

describe('visible product text mojibake guard', () => {
  it('keeps user-facing UI and log strings free of common mojibake markers', () => {
    const files = roots.flatMap((root) => walk(path.resolve(process.cwd(), root)));
    const offenders: string[] = [];

    for (const file of files) {
      const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!visibleTextLinePatterns.some((pattern) => pattern.test(line))) return;
        const matched = mojibakePatterns.find((pattern) => pattern.test(line));
        if (matched) offenders.push(`${rel}:${index + 1} ${matched}`);
      });
    }

    expect(offenders.slice(0, 20)).toEqual([]);
  });
});
