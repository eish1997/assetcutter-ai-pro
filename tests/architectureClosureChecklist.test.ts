import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const checklistPath = path.resolve(process.cwd(), 'docs/架构未收口清单.md');
const agentSpecPath = path.resolve(process.cwd(), 'docs/本地伴侣-全局Agent规格.md');
const copilotInfraPath = path.resolve(process.cwd(), 'docs/本地伴侣-Copilot基础设施改造文档.md');

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

  it('keeps the Copilot agent spec aligned to the shared first-party web session', () => {
    const text = fs.readFileSync(agentSpecPath, 'utf8');

    expect(text).toContain('persist:assetcutter-team');
    expect(text).toContain('壳内登录一次');
    expect(text).not.toContain('分 partition Cookie');
    expect(text).not.toContain('双域登录');
  });

  it('keeps the Copilot infrastructure P0 validation account-gated', () => {
    const text = fs.readFileSync(copilotInfraPath, 'utf8');

    expect(text).toContain('persist:assetcutter-team');
    expect(text).toContain('共享登录态门槛');
    expect(text).toContain('壳内工作台登录后');
  });
});
