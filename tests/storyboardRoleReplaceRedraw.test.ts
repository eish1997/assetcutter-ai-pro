import { describe, expect, it } from 'vitest';
import {
  compileStoryboardRoleReplaceCollagePrompt,
  compileStoryboardRoleReplacePrompt,
  isStoryboardRoleReplaceEligible,
  planStoryboardRoleReplace,
  planStoryboardRoleReplaceTasks,
  resolveRoleAssetForMark,
} from '../services/storyboardRoleReplaceRedraw';
import type { StoryboardRoleAsset, StoryboardTableRow, StoryboardParseFieldDef } from '../types';

const roleAssets: StoryboardRoleAsset[] = [
  { id: 'r1', name: '张三', image: 'data:image/jpeg;base64,abc' },
  { id: 'r2', name: '李四', image: 'data:image/jpeg;base64,def' },
];

const catalog: StoryboardParseFieldDef[] = [
  {
    id: 'visual',
    label: '画面描述',
    order: 0,
    redrawInclude: true,
    parseInclude: true,
    maxLen: 500,
  },
];

const row: StoryboardTableRow = {
  id: 'row1',
  index: 0,
  shotNo: '01',
  shotFields: { visual: '张三在雨夜街头回头，霓虹灯映在脸上' },
  shotText: '',
  frameImage: 'data:image/jpeg;base64,frame',
  frameRoleMarks: [
    { id: 'm1', name: '张三', x: 0.2, y: 0.4, roleAssetId: 'r1' },
    { id: 'm2', name: '李四', x: 0.7, y: 0.5, roleAssetId: 'r2' },
  ],
};

describe('storyboardRoleReplaceRedraw', () => {
  it('resolves role asset by id or name', () => {
    expect(resolveRoleAssetForMark({ id: 'm1', name: '张三', x: 0, y: 0, roleAssetId: 'r1' }, roleAssets)?.id).toBe(
      'r1'
    );
    expect(resolveRoleAssetForMark({ id: 'm2', name: '李四', x: 0, y: 0 }, roleAssets)?.id).toBe('r2');
  });

  it('detects eligible rows', () => {
    expect(isStoryboardRoleReplaceEligible(row, roleAssets)).toBe(true);
    expect(isStoryboardRoleReplaceEligible({ ...row, frameRoleMarks: [] }, roleAssets)).toBe(false);
  });

  it('detects eligible rows when role asset only has companion key', () => {
    const companionOnlyAssets: StoryboardRoleAsset[] = [
      { id: 'r1', name: '张三', imageCompanionKey: 'wf-res/storyboard-role-asset-r1' },
      { id: 'r2', name: '李四', imageCompanionKey: 'wf-res/storyboard-role-asset-r2' },
    ];
    expect(isStoryboardRoleReplaceEligible(row, companionOnlyAssets)).toBe(true);
  });

  it('detects eligible rows when mark binds roleAssetId without inline name', () => {
    const marksOnlyById = {
      ...row,
      frameRoleMarks: [{ id: 'm1', name: '', x: 0.2, y: 0.4, roleAssetId: 'r1' }],
    };
    expect(isStoryboardRoleReplaceEligible(marksOnlyById, roleAssets)).toBe(true);
  });

  it('builds replace prompt with reference indices', async () => {
    const planned = await planStoryboardRoleReplace(row, roleAssets, 'data:image/jpeg;base64,frame');
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.referenceImages).toHaveLength(3);
    const prompt = compileStoryboardRoleReplacePrompt(row, planned.plan, catalog);
    expect(prompt).toContain('张三');
    expect(prompt).toContain('参考图 2');
    expect(prompt).toContain('参考图 3');
    expect(prompt).toContain('画面说明');
    expect(prompt).toContain('雨夜街头');
  });

  it('plans collage batch tasks by limit', () => {
    const rows = [
      row,
      { ...row, id: 'row2', index: 1, shotNo: '2' },
      { ...row, id: 'row3', index: 2, shotNo: '3' },
    ];
    const tasks = planStoryboardRoleReplaceTasks(rows, roleAssets, 2);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.rows).toHaveLength(2);
    expect(tasks[1]?.rows).toHaveLength(1);
  });

  it('builds collage replace prompt with grid hint', async () => {
    const planned = await planStoryboardRoleReplace(row, roleAssets, 'data:image/jpeg;base64,frame');
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rowMarkPlans = new Map([[row.id, planned.plan.marks]]);
    const prompt = compileStoryboardRoleReplaceCollagePrompt([row], rowMarkPlans, catalog);
    expect(prompt).toContain('参考图 1 为本拼图');
    expect(prompt).toContain('张三');
    expect(prompt).toContain('画面说明');
    expect(prompt).toContain('雨夜街头');
  });
});
