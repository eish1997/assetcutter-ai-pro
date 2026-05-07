import { describe, expect, it } from 'vitest';
import { baseActionId, makeVersionKey, stripResultKeyToBaseActionId } from '../components/workflow/workflowIds';

describe('stripResultKeyToBaseActionId', () => {
  it('matches baseActionId for __v__ keys', () => {
    const base = 'ac_internal_quick_compose_plain_i2i';
    const k = makeVersionKey(base);
    expect(stripResultKeyToBaseActionId(k)).toBe(baseActionId(k));
    expect(stripResultKeyToBaseActionId(k)).toBe(base);
  });

  it('strips legacy _v_<suffix> suffix', () => {
    expect(stripResultKeyToBaseActionId('ac_internal_quick_compose_plain_i2i_v_mov64bye')).toBe(
      'ac_internal_quick_compose_plain_i2i'
    );
  });

  it('leaves plain capability ids unchanged', () => {
    expect(stripResultKeyToBaseActionId('cut_image')).toBe('cut_image');
  });
});
