import { describe, expect, it } from 'vitest';
import {
  assertWorkshopKindPluginPaintOnly,
  boardContainsFrames,
  boardEntriesToTreeInput,
  boardNodesFromAcAssetDoc,
  buildBoardStateFromTree,
  dragTokenToNode,
  f3AddToken,
  f3RemoveToken,
  filterListingByKinds,
  fingerLocalRels,
  fingerTarget,
  gridIdsMatchListing,
  listingFromTokens,
  mergeBoardPackageNodes,
  nodesNeedingHydrate,
  projectFrontHallBoard,
  projectFrontHallGrid,
  tokensOnNode,
  workshopFrontHallCameraFrameId,
  workshopFrontHallCameraFrameRel,
  workshopFrontHallEntryId,
  workshopFrontHallListingIds,
  workshopFrontHallMetaUrlIsPersistable,
  workshopKindPluginIsPaintOnly,
  type WorkshopFrontHallBoardState,
  type WorkshopFrontHallListingItem,
  type WorkshopKindPluginRegistration,
} from '../services/workshopFrontHall';

const currentFolderListing: WorkshopFrontHallListingItem[] = [
  { root: 'D:/lib', rel: 'maps/hero.png', name: 'hero.png', kind: 'image' },
];

const boardState: WorkshopFrontHallBoardState = {
  root: 'D:/lib',
  frames: ['', 'maps', 'notes'],
  nodes: [
    { id: 'n-hero-v1', folderRel: 'maps' },
    { id: 'n-hero-v2', folderRel: 'maps' },
    { id: 'n-readme', folderRel: 'notes' },
  ],
  tokens: [{ id: 't-hero', fileRel: 'maps/hero.png', nodeId: 'n-hero-v2' }],
};

const paintPlugin: WorkshopKindPluginRegistration = {
  kind: 'image',
  extensions: ['.png'],
  hydrate: 'thumb-jpeg',
  card: 'image-thumb',
  focus: 'image',
  previewable: ['.png'],
};

const treeFixture = [
  { rel: 'maps/hero.png', kind: 'image' },
  { rel: 'notes', kind: 'dir' },
];

