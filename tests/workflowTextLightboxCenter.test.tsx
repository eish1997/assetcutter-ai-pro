// @vitest-environment jsdom

import React, { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkflowTextLightboxCenter, {
  type WorkflowTextLightboxCenterHandle,
} from '../components/workflow/WorkflowTextLightboxCenter';

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn() },
});

URL.createObjectURL = vi.fn(() => 'blob:download');
URL.revokeObjectURL = vi.fn();

describe('WorkflowTextLightboxCenter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders read mode and copies full text', () => {
    const onAddToComposeInput = vi.fn();
    render(
      <WorkflowTextLightboxCenter
        resetKey="a:original"
        title="Brief"
        body="Line one"
        onPersist={vi.fn()}
        onAddToComposeInput={onAddToComposeInput}
      />
    );

    expect(screen.getByText('Brief')).toBeTruthy();
    expect(screen.getByText('Line one')).toBeTruthy();

    fireEvent.click(screen.getByText('复制全文'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Brief\n\nLine one');

    fireEvent.click(screen.getByText('加入输入框'));
    expect(onAddToComposeInput).toHaveBeenCalledWith('Brief\n\nLine one');
  });

  it('persists edited body through imperative flush', () => {
    const ref = createRef<WorkflowTextLightboxCenterHandle>();
    const onPersist = vi.fn();
    render(
      <WorkflowTextLightboxCenter
        ref={ref}
        resetKey="a:original"
        title="Brief"
        body="Before"
        onPersist={onPersist}
      />
    );

    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'After' } });
    ref.current?.flush();

    expect(onPersist).toHaveBeenCalledWith({ textTitle: 'Brief', textBody: 'After' });
  });

  it('exports via dropdown and has no structure mode', () => {
    render(
      <WorkflowTextLightboxCenter
        resetKey="a:original"
        title="Brief"
        body={'First line\n\nSecond line'}
        onPersist={vi.fn()}
      />
    );

    expect(screen.queryByText('结构')).toBeNull();
    expect(screen.queryByLabelText('文本统计')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: 'TXT' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: 'MD' }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('empty read mode offers a write prompt that enters edit', () => {
    render(
      <WorkflowTextLightboxCenter
        resetKey="a:original"
        title="Brief"
        body="   "
        onPersist={vi.fn()}
      />
    );

    expect(screen.queryByText('空白文本')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '点这里开始写' }));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});
