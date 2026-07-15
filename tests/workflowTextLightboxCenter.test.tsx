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

  it('shows structure statistics and triggers downloads', () => {
    render(
      <WorkflowTextLightboxCenter
        resetKey="a:original"
        title="Brief"
        body={'First line\n\nSecond line'}
        onPersist={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('结构'));
    expect(screen.getByText('段落')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('TXT'));
    fireEvent.click(screen.getByText('MD'));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
