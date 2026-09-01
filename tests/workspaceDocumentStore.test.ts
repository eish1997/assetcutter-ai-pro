import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorkspaceDocumentStore, workspaceEventsForCompartment } = require('../companion-desktop/workspace-document-store.cjs') as {
  createWorkspaceDocumentStore: (opts?: { initial?: unknown }) => {
    dispatch: (command: Record<string, unknown>) => {
      assetIds: string[];
      finger: { selectedAssetId: string | null };
      assets?: Record<string, { textBody?: string; compartment?: string }>;
      compartments: { workshop: { assetIds: string[] }; workflow: { assetIds: string[] }; tools: { assetIds: string[] }; rooms: Record<string, { assetIds: string[] }> };
    };
    applyEvents: (events: unknown[]) => unknown;
    hydrate: (payload: { projectId?: string; assets?: unknown[] }) => {
      projectId: string;
      assetIds: string[];
      assets: Record<string, unknown>;
      compartments: { workshop: { assetIds: string[] }; workflow: { assetIds: string[] } };
    };
    subscribe: (fn: (events: unknown[]) => void) => () => void;
    getSnapshot: () => { assetIds: string[]; assets: Record<string, unknown>; projectId: string; finger: { selectedAssetId: string | null } };
    getEvents: () => Array<{ type: string; payload?: { textBody?: string; textResults?: Record<string, string> } }>;
  };
  workspaceEventsForCompartment: (events: unknown[], compartment: string) => unknown[];
};

describe('workspace document store', () => {
  it('dispatch append_text_result appends events and notifies subscribers', () => {
    const store = createWorkspaceDocumentStore();
    const seen: unknown[] = [];
    store.subscribe((events) => seen.push(events));
    const snap = store.dispatch({ type: 'append_text_result', text: 'hello' });
    expect(snap.assetIds.length).toBe(1);
    expect(seen.length).toBe(1);
    const upsert = store.getEvents().find((e) => e.type === 'asset.upsert');
    expect(upsert?.payload?.textBody).toBe('hello');
  });

  it('dual-write can still call bridgeAppend as a P5-003 transition', async () => {
    const { createDshWorkspaceTools } = require('../companion-desktop/dsh-workspace-tool.cjs');
    const bridged: unknown[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      writeMode: 'dual',
      bridgeAppend: async (command: unknown) => {
        bridged.push(command);
      },
    });
    await tools.workspace_dispatch({ type: 'append_text_result', text: 'x' });
    expect(bridged).toHaveLength(1);
  });

  it('set_finger updates selection without replacing connectedHosts', () => {
    const store = createWorkspaceDocumentStore();
    store.applyEvents([
      {
        type: 'finger.changed',
        finger: { connectedHosts: [{ id: 'maya', title: 'Maya', ready: true, canAcceptCurrentCard: true }] },
      },
    ]);
    store.dispatch({
      type: 'set_finger',
      finger: {
        selectedAssetId: 'card-1',
        connectedHosts: [{ id: 'hack', title: 'Hack', ready: true, canAcceptCurrentCard: true }],
      },
    });
    const snap = store.getSnapshot() as {
      finger: { selectedAssetId: string | null; connectedHosts: Array<{ id: string }> };
    };
    expect(snap.finger.selectedAssetId).toBe('card-1');
    expect(snap.finger.connectedHosts).toEqual([{ id: 'maya', title: 'Maya', ready: true, canAcceptCurrentCard: true }]);
  });

  it('hydrate replaces assets without notifying subscribers', () => {
    const store = createWorkspaceDocumentStore();
    const seen: unknown[] = [];
    store.subscribe((events) => seen.push(events));
    const snap = store.hydrate({
      projectId: 'proj-9',
      assets: [{ id: 'card-1', textBody: 'from save', originalCompanionKey: 'data:image/png;base64,nope' }],
    });
    expect(snap.projectId).toBe('proj-9');
    expect(snap.assetIds).toEqual(['card-1']);
    expect((snap.assets['card-1'] as { textBody?: string }).textBody).toBe('from save');
    expect(JSON.stringify(snap.assets)).not.toContain('data:image');
    expect(seen).toEqual([]);
    expect(snap.compartments.workshop.assetIds).toEqual(['card-1']);
    expect(snap.compartments.workflow.assetIds).toEqual([]);
  });

  it('hydrate drops finger selection when the card is gone', () => {
    const store = createWorkspaceDocumentStore();
    store.applyEvents([{ type: 'finger.changed', finger: { selectedAssetId: 'gone' } }]);
    const snap = store.hydrate({ projectId: 'p', assets: [{ id: 'keep', textBody: 'x' }] });
    expect(snap.finger.selectedAssetId).toBeNull();
    expect(snap.assetIds).toEqual(['keep']);
  });

  it('dispatch into workflow does not land on the workshop list', () => {
    const store = createWorkspaceDocumentStore();
    const snap = store.dispatch({
      type: 'upsert_asset',
      payload: { id: 'run-1', textBody: 'flow', compartment: 'workflow' },
    });
    expect(snap.assetIds).not.toContain('run-1');
    expect(snap.compartments.workflow.assetIds).toEqual(['run-1']);
    expect(workspaceEventsForCompartment(store.getEvents(), 'workshop')).toEqual([]);
    expect(workspaceEventsForCompartment(store.getEvents(), 'workflow')).toHaveLength(1);
  });

  it('P5-005 document path does not use executeJavaScript as the write entry', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/dsh-workspace-tool.cjs'), 'utf8');
    expect(src).toContain("writeMode = deps.writeMode || 'document'");
    expect(src).not.toMatch(/executeJavaScript/);
  });
});
