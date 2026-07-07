import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomAppModule } from '../types';
import {
  isPlatformAiSubmitBlocked,
  isProxyCreditsBlockedLocally,
  resolveQuickComposeProxyJobKind,
} from '../services/proxyCreditsGate';

describe('resolveQuickComposeProxyJobKind', () => {
  const mod3d = { id: 'm3d', category: 'generate_3d' } as CustomAppModule;
  const modImg = { id: 'img', category: 'text_to_image' } as CustomAppModule;

  it('maps plain compose modes', () => {
    expect(
      resolveQuickComposeProxyJobKind({
        mode: 'image',
        promptCards: [],
        resolveModule: () => null,
      })
    ).toBe('workflow_text_to_image');
  });

  it('uses highest threshold among prompt cards', () => {
    expect(
      resolveQuickComposeProxyJobKind({
        mode: 'image',
        promptCards: [{ presetId: 'img' }, { presetId: 'm3d' }],
        resolveModule: (id) => (id === 'm3d' ? mod3d : modImg),
      })
    ).toBe('workflow_generate_3d');
  });
});

describe('isPlatformAiSubmitBlocked', () => {
  it('requires login', () => {
    expect(isPlatformAiSubmitBlocked(null, 999, false, 'workflow_text_to_image').blocked).toBe(true);
  });

  it('blocks logged-in user with insufficient balance', () => {
    expect(isPlatformAiSubmitBlocked('u1', 0, false, 'workflow_text_to_image').blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked('u1', 133, false, 'workflow_text_to_image').blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked('u1', 134, false, 'workflow_text_to_image').blocked).toBe(false);
  });

  it('isProxyCreditsBlockedLocally alias matches', () => {
    expect(isProxyCreditsBlockedLocally(0, false, 'u1', 'workflow_text_to_image')).toBe(true);
  });
});
