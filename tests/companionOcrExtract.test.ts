import { describe, expect, it } from 'vitest';

import { extractCompanionOcrBlocks, type CompanionOcrJsonResultV1 } from '../services/companionOcr';

describe('extractCompanionOcrBlocks', () => {
  const base: Omit<CompanionOcrJsonResultV1, 'result'> = {
    pipeline: 'pp_ocr_v5',
    lang: 'ch',
    fileKey: 'a.png',
  };

  it('reads normalized blocks', () => {
    const blocks = extractCompanionOcrBlocks({
      ...base,
      result: { blocks: [{ text: '镜号 1', score: 0.9 }] },
    });
    expect(blocks).toEqual([{ text: '镜号 1', score: 0.9 }]);
  });

  it('reads rec_texts on result object', () => {
    const blocks = extractCompanionOcrBlocks({
      ...base,
      result: { rec_texts: ['Hello', 'World'] },
    });
    expect(blocks.map((b) => b.text)).toEqual(['Hello', 'World']);
  });

  it('reads predict() list payload with rec_texts', () => {
    const blocks = extractCompanionOcrBlocks({
      ...base,
      result: [{ rec_texts: ['分镜测试'] }] as unknown as CompanionOcrJsonResultV1['result'],
    });
    expect(blocks.map((b) => b.text)).toEqual(['分镜测试']);
  });
});
