import { describe, expect, it } from 'vitest';
import { buildAgentVisibleContextSummary } from '../services/projectAgent/visibleContext';

describe('buildAgentVisibleContextSummary', () => {
  it('summarizes project context when there is no selection', () => {
    expect(buildAgentVisibleContextSummary({ projectName: 'Spring Campaign' })).toEqual({
      title: '当前项目：Spring Campaign',
      chips: ['Spring Campaign'],
      source: 'project',
      risk: 'none',
    });
  });

  it('summarizes multiple selected images as a batch risk', () => {
    const summary = buildAgentVisibleContextSummary({
      selection: { ids: ['img-1', 'img-2', '', 'img-2'], activeId: 'img-2' },
    });

    expect(summary).toMatchObject({
      title: '已选 2 个资产',
      chips: ['2 个资产', '当前目标'],
      targetIds: ['img-1', 'img-2'],
      targetCount: 2,
      source: 'selection',
      risk: 'batch',
      details: ['当前目标资产：img-2'],
    });
  });

  it('summarizes a lightbox image as the current preview target', () => {
    const summary = buildAgentVisibleContextSummary({
      surface: { kind: 'lightbox', targetId: 'hero-large', title: 'Hero close-up' },
      selection: { ids: ['ignored-selection'] },
    });

    expect(summary).toEqual({
      title: 'Hero close-up',
      chips: ['当前预览', '1 个资产'],
      targetIds: ['hero-large'],
      targetCount: 1,
      source: 'lightbox',
      risk: 'cost',
    });
  });

  it('summarizes local edit context with destructive risk', () => {
    const summary = buildAgentVisibleContextSummary({
      surface: { kind: 'local_edit', targetIds: ['layer-1', 'layer-2'] },
    });

    expect(summary).toEqual({
      title: '当前编辑草稿',
      chips: ['编辑草稿', '2 个对象'],
      targetIds: ['layer-1', 'layer-2'],
      targetCount: 2,
      source: 'local_edit',
      risk: 'destructive',
      details: ['可能影响当前编辑草稿，执行前需要确认是否保留原内容'],
    });
  });

  it('summarizes attachments when no visual target is active', () => {
    const summary = buildAgentVisibleContextSummary({ attachmentCount: 3 });

    expect(summary).toEqual({
      title: '已挂载 3 个上下文资产',
      chips: ['3 个上下文资产'],
      targetCount: 3,
      source: 'attachment',
      risk: 'cost',
      details: ['已挂载 3 个可供 Agent 读取的资产或文件'],
    });
  });

  it('marks stale context without changing the source', () => {
    const summary = buildAgentVisibleContextSummary({
      projectName: 'Archive',
      stale: true,
    });

    expect(summary).toEqual({
      title: '当前项目：Archive',
      chips: ['Archive', '可能过期'],
      source: 'project',
      risk: 'none',
      stale: true,
      details: ['当前上下文可能已过期，执行前应重新确认范围'],
    });
  });
});
