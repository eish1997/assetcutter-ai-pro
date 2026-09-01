import { describe, expect, it } from 'vitest';
import { scanHealthStale, scanPromotions } from '../local-companion/src/capabilities/hostPrimitiveScanner.ts';

describe('hostPrimitiveScanner', () => {
  it('scanPromotions returns numeric result without throwing', () => {
    const result = scanPromotions();
    expect(result).toEqual(expect.objectContaining({ promoted: expect.any(Number) }));
  });

  it('scanHealthStale writes pending list shape', () => {
    const result = scanHealthStale();
    expect(result).toEqual(expect.objectContaining({ pending: expect.any(Number) }));
  });
});
