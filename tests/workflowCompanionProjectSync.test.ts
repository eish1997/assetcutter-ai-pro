import { describe, expect, it } from 'vitest';
import { preferCompanionWorkflowBundle } from '../services/workflowCompanionProjectSync';
import type { WorkflowAsset } from '../types';

const asset = (id: string): WorkflowAsset => ({
  id,
  original: '',
  displayKey: 'original',
  results: {},
  resultOrder: [],
  archived: false,
  hiddenInGrid: false,
  createdAt: 1,
});

describe('preferCompanionWorkflowBundle', () => {
  it('prefers companion snapshot when it has assets', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('local')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 2,
        bundle: { assets: [asset('companion')], pending: [] },
      },
    });
    expect(out?.assets[0]?.id).toBe('companion');
  });

  it('keeps local when companion snapshot is empty', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('local')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 2,
        bundle: { assets: [], pending: [] },
      },
    });
    expect(out?.assets[0]?.id).toBe('local');
  });

  it('does not wipe local assets when companion is pending-only', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('local'), asset('local-2')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: Date.now(),
        bundle: {
          assets: [],
          pending: [{ id: 't1', status: 'queued' } as never],
        },
      },
    });
    expect(out?.assets.map((a) => a.id)).toEqual(['local', 'local-2']);
  });

  it('keeps richer local when companion has fewer assets and is not newer', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('a'), asset('b')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 10,
        bundle: { assets: [asset('stale')], pending: [] },
      },
      localUpdatedAt: 20,
    });
    expect(out?.assets.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('accepts fewer companion assets only when companion updatedAt is newer', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('a'), asset('b')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 30,
        bundle: { assets: [asset('newer')], pending: [] },
      },
      localUpdatedAt: 10,
    });
    expect(out?.assets.map((a) => a.id)).toEqual(['newer']);
  });

  it('does not resurrect deleted assets from a richer but stale companion snapshot', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('kept')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 10,
        bundle: {
          assets: [asset('kept'), asset('deleted-tex-1'), asset('deleted-tex-2')],
          pending: [],
        },
      },
      localUpdatedAt: 20,
    });
    expect(out?.assets.map((a) => a.id)).toEqual(['kept']);
  });

  it('keeps local after delete when companion is richer and localUpdatedAt is missing', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('kept')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 99,
        bundle: {
          assets: [asset('kept'), asset('stale-tex')],
          pending: [],
        },
      },
    });
    expect(out?.assets.map((a) => a.id)).toEqual(['kept']);
  });

  it('accepts richer companion when companion updatedAt is strictly newer', () => {
    const out = preferCompanionWorkflowBundle({
      local: { assets: [asset('kept')], pending: [] },
      companion: {
        schemaVersion: 1,
        projectId: 'p1',
        updatedAt: 50,
        bundle: {
          assets: [asset('kept'), asset('from-other-device')],
          pending: [],
        },
      },
      localUpdatedAt: 20,
    });
    expect(out?.assets.map((a) => a.id)).toEqual(['kept', 'from-other-device']);
  });
});
