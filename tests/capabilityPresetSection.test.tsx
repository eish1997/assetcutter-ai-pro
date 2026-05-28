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

describe('CapabilityPresetSection: add preset with companionHostBundle', () => {
  it('点击新增并填写宿主包目录后，会通过 onUpdate 写出 companionHostBundle', async () => {
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
    await user.type(
      screen.getByPlaceholderText('如：转赛博朋克风格、生成多视角、写实化'),
      '宿主包能力'
    );
    await user.click(screen.getByText('高级：本机扩展包（可选，一般留空）'));
    await user.type(
      screen.getByPlaceholderText('与设置页「已安装扩展包」列表中的名称一致'),
      'demo-host-bundle'
    );
    await user.click(screen.getByRole('button', { name: '添加' }));

    expect(onUpdate).toHaveBeenCalled();
    const lastCallArg = onUpdate.mock.calls.at(-1)?.[0] as CustomAppModule[] | undefined;
    expect(Array.isArray(lastCallArg)).toBe(true);
    const added = (lastCallArg ?? []).find((p) => p.label === '宿主包能力');
    expect(added).toBeTruthy();
    expect(added?.companionHostBundle).toEqual({ dirName: 'demo-host-bundle' });
    // 组件 onUpdate 返回编辑态数据，engine 归一化由 saveCapabilityPresets 负责
    expect(added?.engine).toBe('gen_image');
  });
});

