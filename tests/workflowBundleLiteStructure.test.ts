import { describe, expect, it } from 'vitest';
import {
  computeLiteStructureLocalFingerprint,
  mergeLiteStructurePreservingCloudObjectKeys,
  stripInlineMediaFromWorkflowBundleForLiteSync,
} from '../services/workflowBundleLiteStructure';

describe('workflowBundleLiteStructure', () => {
  it('strips data URL original when no object key', () => {
    const { assets } = stripInlineMediaFromWorkflowBundleForLiteSync({
      assets: [
        {
          id: 'a1',
          original: 'data:image/png;base64,AAAA',
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: 1,
        },
      ],
      pending: [],
    });
    expect(assets[0].original).toBe('');
  });

  it('preserves originalObjectKey and strips inline original', () => {
    const { assets } = stripInlineMediaFromWorkflowBundleForLiteSync({
      assets: [
        {
          id: 'a1',
          original: 'data:image/png;base64,BBBB',
          originalObjectKey: 'users/x/w/p/a1/original.png',
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: 1,
        },
      ],
      pending: [],
    });
    expect(assets[0].originalObjectKey).toBe('users/x/w/p/a1/original.png');
    expect(assets[0].original).toBe('');
  });

  it('merges cloud object keys when local stripped dropped them', () => {
    const prev = {
      assets: [
        {
          id: 'a1',
          original: '',
          originalObjectKey: 'k/orig.png',
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: 1,
        },
      ],
      pending: [],
    };
    const stripped = {
      assets: [
        {
          id: 'a1',
          original: '',
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: 1,
        },
      ],
      pending: [],
    };
    const merged = mergeLiteStructurePreservingCloudObjectKeys(prev, stripped);
    expect(merged.assets[0].originalObjectKey).toBe('k/orig.png');
  });

  it('computeLiteStructureLocalFingerprint is stable for identical bundle', () => {
    const bundle = {
      assets: [
        {
          id: 'a1',
          original: '',
          displayKey: 'original' as const,
          results: { s1: 'data:image/png;base64,QQ' },
          resultOrder: ['s1'],
          archived: false,
          hiddenInGrid: false,
          createdAt: 1,
        },
      ],
      pending: [],
    };
    expect(computeLiteStructureLocalFingerprint(bundle)).toBe(computeLiteStructureLocalFingerprint(bundle));
  });
});
