import { describe, expect, it } from 'vitest';
import { parseContentDispositionFilename } from '../services/companionClient/storage';

describe('companionClient storage download', () => {
  it('parseContentDispositionFilename reads quoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename="model.glb"')).toBe('model.glb');
  });

  it('parseContentDispositionFilename reads filename*', () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''model%2Efbx")).toBe('model.fbx');
  });
});
