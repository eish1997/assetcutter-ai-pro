// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import QuickComposeChatDock from '../components/workflow/quickComposeChat/QuickComposeChatDock';
import type { AgentSkill } from '../types/projectAgent';

afterEach(() => {
  cleanup();
});

function renderDock(
  overrides: Partial<React.ComponentProps<typeof QuickComposeChatDock>> = {}
) {
  return render(
    <QuickComposeChatDock
      title="Project Agent"
      messages={[]}
      segments={[]}
      onSegmentsChange={() => {}}
      mentionCandidates={[]}
      maxMentions={4}
      mainDropSlots={[]}
      referenceDropSlots={[]}
      onRemoveMainDropSlot={() => {}}
      onRemoveReferenceDropSlot={() => {}}
      onSubmit={() => {}}
      {...overrides}
    />
  );
}

async function openSkillPanel(container: HTMLElement) {
  const user = userEvent.setup();
  await user.click(container.querySelector('button[aria-haspopup="menu"]') as HTMLElement);
  await user.click(screen.getByRole('menuitem', { name: 'Skill 管理' }));
  return user;
}

describe('QuickComposeChatDock Skill Registry', () => {
  it('shows runtime perception context chips', () => {
    renderDock({
      perceptionContext: {
        visibleSummary: 'Project: Launch | Selected 5 assets | Maya disconnected',
        targetSummary: 'Selected 5 assets',
        workflowSummary: 'Plan: maya-export | 1/2 steps done | Blocked: connector',
        externalSummary: 'Maya: disconnected | selection unknown',
        riskSummary: 'Context may be stale',
        stale: true,
      },
    });

    expect(screen.getByText('Selected 5 assets')).toBeTruthy();
    expect(screen.getByText(/maya-export/)).toBeTruthy();
    expect(screen.getByText(/Maya: disconnected/)).toBeTruthy();
    expect(screen.getAllByText('Context may be stale').length).toBeGreaterThan(0);
  });

  it('opens Skill management and supports sample install plus import preview', async () => {
    const { container } = renderDock();
    const user = await openSkillPanel(container);

    expect(screen.getByRole('dialog', { name: 'Skill 管理' })).toBeTruthy();
    expect(screen.getByText('还没有已安装 Skill')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /安装示例 Skill/ }));
    expect(screen.getByText('Product Shot Polish')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '禁用' }));
    expect(screen.getByRole('button', { name: '启用' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /导入预览/ }));
    expect(screen.getByText('导入预览已保留')).toBeTruthy();
  });

  it('calls parent hooks for registry actions', async () => {
    const skillEntries: AgentSkill[] = [
      {
        id: 'brand-check',
        name: 'Brand Check',
        description: 'Check a draft against project brand rules.',
        triggers: ['check brand rules'],
        toolIds: ['run_plain_text'],
        permissionLevel: 'light',
        enabled: true,
        source: 'local',
        createdAt: 1,
      },
    ];
    const onOpenPanel = vi.fn();
    const onToggleSkill = vi.fn();
    const onDeleteSkill = vi.fn();
    const onInstallSampleSkill = vi.fn();
    const onImportSkillPreview = vi.fn();

    const { container } = renderDock({
      skillEntries,
      onOpenPanel,
      onToggleSkill,
      onDeleteSkill,
      onInstallSampleSkill,
      onImportSkillPreview,
    });

    const user = await openSkillPanel(container);
    expect(onOpenPanel).toHaveBeenCalledWith('skills');
    expect(screen.getByText('本地')).toBeTruthy();
    expect(screen.getByText('轻确认')).toBeTruthy();
    expect(screen.getByText(/白名单工具：run_plain_text/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /安装示例 Skill/ }));
    await user.click(screen.getByRole('button', { name: /导入预览/ }));
    await user.click(screen.getByRole('button', { name: '禁用' }));
    await user.click(screen.getByRole('button', { name: /删除/ }));

    expect(onInstallSampleSkill).toHaveBeenCalledTimes(1);
    expect(onImportSkillPreview).toHaveBeenCalledTimes(1);
    expect(onToggleSkill).toHaveBeenCalledWith('brand-check', false);
    expect(onDeleteSkill).toHaveBeenCalledWith('brand-check');
  });
});
