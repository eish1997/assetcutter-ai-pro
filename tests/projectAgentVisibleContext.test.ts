import { describe, expect, it } from 'vitest';
import { buildAgentVisibleContextSummary } from '../services/projectAgent/visibleContext';

describe('buildAgentVisibleContextSummary', () => {
  it('summarizes project context when there is no selection', () => {
    expect(buildAgentVisibleContextSummary({ projectName: 'Spring Campaign' })).toEqual({
      title: 'Project: Spring Campaign',
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
      title: '2 selected assets',
      chips: ['2 selected', 'active'],
      targetIds: ['img-1', 'img-2'],
      targetCount: 2,
      source: 'selection',
      risk: 'batch',
      details: ['Active target: img-2'],
    });
  });

  it('summarizes a lightbox image as the current preview target', () => {
    const summary = buildAgentVisibleContextSummary({
      surface: { kind: 'lightbox', targetId: 'hero-large', title: 'Hero close-up' },
      selection: { ids: ['ignored-selection'] },
    });

    expect(summary).toEqual({
      title: 'Hero close-up',
      chips: ['lightbox', '1 image'],
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
      title: 'Local edit context',
      chips: ['local edit', '2 targets'],
      targetIds: ['layer-1', 'layer-2'],
      targetCount: 2,
      source: 'local_edit',
      risk: 'destructive',
      details: ['Changes may overwrite the active edit draft'],
    });
  });

  it('summarizes attachments when no visual target is active', () => {
    const summary = buildAgentVisibleContextSummary({ attachmentCount: 3 });

    expect(summary).toEqual({
      title: '3 attachments',
      chips: ['3 attachments'],
      targetCount: 3,
      source: 'attachment',
      risk: 'cost',
      details: ['3 attached sources available'],
    });
  });

  it('marks stale context without changing the source', () => {
    const summary = buildAgentVisibleContextSummary({
      projectName: 'Archive',
      stale: true,
    });

    expect(summary).toEqual({
      title: 'Project: Archive',
      chips: ['Archive', 'stale'],
      source: 'project',
      risk: 'none',
      stale: true,
      details: ['Context may be out of date'],
    });
  });
});
