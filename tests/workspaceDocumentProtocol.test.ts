import { describe, expect, it } from 'vitest';
import {
  applyWorkspaceCommand,
  emptyWorkspaceFinger,
  formatWorkspaceDocumentForDsh,
  formatWorkspaceFingerForDsh,
  nextSelectedAssetIdsFromFinger,
  pickHostForSend,
  reduceWorkspaceEvents,
  workspaceCommandToEvents,
  workspaceEventsForCompartment,
  workspaceFingerFromUi,
  type WorkspaceSnapshot,
} from '../services/workspaceDocumentProtocol';

function fixture(): WorkspaceSnapshot {
  return {
    projectId: 'proj-1',
    finger: {
      ...emptyWorkspaceFinger(),
      selectedAssetId: 'asset-a',
      selectedDisplayKey: 'A',
    },
    assetIds: ['asset-a', 'asset-b'],
    assets: {},
    compartments: {
      workshop: { assetIds: ['asset-a', 'asset-b'] },
      workflow: { assetIds: [] },
      tools: { assetIds: [] },
      rooms: {},
    },
  };
}

describe('workspaceDocumentProtocol', () => {
  it('round-trips a snapshot through noop', () => {
    const snap = fixture();
    const next = applyWorkspaceCommand(snap, { type: 'noop' });
    expect(next).toEqual(snap);
  });

  it('append_text_result only adds the target id', () => {
    const snap = fixture();
    const next = applyWorkspaceCommand(snap, { type: 'append_text_result', assetId: 'asset-a', text: 'hello' });
    expect(next.assetIds).toEqual(['asset-a', 'asset-b']);
    expect(next.finger.selectedAssetId).toBe('asset-a');
    const other = applyWorkspaceCommand(snap, { type: 'append_text_result', assetId: 'asset-c', text: 'x' });
    expect(other.assetIds).toEqual(['asset-a', 'asset-b', 'asset-c']);
    expect(other.assetIds).not.toContain('unrelated');
  });

  it('formatWorkspaceFingerForDsh includes selected id and empty hosts', () => {
    const text = formatWorkspaceFingerForDsh(fixture().finger);
    expect(text).toContain('selectedAssetId=asset-a');
    expect(text).toContain('未连接');
  });

  it('formatWorkspaceFingerForDsh includes selected rel path and root ids', () => {
    const text = formatWorkspaceFingerForDsh({
      ...emptyWorkspaceFinger(),
      selectedRoot: 'C:/lib',
      selectedRelPath: 'maps/a.png',
      selectedFileId: 'abc123',
    });
    expect(text).toContain('selectedRelPath=maps/a.png');
    expect(text).toContain('selectedRoot=C:/lib');
    expect(text).toContain('selectedFileId=abc123');
  });


  it('workspaceFingerFromUi maps selection and lightbox', () => {
    const finger = workspaceFingerFromUi({
      selectedAssetIds: ['card-1'],
      assets: [{ id: 'card-1', displayKey: 'original' }],
      lightboxAssetId: 'card-1',
      surface: 'canvas',
    });
    expect(finger.selectedAssetId).toBe('card-1');
    expect(finger.selectedDisplayKey).toBe('original');
    expect(finger.previewOpen).toBe(true);
    expect(finger.previewAssetId).toBe('card-1');
    expect(finger.connectedHosts).toEqual([]);
  });

  it('workspaceFingerFromUi keeps selectedRelPath as the file-source finger', () => {
    const finger = workspaceFingerFromUi({
      selectedAssetIds: ['wsfile:x/a.png'],
      selectedRoot: 'C:/lib',
      selectedRelPath: 'a.png',
      surface: 'canvas',
    });
    expect(finger.selectedRelPath).toBe('a.png');
    expect(finger.selectedRoot).toBe('C:/lib');
    expect(finger.selectedDisplayKey).toBe('original');
  });

  it('reduceWorkspaceEvents applies finger.changed and asset.upsert', () => {
    const snap = reduceWorkspaceEvents(
      [
        { type: 'finger.changed', finger: { selectedAssetId: 'card-9' } },
        { type: 'asset.upsert', payload: { id: 'card-9', assetKind: 'text' } },
      ],
      fixture(),
    );
    expect(snap.finger.selectedAssetId).toBe('card-9');
    expect(snap.assetIds).toContain('card-9');
    expect(snap.assets['card-9']?.assetKind).toBe('text');
  });

  it('formatWorkspaceFingerForDsh lists connected host titles', () => {
    const text = formatWorkspaceFingerForDsh({
      ...emptyWorkspaceFinger(),
      selectedAssetId: 'a1',
      connectedHosts: [{ id: 'maya', title: 'Maya', ready: true, canAcceptCurrentCard: true }],
    });
    expect(text).toContain('Maya');
    expect(text).not.toContain('未连接');
  });

  it('ingest_image adds an asset id without binary payload', () => {
    const events = workspaceCommandToEvents(fixture(), {
      type: 'ingest_image',
      companionKey: 'companion/img-1',
    });
    expect(JSON.stringify(events)).not.toContain('data:image');
    const next = reduceWorkspaceEvents(events, fixture());
    expect(next.assetIds.some((id) => id.startsWith('image-'))).toBe(true);
  });

  it('generate_on_current fails without a selected card', () => {
    const empty = { ...fixture(), finger: emptyWorkspaceFinger(), assetIds: [] };
    const nextEvents = workspaceCommandToEvents(empty, { type: 'generate_on_current', ok: true, resultKey: 'r1' });
    expect(nextEvents[0]).toMatchObject({ type: 'command.failed', error: 'no_selected_asset' });
  });

  it('upsert_asset stores document fields and strips inline binaries', () => {
    const snap = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: {
        id: 'card-bin',
        assetKind: 'image',
        displayKey: 'original',
        originalCompanionKey: 'image-full-original-abcd1234',
        textBody: 'caption',
      },
    });
    expect(snap.assets['card-bin']?.originalCompanionKey).toBe('image-full-original-abcd1234');
    expect(JSON.stringify(snap.assets)).not.toContain('data:image');
    const dirty = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: {
        id: 'card-bin',
        originalCompanionKey: 'data:image/png;base64,aaa',
      },
    });
    expect(dirty.assets['card-bin']?.originalCompanionKey).toBeUndefined();
  });

  it('remove_asset drops the card from snapshot assets', () => {
    const seeded = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'card-9', textBody: 'x' },
    });
    const next = applyWorkspaceCommand(seeded, { type: 'remove_asset', assetId: 'card-9' });
    expect(next.assetIds).not.toContain('card-9');
    expect(next.assets['card-9']).toBeUndefined();
  });

  it('remove_asset clears finger when the selected card is deleted', () => {
    const seeded = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'asset-a', textBody: 'keep' },
    });
    const next = applyWorkspaceCommand(seeded, { type: 'remove_asset', assetId: 'asset-a' });
    expect(next.finger.selectedAssetId).toBeNull();
    expect(next.finger.selectedDisplayKey).toBeNull();
  });

  it('formatWorkspaceDocumentForDsh lists cards and the shared-draft instruction', () => {
    const snap = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'asset-a', assetKind: 'text', textTitle: '稿', textBody: 'hello' },
    });
    const text = formatWorkspaceDocumentForDsh(snap);
    expect(text).toContain('同一份稿');
    expect(text).toContain('本地壳');
    expect(text).toContain('workspace_read_document');
    expect(text).toContain('id=asset-a');
    expect(text).toContain('hello');
    expect(text).toContain('compartments=workshop:');
  });

  it('set_finger writes canvas fields and drops connectedHosts from the command', () => {
    const snap = applyWorkspaceCommand(fixture(), {
      type: 'set_finger',
      finger: {
        selectedAssetId: 'card-9',
        previewOpen: true,
        previewAssetId: 'card-9',
        surface: 'presets',
        connectedHosts: [{ id: 'hack', title: 'Hack', ready: true, canAcceptCurrentCard: true }],
      },
    });
    expect(snap.finger.selectedAssetId).toBe('card-9');
    expect(snap.finger.previewOpen).toBe(true);
    expect(snap.finger.surface).toBe('presets');
    expect(snap.finger.connectedHosts).toEqual([]);
  });

  it('set_finger can point at a shell room', () => {
    const snap = applyWorkspaceCommand(fixture(), {
      type: 'set_finger',
      finger: { surface: 'connections' },
    });
    expect(snap.finger.surface).toBe('connections');
  });

  it('nextSelectedAssetIdsFromFinger keeps multi-select when the primary id matches', () => {
    expect(nextSelectedAssetIdsFromFinger(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(nextSelectedAssetIdsFromFinger(['a', 'b'], 'c')).toEqual(['c']);
    expect(nextSelectedAssetIdsFromFinger(['a'], null)).toEqual([]);
  });

  it('send_to_current_host fails when no software is connected', () => {
    expect(pickHostForSend(emptyWorkspaceFinger()).ok).toBe(false);
    expect(pickHostForSend(emptyWorkspaceFinger()).error).toBe('no_ready_host');
    const picked = pickHostForSend({
      ...emptyWorkspaceFinger(),
      connectedHosts: [{ id: 'maya', title: 'Maya', ready: true, canAcceptCurrentCard: true }],
    });
    expect(picked.ok).toBe(true);
  });

  it('pickHostForSend returns multi_ready_host when multiple hosts accept', () => {
    const picked = pickHostForSend({
      ...emptyWorkspaceFinger(),
      connectedHosts: [
        { id: 'maya', title: 'Maya', ready: true, canAcceptCurrentCard: true },
        { id: 'ps', title: 'Photoshop', ready: true, canAcceptCurrentCard: true },
      ],
    });
    expect(picked.ok).toBe(false);
    if (!picked.ok) expect(picked.error).toBe('multi_ready_host');
  });

  it('upsert_asset into workflow stays out of the workshop assetIds list', () => {
    const next = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'run-1', assetKind: 'text', textBody: 'flow', compartment: 'workflow' },
    });
    expect(next.assetIds).toEqual(['asset-a', 'asset-b']);
    expect(next.compartments.workflow.assetIds).toEqual(['run-1']);
    expect(next.assets['run-1']?.compartment).toBe('workflow');
    expect(next.assets['run-1']?.textBody).toBe('flow');
  });

  it('room assets without roomId fall back to workshop', () => {
    const next = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'page-1', compartment: 'room', textBody: 'index' },
    });
    expect(next.assetIds).toContain('page-1');
    expect(next.compartments.workshop.assetIds).toContain('page-1');
    expect(next.assets['page-1']?.compartment).toBeUndefined();
  });

  it('room assets with roomId go into that room bucket', () => {
    const next = applyWorkspaceCommand(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'page-1', compartment: 'room', roomId: 'room-7', textBody: 'index' },
    });
    expect(next.assetIds).not.toContain('page-1');
    expect(next.compartments.rooms['room-7'].assetIds).toEqual(['page-1']);
    expect(next.assets['page-1']?.roomId).toBe('room-7');
  });

  it('workspaceEventsForCompartment keeps finger events and workshop upserts only', () => {
    const events = workspaceCommandToEvents(fixture(), {
      type: 'upsert_asset',
      payload: { id: 'run-1', compartment: 'workflow', textBody: 'flow' },
    });
    expect(workspaceEventsForCompartment(events, 'workshop')).toEqual([]);
    expect(workspaceEventsForCompartment(events, 'workflow')).toEqual(events);
    expect(
      workspaceEventsForCompartment([{ type: 'finger.changed', finger: { selectedAssetId: 'asset-a' } }], 'workshop'),
    ).toHaveLength(1);
  });
});
