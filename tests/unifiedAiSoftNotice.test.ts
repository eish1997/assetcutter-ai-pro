/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AC_UNIFIED_AI_SOFT_NOTICE_EVENT,
  clipUnifiedAiNoticeMessage,
  dispatchUnifiedAiSoftNotice,
} from '../services/unifiedAiSoftNotice';

describe('unifiedAiSoftNotice', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clipUnifiedAiNoticeMessage', () => {
    expect(clipUnifiedAiNoticeMessage('  a  b  c  ', 4)).toBe('a b …');
  });

  it('dispatchUnifiedAiSoftNotice：同 kind 节流、异 kind 独立、时间窗后可再发', () => {
    const spy = vi.fn();
    window.addEventListener(AC_UNIFIED_AI_SOFT_NOTICE_EVENT, spy);
    dispatchUnifiedAiSoftNotice({ kind: 'rate_limit', message: 'one' });
    dispatchUnifiedAiSoftNotice({ kind: 'rate_limit', message: 'two' });
    expect(spy).toHaveBeenCalledTimes(1);
    dispatchUnifiedAiSoftNotice({ kind: 'upstream_busy', message: 'busy' });
    expect(spy).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockReturnValue(1_000_000_000 + 15_000);
    dispatchUnifiedAiSoftNotice({ kind: 'rate_limit', message: 'three' });
    expect(spy).toHaveBeenCalledTimes(3);
    window.removeEventListener(AC_UNIFIED_AI_SOFT_NOTICE_EVENT, spy);
  });
});