describe('workshopFrontHallArchitecture v1.1', () => {
  it('builds frames from directories including empty folders, and nodes from files only', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    expect(state.frames).toEqual(expect.arrayContaining(['', 'maps', 'notes']));
    expect(state.nodes).toEqual([
      { id: workshopFrontHallEntryId('D:/lib', 'maps/hero.png'), folderRel: 'maps' },
    ]);
    expect(boardContainsFrames(state, ['', 'maps', 'notes'])).toBe(true);
  });

  it('gives each file a stable default local token and keeps empty-frame listings empty', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    expect(state.tokens).toEqual([{ id: `tok:${heroId}`, fileRel: 'maps/hero.png', nodeId: heroId }]);
    expect(listingFromTokens('D:/lib', 'maps', state.tokens).map((row) => row.rel)).toEqual(['maps/hero.png']);
    expect(listingFromTokens('D:/lib', 'notes', state.tokens)).toEqual([]);
    expect(boardContainsFrames(state, ['notes'])).toBe(true);
  });

  it('makes grid ids match the current-folder listing only', () => {
    const ids = workshopFrontHallListingIds(currentFolderListing);
    expect(ids).toEqual([workshopFrontHallEntryId('D:/lib', 'maps/hero.png')]);
    expect(projectFrontHallGrid(currentFolderListing).ids).toEqual(ids);
    expect(gridIdsMatchListing(currentFolderListing)).toBe(true);
  });

  it('lets the board hold more nodes than the current listing, including empty frames', () => {
    const board = projectFrontHallBoard(boardState);
    expect(board.ids).toEqual(['n-hero-v1', 'n-hero-v2', 'n-readme']);
    expect(board.ids).not.toEqual(projectFrontHallGrid(currentFolderListing).ids);
    expect(boardContainsFrames(boardState, ['', 'maps', 'notes'])).toBe(true);
    const emptied = {
      ...boardState,
      tokens: [],
      nodes: [{ id: 'n-canvas-only', folderRel: 'notes' }],
    };
    expect(boardContainsFrames(emptied, ['notes'])).toBe(true);
    expect(projectFrontHallBoard(emptied).ids).toContain('n-canvas-only');
    expect(listingFromTokens('D:/lib', 'notes', emptied.tokens)).toEqual([]);
  });

  it('does not change the board set when the list is kind-filtered', () => {
    const mixed: WorkshopFrontHallListingItem[] = [
      { root: 'D:/lib', rel: 'maps/hero.png', name: 'hero.png', kind: 'image' },
      { root: 'D:/lib', rel: 'maps/clip.mp4', name: 'clip.mp4', kind: 'video' },
    ];
    const filtered = filterListingByKinds(mixed, ['image']);
    expect(filtered.map((row) => row.rel)).toEqual(['maps/hero.png']);
    const before = projectFrontHallBoard(boardState);
    const after = projectFrontHallBoard(boardState);
    expect(after.ids).toEqual(before.ids);
    expect(after.frames).toEqual(before.frames);
  });

  it('keeps board nodes when layout is missing', () => {
    const withoutLayout = projectFrontHallBoard(boardState, null);
    const withPartialLayout = projectFrontHallBoard(boardState, {
      'n-hero-v2': { x: 10, y: 20 },
    });
    expect(withoutLayout.nodes.every((node) => node.pose === null)).toBe(true);
    expect(withPartialLayout.ids).toEqual(withoutLayout.ids);
    expect(withPartialLayout.frames).toEqual(withoutLayout.frames);
    expect(withPartialLayout.nodes.find((node) => node.id === 'n-hero-v2')?.pose).toEqual({ x: 10, y: 20 });
  });

  it('adds a local slot with F3 and keeps the node after removing the slot', () => {
    const added = f3AddToken(boardState, 'n-hero-v1', 't-hero-copy', 'copy.png');
    expect(added.tokens).toHaveLength(2);
    expect(added.tokens[1]).toEqual({ id: 't-hero-copy', fileRel: 'maps/copy.png', nodeId: 'n-hero-v1' });
    expect(listingFromTokens('D:/lib', 'maps', added.tokens).map((row) => row.rel)).toEqual([
      'maps/hero.png',
      'maps/copy.png',
    ]);
    const removed = f3RemoveToken(added, 't-hero-copy');
    expect(removed.nodes.map((node) => node.id)).toEqual(boardState.nodes.map((node) => node.id));
    expect(listingFromTokens('D:/lib', 'maps', removed.tokens).map((row) => row.rel)).toEqual(['maps/hero.png']);
  });

  it('drags a local token onto another node and stacks tokens on the same node', () => {
    const moved = dragTokenToNode(boardState, 't-hero', 'n-hero-v1');
    expect(moved.tokens[0]).toEqual({ id: 't-hero', fileRel: 'maps/hero.png', nodeId: 'n-hero-v1' });
    const stacked = f3AddToken(moved, 'n-hero-v1', 't-extra', 'extra.png');
    expect(tokensOnNode(stacked, 'n-hero-v1').map((token) => token.id)).toEqual(['t-hero', 't-extra']);
    const intoNotes = dragTokenToNode(stacked, 't-extra', 'n-readme');
    expect(intoNotes.tokens.find((token) => token.id === 't-extra')).toEqual({
      id: 't-extra',
      fileRel: 'notes/extra.png',
      nodeId: 'n-readme',
    });
  });

  it('points the finger at the selected board node', () => {
    expect(fingerTarget(null)).toBeNull();
    expect(fingerTarget('n-hero-v2')).toBe('n-hero-v2');
    expect(fingerLocalRels(boardState, 'n-hero-v2')).toEqual(['maps/hero.png']);
    expect(fingerLocalRels(boardState, 'n-hero-v1')).toEqual([]);
  });

  it('hydrates only visible board nodes', () => {
    expect(nodesNeedingHydrate(['a', 'b', 'c'], ['b'])).toEqual(['b']);
  });

  it('rejects kind plugins that claim to own file bytes', () => {
    expect(workshopKindPluginIsPaintOnly(paintPlugin)).toBe(true);
    expect(() => assertWorkshopKindPluginPaintOnly(paintPlugin)).not.toThrow();
    expect(workshopKindPluginIsPaintOnly({ ...paintPlugin, ownsFileBytes: true })).toBe(false);
    expect(() => assertWorkshopKindPluginPaintOnly({ ...paintPlugin, ownsFileBytes: true })).toThrow(
      /cannot own file bytes/,
    );
  });

  it('forbids persisting localhost resource addresses in front-hall metadata', () => {
    expect(workshopFrontHallMetaUrlIsPersistable('http://localhost:9100/api/r2/x.jpg')).toBe(false);
    expect(workshopFrontHallMetaUrlIsPersistable('http://127.0.0.1/thumbs/a.jpg')).toBe(false);
    expect(workshopFrontHallMetaUrlIsPersistable('http://[::1]/a.jpg')).toBe(false);
    expect(workshopFrontHallMetaUrlIsPersistable('./previews/x.jpg')).toBe(true);
    expect(workshopFrontHallMetaUrlIsPersistable('/api/r2/capability-store/x.jpg')).toBe(true);
    expect(workshopFrontHallMetaUrlIsPersistable('https://cdn.example/a.jpg')).toBe(true);
  });

  it('maps left-tree loc to the camera frame', () => {
    expect(workshopFrontHallCameraFrameRel({ rel: 'maps\\hero' })).toBe('maps/hero');
    expect(workshopFrontHallCameraFrameRel({ rel: '' })).toBe('');
    expect(workshopFrontHallCameraFrameId('D:/lib', { rel: 'notes' })).toBe('D:/lib::frame::notes');
  });

  it('exports finger paths from the selected tree-built node', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    expect(fingerTarget(heroId)).toBe(heroId);
    expect(fingerLocalRels(state, heroId)).toEqual(['maps/hero.png']);
    expect(fingerLocalRels(state, null)).toEqual([]);
    expect(fingerLocalRels(state, 'missing')).toEqual([]);
  });

  it('converts board tree entries including empty dirs', () => {
    const input = boardEntriesToTreeInput([
      { rel: 'maps/hero.png', kind: 'loose', assetKind: 'image' },
      { rel: 'notes', kind: 'dir' },
    ]);
    const state = buildBoardStateFromTree('D:/lib', input);
    expect(boardContainsFrames(state, ['notes', 'maps'])).toBe(true);
    expect(state.nodes.map((node) => node.folderRel)).toEqual(['maps']);
  });

  it('projects package files as extra board nodes without dropping the package node', () => {
    const state = buildBoardStateFromTree('D:/lib', [{ rel: 'a3f1c0e8', kind: 'package' }]);
    const extra = boardNodesFromAcAssetDoc('D:/lib', 'a3f1c0e8', {
      files: {
        orig: { name: '7b2c91aa.png' },
        result: { name: 'c91e04d2.png' },
      },
    });
    const merged = mergeBoardPackageNodes(state, extra);
    expect(merged.nodes.length).toBe(3);
    expect(merged.nodes.some((node) => node.id.includes('c91e04d2.png'))).toBe(true);
  });
});
