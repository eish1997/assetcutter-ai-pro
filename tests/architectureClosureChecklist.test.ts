import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const checklistPath = path.resolve(process.cwd(), 'docs/架构未收口清单.md');
const shellCharterPath = path.resolve(process.cwd(), 'docs/架构宪章-本地壳大楼租户.md');

describe('architecture closure checklist', () => {
  it('keeps only unfinished closure items in the active checklist', () => {
    const text = fs.readFileSync(checklistPath, 'utf8');
    const statuses = [...text.matchAll(/\*\*状态\*\*：`([^`]+)`/g)].map((m) => m[1]);

    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set(statuses.filter((s) => ['open', 'in_progress', 'blocked'].includes(s))));
    expect(text).not.toContain('done_first_pass');
    expect(text).not.toContain('**已完成**');
    expect(text).not.toContain('**已完成首版**');
  });

  it('keeps first-party web session on a shared partition', () => {
    const text = fs.readFileSync(shellCharterPath, 'utf8');

    expect(text).toContain('persist:assetcutter-team');
    expect(text).toContain('壳内登录一次');
    expect(text).toContain('共享登录态门槛');
    expect(text).toContain('壳内工作台登录后');
    expect(text).not.toContain('分 partition Cookie');
    expect(text).not.toContain('双域登录');
    expect(text).toContain('技能');
    expect(text).toContain('代码房间仍叫 `workflow`');
    expect(text).not.toContain('左栏仍写 Workflow');
  });
});
