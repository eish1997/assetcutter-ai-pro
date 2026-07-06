import { describe, expect, it } from 'vitest';
import {
  stepDisplayKeyInOrder,
  stepDisplayKeyRepeated,
} from '../services/workflowAssetDisplayKeyCycle';

describe('stepDisplayKeyInOrder', () => {
  const keys = ['original', 'v1', 'v2', 'v3'];

  it('steps forward and backward', () => {
    expect(stepDisplayKeyInOrder(keys, 'original', 1)).toBe('v1');
    expect(stepDisplayKeyInOrder(keys, 'v1', -1)).toBe('original');
    expect(stepDisplayKeyInOrder(keys, 'original', -1)).toBe('v3');
    expect(stepDisplayKeyInOrder(keys, 'v3', 1)).toBe('original');
  });

  it('alternating Q/E returns to start when state is applied each step', () => {
    expect(stepDisplayKeyRepeated(keys, 'v2', [-1, 1])).toBe('v2');
    expect(stepDisplayKeyRepeated(keys, 'v2', [1, -1])).toBe('v2');
  });

  it('rapid same-direction presses advance one step per press', () => {
    expect(stepDisplayKeyRepeated(keys, 'v1', [-1, -1])).toBe('v3');
    expect(stepDisplayKeyRepeated(keys, 'v1', [1, 1])).toBe('v3');
  });
});
