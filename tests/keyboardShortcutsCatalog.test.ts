import { describe, expect, it } from 'vitest';
import {
  getKeyboardShortcutsPage,
  resolveKeyboardShortcutsPage,
} from '../services/keyboardShortcutsCatalog';

describe('resolveKeyboardShortcutsPage', () => {
  it('maps workflow modes to project list vs canvas', () => {
    expect(
      resolveKeyboardShortcutsPage({ mode: 'WORKFLOW', activeWorkspaceProjectId: null })
    ).toBe('workflow-project-list');
    expect(
      resolveKeyboardShortcutsPage({ mode: 'WORKFLOW', activeWorkspaceProjectId: 'p1' })
    ).toBe('workflow-canvas');
  });

  it('prefers lightbox annotate when flags are set', () => {
    expect(
      resolveKeyboardShortcutsPage(
        { mode: 'WORKFLOW', activeWorkspaceProjectId: 'p1' },
        { lightboxOpen: true, lightboxRaster: true }
      )
    ).toBe('workflow-lightbox-annotate');
    expect(
      resolveKeyboardShortcutsPage(
        { mode: 'WORKFLOW', activeWorkspaceProjectId: 'p1' },
        { lightboxOpen: true, lightboxRaster: false }
      )
    ).toBe('workflow-lightbox');
  });
});

describe('getKeyboardShortcutsPage', () => {
  it('includes workflow canvas shortcuts', () => {
    const page = getKeyboardShortcutsPage('workflow-canvas');
    expect(page.title).toBe('工作区');
    expect(page.sections.some((s) => s.title === '工作区画布')).toBe(true);
  });
});
