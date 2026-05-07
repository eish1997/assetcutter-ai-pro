import { describe, expect, it } from 'vitest';
import {
  createInitialVgpForAsset,
  isVgpBlockingDiscardForDisplayKey,
  pruneVgpAfterDiscard,
} from '../services/vgp/vgpStore';
import type { ImageVersion, VgpAssetExtension } from '../types/vgp';

function minimalAsset() {
  return { id: 'a1', createdAt: 1 } as const;
}

function addGenerated(
  vgp: VgpAssetExtension,
  params: { key: string; parentId: string | null; id: string; stepIndex: number }
): VgpAssetExtension {
  const semId = `sem_${params.id}`;
  const artId = `art_${params.id}`;
  const v: ImageVersion = {
    id: params.id,
    assetId: 'a1',
    parentVersionId: params.parentId,
    lineageRootId: vgp.originalVersionId ?? params.id,
    stepIndex: params.stepIndex,
    stepKey: params.key,
    role: 'generated',
    imageRef: { kind: 'result_key', key: params.key },
    semanticStateId: semId,
    promptArtifactId: artId,
    createdAt: 1,
  };
  return {
    ...vgp,
    versionsById: {
      ...vgp.versionsById,
      [params.id]: v,
    },
    versionOrder: [...vgp.versionOrder, params.id],
    semanticsById: {
      ...vgp.semanticsById,
      [semId]: {
        id: semId,
        schema_version: 'vgp-1',
        createdAt: 1,
        target: { summary: 't' },
        dimensions: {},
        locks: {},
        constraints: {},
        provenance: { kind: 'user' },
      },
    },
    promptsById: {
      ...vgp.promptsById,
      [artId]: {
        id: artId,
        schema_version: 'vgp-1',
        createdAt: 1,
        compiled_prompt: 'p',
        applied_rules: [],
        compiler_version: 'x',
      },
    },
    headVersionId: params.id,
  };
}

describe('vgp discard guards', () => {
  it('blocks original and group_preview', () => {
    const vgp = createInitialVgpForAsset(minimalAsset());
    expect(isVgpBlockingDiscardForDisplayKey(vgp, 'original')).toBe(true);
    expect(isVgpBlockingDiscardForDisplayKey(vgp, 'group_preview')).toBe(true);
  });

  it('blocks when a later version references parent', () => {
    let vgp = createInitialVgpForAsset(minimalAsset());
    const origId = vgp.versionOrder[0]!;
    vgp = addGenerated(vgp, { id: 'v1', key: 'gen_a', parentId: origId, stepIndex: 1 });
    vgp = addGenerated(vgp, { id: 'v2', key: 'gen_b', parentId: 'v1', stepIndex: 2 });
    expect(isVgpBlockingDiscardForDisplayKey(vgp, 'gen_a')).toBe(true);
    expect(isVgpBlockingDiscardForDisplayKey(vgp, 'gen_b')).toBe(false);
  });

  it('prunes leaf version and keeps parent', () => {
    let vgp = createInitialVgpForAsset(minimalAsset());
    const origId = vgp.versionOrder[0]!;
    vgp = addGenerated(vgp, { id: 'v1', key: 'gen_a', parentId: origId, stepIndex: 1 });
    vgp = addGenerated(vgp, { id: 'v2', key: 'gen_b', parentId: 'v1', stepIndex: 2 });
    const next = pruneVgpAfterDiscard(vgp, 'gen_b');
    expect(next).toBeDefined();
    expect(next!.versionOrder).not.toContain('v2');
    expect(next!.versionsById['v2']).toBeUndefined();
    expect(next!.versionsById['v1']).toBeDefined();
    expect(isVgpBlockingDiscardForDisplayKey(next!, 'gen_a')).toBe(false);
  });
});
