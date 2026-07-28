import { describe, expect, it } from 'vitest';
import {
  allocateWorkflowResultVersionKey,
  assetHasResultVersionForBase,
  baseActionId,
  makeVersionKey,
  RESULT_VER_SEP,
  stripResultKeyToBaseActionId,
} from '../components/workflow/workflowIds';

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

  it('strips __v__ for lightbox write-back base ids', () => {
    const base = 'ac_internal_lightbox_resize_writeback';
    const k = makeVersionKey(base);
    expect(stripResultKeyToBaseActionId(k)).toBe(base);
  });
});

describe('allocateWorkflowResultVersionKey', () => {
  it('uses bare id for first 3D slot then versions on rerun', () => {
    const empty = { resultOrder: [] as string[] };
    expect(allocateWorkflowResultVersionKey(empty, 'generate_3d')).toBe('generate_3d');
    const withFirst = {
      resultOrder: ['generate_3d'],
      stepModelCompanionKeys: { generate_3d: ['k1'] },
    };
    expect(assetHasResultVersionForBase(withFirst, 'generate_3d')).toBe(true);
    const second = allocateWorkflowResultVersionKey(withFirst, 'generate_3d');
    expect(second.startsWith(`generate_3d${RESULT_VER_SEP}`)).toBe(true);
    expect(baseActionId(second)).toBe('generate_3d');
  });
});
