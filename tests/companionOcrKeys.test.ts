import { describe, expect, it } from 'vitest';

import { companionOcrAssetKey, isCompanionSafeAssetKey } from '../services/companionOcrKeys';

describe('companionOcrAssetKey', () => {
  it('generates single-segment keys without slashes', () => {
    const key = companionOcrAssetKey('img', 1710000000000, 'story board.png');
    expect(key).not.toContain('/');
    expect(isCompanionSafeAssetKey(key)).toBe(true);
  });

  it('rejects legacy slash keys', () => {
    expect(isCompanionSafeAssetKey('ocr/image-1-test.json')).toBe(false);
  });
});
