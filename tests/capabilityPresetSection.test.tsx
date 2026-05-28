// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CustomAppModule } from '../types';
import CapabilityPresetSection from '../components/CapabilityPresetSection';

vi.mock('../services/storePackHistory', () => ({
  loadInstalledPacks: () => [],
  loadPackHistory: () => [],
}));

vi.mock('../services/storeCatalogHook', () => ({
  shouldRunStoreCatalogAutoSync: () => false,
  useStoreCatalog: () => ({
    catalog: [],
    loading: false,
    error: '',
    refresh: async () => {},
    installPresets: async () => {},
    installingAll: false,
    packContentsLoading: false,
    remotePresetItems: [],
  }),
}));

vi.mock('../services/capabilityPresetR2Publish', () => ({
  publishPresetToUserR2Catalog: async () => ({ ok: true }),
}));

describe('CapabilityPresetSection: image_process host_bundle', () => {
  it('图生图/文生图表单不再出现「高级扩展包」；扩展包仅经图像处理 → 本机扩展包', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const basePresets: CustomAppModule[] = [
      {
        id: 'base-1',
        label: '基础能力',
        category: 'image_to_image',
        engine: 'gen_image',
        instruction: 'base',
        enabled: true,
        order: 0,
      },
    ];

    render(<CapabilityPresetSection presets={basePresets} onUpdate={onUpdate} />);

    await user.click(screen.getByRole('button', { name: '新增能力' }));
    expect(screen.queryByText('高级：本机扩展包（可选，一般留空）')).toBeNull();

    const categoryButtons = screen.getAllByRole('button', { name: '图像处理' });
    const addFormCategory = categoryButtons.find((el) =>
      el.getAttribute('title')?.includes('内置切割')
    );
    expect(addFormCategory).toBeTruthy();
    await user.click(addFormCategory!);
    await user.type(screen.getByPlaceholderText('如：拆分组件、切割图片、提取主体'), '扩展包能力');
    await user.click(screen.getByRole('button', { name: /拆分组件/ }));
    await user.click(screen.getByRole('button', { name: /提交已安装扩展包 run\.json/ }));
    await user.type(
      screen.getByPlaceholderText('与设置页「已安装扩展包」列表中的名称一致'),
      'demo-host-bundle'
    );
    await user.click(screen.getByRole('button', { name: '添加' }));

    expect(onUpdate).toHaveBeenCalled();
    const lastCallArg = onUpdate.mock.calls.at(-1)?.[0] as CustomAppModule[] | undefined;
    const added = (lastCallArg ?? []).find((p) => p.label === '扩展包能力');
    expect(added).toBeTruthy();
    expect(added?.category).toBe('image_process');
    expect(added?.engine).toBe('builtin');
    expect(added?.processor).toBe('host_bundle');
    expect(added?.companionHostBundle).toEqual({ dirName: 'demo-host-bundle' });
  });
});
