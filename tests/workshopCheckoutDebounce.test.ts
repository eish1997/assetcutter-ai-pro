import { describe, expect, it } from 'vitest';
import { workshopDisplayNeedsApply } from '../services/workshopCheckoutDebounce';

describe('workshopDisplayNeedsApply', () => {
  it('is true only when face and checkout are both set and differ', () => {
    expect(workshopDisplayNeedsApply('a', 'b')).toBe(true);
    expect(workshopDisplayNeedsApply('a', 'a')).toBe(false);
    expect(workshopDisplayNeedsApply('', 'b')).toBe(false);
    expect(workshopDisplayNeedsApply('a', '')).toBe(false);
  });
});
