import { describe, expect, it } from 'vitest';

import {
  clearWorkflowModelViewerUiSticky,
  peekWorkflowModelViewerUiSticky,
  rememberWorkflowModelViewerUiSticky,
} from '../services/workflowModelViewerUiSticky';

describe('workflowModelViewerUiSticky', () => {
  it('remembers ready UI for the same loadKey', () => {
    clearWorkflowModelViewerUiSticky();
    rememberWorkflowModelViewerUiSticky({
      loadKey: 'asset::a::original::m',
      status: 'ready',
      materialSlots: [{ id: 'mat0', label: 'Body' }],
      activeMaterialId: 'mat0',
      pbrDoc: null,
    });
    const hit = peekWorkflowModelViewerUiSticky('asset::a::original::m');
    expect(hit?.status).toBe('ready');
    expect(hit?.activeMaterialId).toBe('mat0');
    expect(peekWorkflowModelViewerUiSticky('other')).toBeNull();
    clearWorkflowModelViewerUiSticky('asset::a::original::m');
    expect(peekWorkflowModelViewerUiSticky('asset::a::original::m')).toBeNull();
  });
});
