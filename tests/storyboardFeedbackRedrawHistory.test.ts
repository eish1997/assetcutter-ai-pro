import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memory, resetMemory } = vi.hoisted(() => {
  const memory: Record<string, string> = {};
  return {
    memory,
    resetMemory: () => {
      for (const k of Object.keys(memory)) delete memory[k];
    },
  };
});

vi.mock('../services/clientPersist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/clientPersist')>();
  return {
    ...actual,
    readLocalJson: <T>(key: string, fallback: T, normalize?: (parsed: unknown) => T | null): T => {
      const raw = memory[key];
      if (raw == null) return fallback;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (normalize) {
          const normalized = normalize(parsed);
          return normalized ?? fallback;
        }
        return parsed as T;
      } catch {
        return fallback;
      }
    },
    writeLocalStringOrThrow: (key: string, value: string) => {
      memory[key] = value;
    },
  };
});

import {
  readStoryboardFeedbackRedrawHistory,
  writeStoryboardFeedbackRedrawHistory,
} from '../services/storyboardFeedbackRedrawHistory';

describe('storyboardFeedbackRedrawHistory', () => {
  beforeEach(() => {
    resetMemory();
  });

  it('persists records per asset id', () => {
    const assetId = `test_asset_${Date.now()}`;
    const record = {
      id: 'fbr_1',
      createdAt: Date.now(),
      label: '12:00 · 3镜',
      rowIds: ['r1', 'r2'],
      status: 'done' as const,
      matchedCount: 2,
    };
    writeStoryboardFeedbackRedrawHistory(assetId, [record]);
    const loaded = readStoryboardFeedbackRedrawHistory(assetId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('fbr_1');
    expect(loaded[0]?.rowIds).toEqual(['r1', 'r2']);
  });

  it('normalizes interrupted running status on read', () => {
    const assetId = `test_asset_running_${Date.now()}`;
    writeStoryboardFeedbackRedrawHistory(assetId, [
      {
        id: 'fbr_run',
        createdAt: Date.now(),
        label: 'run',
        rowIds: ['r1'],
        status: 'running',
      },
    ]);
    expect(readStoryboardFeedbackRedrawHistory(assetId)[0]?.status).toBe('partial');
  });

  it('persists row preview images per batch', () => {
    const assetId = `test_asset_row_images_${Date.now()}`;
    writeStoryboardFeedbackRedrawHistory(assetId, [
      {
        id: 'fbr_img',
        createdAt: Date.now(),
        label: '12:00 · 2镜',
        rowIds: ['r1', 'r2'],
        status: 'done',
        rowImages: { r1: 'data:image/png;base64,aaa', r2: 'data:image/png;base64,bbb' },
      },
    ]);
    const loaded = readStoryboardFeedbackRedrawHistory(assetId)[0];
    expect(loaded?.rowImages?.r1).toBe('data:image/png;base64,aaa');
    expect(loaded?.rowImages?.r2).toBe('data:image/png;base64,bbb');
  });
});
