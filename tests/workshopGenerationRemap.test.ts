import { describe, expect, it, vi } from 'vitest';
import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import {
  isWorkshopBatchEligible,
  mergeWorkshopCanvasItems,
  optimisticWorkshopPackageItem,
  remapGenerationBatchToWorkshop,
  workshopTitleFromAsset,
} from '../services/workshopGenerationRemap';
import type { CustomAppModule } from '../types';

describe('workshopGenerationRemap', () => {
  it('derives title from asset text fields', () => {
    expect(workshopTitleFromAsset({ id: 'a', textBody: '一只猫', original: '', displayKey: 'original', results: {}, resultOrder: [], archived: false, hiddenInGrid: false })).toBe('一只猫');
    expect(workshopTitleFromAsset({ id: 'a', textTitle: '标题', original: '', displayKey: 'original', results: {}, resultOrder: [], archived: false, hiddenInGrid: false })).toBe('标题');
  });

  it('detects image generation batches', () => {
    const mod: CustomAppModule = {
      id: 'preset_t2i',
      label: 'T2I',
      category: 'text_to_image',
      enabled: true,
      instruction: '',
      order: 0,
    };
    const assets: WorkflowAsset[] = [];
    const tasks: WorkflowPendingTask[] = [{ id: 't1', assetId: 'a1', actionType: 'preset_t2i', addedAt: 1 }];
    expect(isWorkshopBatchEligible(assets, tasks, [mod])).toBe(true);
  });

  it('remaps temp asset ids to wsfile checkout card ids', async () => {
    const createWorkshopPackage = vi.fn(async () => ({
      ok: true,
      assetId: 'abc12345',
      checkoutRel: 'generated.png',
    }));
    const asset: WorkflowAsset = {
      id: 'temp-1',
      original: '',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      textBody: '测试',
    };
    const task: WorkflowPendingTask = {
      id: 'task-1',
      assetId: 'temp-1',
      actionType: 'ac_internal_quick_compose_plain_t2i',
      addedAt: Date.now(),
    };
    const out = await remapGenerationBatchToWorkshop({
      api: { createWorkshopPackage },
      root: 'C:/workshop',
      parentRel: '',
      newAssets: [asset],
      newTasks: [task],
    });
    expect(out.ok).toBe(true);
    expect(out.createdPackages).toHaveLength(1);
    expect(out.tasks[0]?.assetId).toContain('wsfile:');
    expect(createWorkshopPackage).toHaveBeenCalledWith(
      expect.objectContaining({ root: 'C:/workshop', title: '测试' }),
    );
  });

  it('merges optimistic canvas items until disk list catches up', () => {
    const disk = [
      optimisticWorkshopPackageItem({ root: '/a', assetId: 'on-disk', title: '已有' }),
    ];
    const optimistic = [
      optimisticWorkshopPackageItem({ root: '/a', assetId: 'pending', title: '排队' }),
    ];
    const merged = mergeWorkshopCanvasItems(disk, optimistic);
    expect(merged).toHaveLength(2);
    const mergedAgain = mergeWorkshopCanvasItems(
      [
        ...disk,
        optimisticWorkshopPackageItem({ root: '/a', assetId: 'pending', title: '排队' }),
      ],
      optimistic,
    );
    expect(mergedAgain).toHaveLength(2);
  });
});
