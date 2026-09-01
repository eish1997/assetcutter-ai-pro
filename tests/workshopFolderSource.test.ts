import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  workshopFolderSourceOfTruthFromState,
  filterWorkbenchDocumentEvents,
  shouldSkipWorkshopAssetCommand,
  readDocumentSnapshotForFolderSource,
  compartmentAssetIdsFromSnapshot,
} = require('../companion-desktop/workshop-folder-source.cjs');

describe('workshop folder source of truth', () => {
  it('detects folder mode from host roots', () => {
    expect(workshopFolderSourceOfTruthFromState({ ok: true, roots: [] })).toBe(false);
    expect(workshopFolderSourceOfTruthFromState({ ok: true, roots: [{ root: 'C:/a' }] })).toBe(true);
  });

  it('filters workbench events to finger-only in folder mode', () => {
    const events = [
      { type: 'finger.changed', finger: { selectedRoot: 'C:/a' } },
      { type: 'asset.upsert', payload: { id: 'x', compartment: 'workshop' } },
    ];
    expect(filterWorkbenchDocumentEvents(events, true)).toEqual([events[0]]);
    expect(filterWorkbenchDocumentEvents(events, false)).toEqual(events);
  });

  it('skips workshop asset commands when folder is source of truth', () => {
    expect(shouldSkipWorkshopAssetCommand({ type: 'upsert_asset', payload: { id: 'a' } }, true)).toBe(true);
    expect(
      shouldSkipWorkshopAssetCommand({ type: 'upsert_asset', payload: { id: 'a', compartment: 'workflow' } }, true),
    ).toBe(false);
    expect(shouldSkipWorkshopAssetCommand({ type: 'set_finger', finger: {} }, true)).toBe(false);
  });

  it('readDocumentSnapshotForFolderSource clears workshop cards but keeps other compartments', () => {
    const out = readDocumentSnapshotForFolderSource({
      finger: { selectedRoot: 'C:/work', selectedRelPath: 'sub' },
      assetIds: ['ghost'],
      assets: { ghost: { id: 'ghost' } },
      compartments: {
        workshop: { assetIds: ['ghost'] },
        workflow: { assetIds: ['wf1'] },
        tools: { assetIds: [] },
        rooms: {},
      },
    });
    expect(out.workshopFolderSource).toBe(true);
    expect(out.assetIds).toEqual([]);
    expect(out.compartments.workshop.assetIds).toEqual([]);
    expect(out.compartments.workflow.assetIds).toEqual(['wf1']);
  });

  it('compartmentAssetIdsFromSnapshot respects folder source flag', () => {
    const snap = { workshopFolderSource: true, compartments: { workshop: { assetIds: ['x'] } } };
    expect(compartmentAssetIdsFromSnapshot(snap, 'workshop')).toEqual([]);
    expect(compartmentAssetIdsFromSnapshot(snap, 'workflow')).toEqual([]);
  });
});

describe('folder mode guards in web and shell', () => {
  it('App skips hydrate when workbenchFolderMode', () => {
    const app = fs.readFileSync(path.resolve(process.cwd(), 'App.tsx'), 'utf8');
    expect(app).toContain('workbenchFolderMode');
    expect(app).toMatch(/if \(workbenchFolderMode\) return;/);
  });

  it('App locks workflow canvas height for folder mode without a project id', () => {
    const app = fs.readFileSync(path.resolve(process.cwd(), 'App.tsx'), 'utf8');
    expect(app).toMatch(/mode === AppMode\.WORKFLOW && showWorkflowCanvas/);
    expect(app).not.toMatch(/mode === AppMode\.WORKFLOW && activeWorkspaceProjectId\s*\n\s*\? 'flex flex-col overflow-hidden/);
  });

  it('main.cjs forwards finger-only document events in folder mode', () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    expect(main).toContain('filterWorkbenchDocumentEvents');
    expect(main).toContain('skippedAssets: true');
  });

  it('dsh context uses folder line when workshopFolderSource', () => {
    const inject = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/dsh-context-inject.cjs'), 'utf8');
    expect(inject).toContain('workshop=folder:');
  });

  it('dsh workspace_read_document clears workshop cards in folder mode', () => {
    const { createDshWorkspaceTools } = require('../companion-desktop/dsh-workspace-tool.cjs');
    const tools = createDshWorkspaceTools({
      getSnapshot: () => ({
        assetIds: ['ghost'],
        assets: { ghost: { id: 'ghost' } },
        finger: { selectedRoot: 'C:/work' },
        compartments: { workshop: { assetIds: ['ghost'] }, workflow: { assetIds: ['wf'] }, tools: { assetIds: [] }, rooms: {} },
      }),
      isWorkshopFolderSourceOfTruth: () => true,
    });
    const doc = tools.workspace_read_document();
    expect(doc.workshopFolderSource).toBe(true);
    expect(doc.assetIds).toEqual([]);
    expect(doc.compartments.workflow.assetIds).toEqual(['wf']);
  });
});
