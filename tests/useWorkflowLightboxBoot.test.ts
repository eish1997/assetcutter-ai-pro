// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useWorkflowLightboxBoot } from '../hooks/useWorkflowLightboxBoot';

describe('useWorkflowLightboxBoot', () => {
  it('opens at t3 so chrome insets apply on the first overlay frame', () => {
    const { result } = renderHook(() => useWorkflowLightboxBoot());
    expect(result.current.phase).toBeNull();
    expect(result.current.isChromeReady).toBe(false);

    act(() => {
      result.current.beginOpen();
    });

    expect(result.current.phase).toBe('t3');
    expect(result.current.isChromeReady).toBe(true);
  });

  it('reset clears the open phase', () => {
    const { result } = renderHook(() => useWorkflowLightboxBoot());
    act(() => {
      result.current.beginOpen();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.phase).toBeNull();
    expect(result.current.isChromeReady).toBe(false);
  });
});
