import { describe, expect, it } from 'vitest';
import type { ProjectAgentThread } from '../services/projectAgent/threadStore';
import {
  buildProjectAgentExportFilename,
  exportProjectAgentThreadSlimJson,
  slimMessageForExport,
  stripBase64FromExportValue,
} from '../services/projectAgent/threadExport';

function makeThread(overrides?: Partial<ProjectAgentThread>): ProjectAgentThread {
  return {
    id: 'thread-export-1',
    workspaceProjectId: 'proj-export-1',
    messages: [
      {
        id: 'u1',
        role: 'user',
        text: 'hello',
        timestamp: 1,
        status: 'submitted',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: '计划：文生图',
        timestamp: 2,
        status: 'done',
        planSteps: [{ label: '文生图', toolId: 'run_plain_t2i' }],
        childRuns: [
          {
            id: 'cr1',
            kind: 'tool',
            label: '文生图',
            toolId: 'run_plain_t2i',
            status: 'done',
            startedAt: 2,
            endedAt: 3,
          },
        ],
        resultText: 'ok',
      },
    ],
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

describe('exportProjectAgentThreadSlimJson (5C)', () => {
  it('exports slim fields including planSteps and childRuns', () => {
    const json = exportProjectAgentThreadSlimJson(makeThread());
    const parsed = JSON.parse(json) as {
      id: string;
      messages: Array<Record<string, unknown>>;
    };
    expect(parsed.id).toBe('thread-export-1');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1].planSteps).toEqual([{ label: '文生图', toolId: 'run_plain_t2i' }]);
    expect(parsed.messages[1].childRuns).toEqual([
      expect.objectContaining({ id: 'cr1', kind: 'tool', status: 'done' }),
    ]);
  });

  it('strips data:image base64 from text and nested fields', () => {
    const thread = makeThread({
      messages: [
        {
          id: 'u-b64',
          role: 'user',
          text: 'see data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== end',
          timestamp: 1,
          resultText: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
        },
      ],
    });
    const json = exportProjectAgentThreadSlimJson(thread);
    expect(json).not.toMatch(/data:image\/[^;]+;base64,/i);
    expect(json).not.toContain('iVBORw0KGgo');
    expect(json).toContain('[omitted-data-url]');
  });

  it('stripBase64FromExportValue handles standalone long base64', () => {
    const longB64 = `${'A'.repeat(200)}${'B'.repeat(80)}=`;
    expect(longB64.length).toBeGreaterThan(256);
    expect(stripBase64FromExportValue(longB64)).toBe('[omitted-base64]');
    expect(stripBase64FromExportValue('short')).toBe('short');
  });

  it('slimMessageForExport keeps ids not media', () => {
    const slim = slimMessageForExport({
      id: 'm1',
      role: 'assistant',
      text: 'hi',
      timestamp: 9,
      assetIds: ['asset-1'],
      taskIds: ['task-1'],
    });
    expect(slim).toEqual(
      expect.objectContaining({
        id: 'm1',
        assetIds: ['asset-1'],
        taskIds: ['task-1'],
      })
    );
  });

  it('buildProjectAgentExportFilename truncates projectId', () => {
    const name = buildProjectAgentExportFilename('very-long-project-id-xxxxxxxxxxxxxxxxxxxx');
    expect(name).toMatch(/^project-agent-.+\-\d+\.json$/);
    expect(name.length).toBeLessThan(80);
  });
});
