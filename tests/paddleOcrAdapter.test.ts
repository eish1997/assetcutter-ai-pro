import { describe, expect, it } from 'vitest';

import { resolvePaddleOcrKeys } from '../local-companion/src/compute/paddleOcrAdapter';

describe('resolvePaddleOcrKeys', () => {
  it('requires projectId and keys', () => {
    expect(resolvePaddleOcrKeys(undefined, {}, {})).toMatchObject({
      code: 'COMPUTE_BAD_JOB',
    });
    expect(resolvePaddleOcrKeys('p1', { fileKey: 'a.png' }, {})).toMatchObject({
      code: 'COMPUTE_BAD_JOB',
    });
  });

  it('defaults to pp_ocr_v5 json', () => {
    const r = resolvePaddleOcrKeys(
      'proj',
      { fileKey: 'upload-x.png', outputKey: 'ocr-out.json' },
      {},
    );
    expect(r).toMatchObject({
      ok: {
        fileKey: 'upload-x.png',
        outputKey: 'ocr-out.json',
        pipeline: 'pp_ocr_v5',
        lang: 'ch',
        returnFormat: 'json',
      },
    });
  });

  it('accepts imageKey alias', () => {
    const r = resolvePaddleOcrKeys(
      'proj',
      { imageKey: 'img-a.jpg', outputKey: 'ocr-out.json' },
      { pipeline: 'pp_ocr_v5' },
    );
    expect('ok' in r && r.ok.fileKey).toBe('img-a.jpg');
  });

  it('rejects asset keys with path separators', () => {
    expect(
      resolvePaddleOcrKeys(
        'proj',
        { fileKey: 'ocr/out.png', outputKey: 'ocr-out.json' },
        {},
      ),
    ).toMatchObject({ code: 'COMPUTE_BAD_JOB' });
  });

  it('structure pipeline defaults returnFormat both and requires markdown key', () => {
    const bad = resolvePaddleOcrKeys(
      'proj',
      { fileKey: 'doc.pdf', outputKey: 'ocr-out.json' },
      { pipeline: 'pp_structure_v3' },
    );
    expect(bad).toMatchObject({ code: 'COMPUTE_BAD_JOB' });

    const ok = resolvePaddleOcrKeys(
      'proj',
      { fileKey: 'doc.pdf', outputKey: 'ocr-out.json', markdownOutputKey: 'ocr-out.md' },
      { pipeline: 'pp_structure_v3' },
    );
    expect(ok).toMatchObject({
      ok: {
        pipeline: 'pp_structure_v3',
        returnFormat: 'both',
        markdownOutputKey: 'ocr-out.md',
      },
    });
  });

  it('rejects unknown pipeline', () => {
    expect(
      resolvePaddleOcrKeys(
        'proj',
        { fileKey: 'a.png', outputKey: 'b.json' },
        { pipeline: 'unknown' },
      ),
    ).toMatchObject({ code: 'COMPUTE_BAD_JOB' });
  });
});
