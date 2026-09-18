import { afterEach, describe, expect, it } from 'vitest';
import { CanvasNodeType } from '@ic/types/canvas';
import {
  buildBoardStateFromTree,
  workshopFrontHallEntryId,
  workshopFrontHallFrameId,
} from '../services/workshopFrontHall';
import {
  addFrontHallCanvasNode,
  boardStateToCanvasNodes,
  canvasNodesToLayout,
  connectFrontHallNodes,
  disconnectFrontHallEdge,
  filterCanvasNodesForView,
  frontHallPreviewMap,
  parseWorkshopFrontHallGraph,
  readWorkshopFrontHallGraph,
  workshopFrontHallGraphStorageKey,
  writeWorkshopFrontHallGraph,
} from '../services/workshopFrontHallGraph';
import { workshopFileAssetId } from '../services/workshopFileTree';

const treeFixture = [
  { rel: 'maps/hero.png', kind: 'image' },
  { rel: 'notes', kind: 'dir' },
];

afterEach(() => {
  const store = (globalThis as { localStorage?: Storage }).localStorage;
  store?.clear?.();
});

describe('workshopFrontHallGraph', () => {
  it('connects and disconnects reference edges with stable ids', () => {
    const a = 'n-a';
    const b = 'n-b';
    const once = connectFrontHallNodes([], a, b);
    expect(once).toEqual([{ id: 'edge:n-a:n-b', fromNodeId: a, toNodeId: b }]);
    expect(connectFrontHallNodes(once, a, b)).toEqual(once);
    expect(disconnectFrontHallEdge(once, 'edge:n-a:n-b')).toEqual([]);
  });

  it('treats bad JSON as empty edges without touching listing', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const before = state.nodes.map((node) => node.id);
    const parsed = parseWorkshopFrontHallGraph('nope');
    expect(parsed.edges).toEqual([]);
    expect(parsed.extraNodes).toEqual([]);
    expect(state.nodes.map((node) => node.id)).toEqual(before);
    expect(workshopFrontHallGraphStorageKey('D:/lib')).toBe('workshopFrontHallGraph:D:/lib');
  });

  it('projects empty folders to group nodes and files to media cards without :: in titles', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const nodes = boardStateToCanvasNodes(state);
    const notes = nodes.find((node) => node.metadata?.folderRel === 'notes' && node.type === CanvasNodeType.Group);
    expect(notes).toBeTruthy();
    expect(notes?.id).toBe(workshopFrontHallFrameId('D:/lib', 'notes'));
    const hero = nodes.find((node) => node.id === workshopFrontHallEntryId('D:/lib', 'maps/hero.png'));
    expect(hero?.type).toBe(CanvasNodeType.Image);
    expect(hero?.title).toBe('hero.png');
    expect(hero?.title.includes('::')).toBe(false);
  });

  it('round-trips persist through clientPersist helpers', () => {
    const memory = new Map<string, string>();
    const store = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
      key: () => null,
      length: 0,
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
    const extra = addFrontHallCanvasNode({
      root: 'D:/lib',
      folderRel: 'maps',
      kind: 'image',
      originPose: { x: 10, y: 20 },
      now: 1,
    });
    writeWorkshopFrontHallGraph('D:/lib', {
      v: 1,
      viewport: { x: 1, y: 2, k: 1 },
      edges: connectFrontHallNodes([], 'a', 'b'),
      extraNodes: [extra],
    });
    const loaded = readWorkshopFrontHallGraph('D:/lib');
    expect(loaded.edges).toHaveLength(1);
    expect(loaded.extraNodes[0]?.id).toBe(extra.id);
    const layout = canvasNodesToLayout(boardStateToCanvasNodes(buildBoardStateFromTree('D:/lib', treeFixture)));
    expect(layout[workshopFrontHallEntryId('D:/lib', 'maps/hero.png')]).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it('maps persistable previews, data URLs, and workshop file asset keys', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const assetId = workshopFileAssetId('D:/lib', 'maps/hero.png');
    const map = frontHallPreviewMap(
      {
        [heroId]: './previews/hero.jpg',
        other: 'http://localhost:9100/x.jpg',
      },
      state,
    );
    expect(map[heroId]).toBe('./previews/hero.jpg');
    expect(Object.values(map).some((url) => url.includes('localhost'))).toBe(false);
    const dataMap = frontHallPreviewMap({ [assetId]: 'data:image/jpeg;base64,abc' }, state);
    expect(dataMap[heroId]).toBe('data:image/jpeg;base64,abc');
  });

  it('hides unmatched files on the canvas without dropping them from the graph', () => {
    const state = buildBoardStateFromTree('D:/lib', [
      { rel: 'maps/hero.png', kind: 'image' },
      { rel: 'maps/clip.mp4', kind: 'video' },
      { rel: 'notes', kind: 'dir' },
    ]);
    const nodes = boardStateToCanvasNodes(state);
    const shown = filterCanvasNodesForView(nodes, { kinds: ['image'] });
    expect(shown.some((node) => node.title === 'hero.png')).toBe(true);
    expect(shown.some((node) => node.title === 'clip.mp4')).toBe(false);
    expect(shown.some((node) => node.type === CanvasNodeType.Group && node.metadata?.folderRel === 'notes')).toBe(false);
    expect(state.nodes).toHaveLength(2);
  });
});
