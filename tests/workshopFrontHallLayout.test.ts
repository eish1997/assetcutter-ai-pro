import { describe, expect, it } from 'vitest';
import {
  buildBoardStateFromTree,
  workshopFrontHallEntryId,
  workshopFrontHallFrameId,
  workshopFrontHallMetaUrlIsPersistable,
} from '../services/workshopFrontHall';
import {
  layoutBoardDefault,
  parseWorkshopFrontHallLayout,
  readWorkshopFrontHallLayout,
  ensureWorkshopFrontHallLayout,
  workshopFrontHallLayoutStorageKey,
  writeWorkshopFrontHallLayout,
} from '../services/workshopFrontHallLayout';

const treeFixture = [
  { rel: 'maps/hero.png', kind: 'image' },
  { rel: 'notes', kind: 'dir' },
];

describe('workshopFrontHallLayout', () => {
  it('keeps saved poses and only packs missing nodes', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const notesId = workshopFrontHallFrameId('D:/lib', 'notes');
    const mapsId = workshopFrontHallFrameId('D:/lib', 'maps');
    const kept = layoutBoardDefault(state, { [heroId]: { x: 12, y: 34 } });
    expect(kept[heroId]).toEqual({ x: 12, y: 34 });
    expect(kept[mapsId]).toBeTruthy();
    expect(kept[notesId]).toBeTruthy();
    expect(kept[mapsId].x).not.toBe(kept[notesId].x);
  });

  it('does not rewrite overlapping poses the user already saved', () => {
    const state = buildBoardStateFromTree('D:/lib', [
      { rel: 'a.png', kind: 'image' },
      { rel: 'b.png', kind: 'image' },
    ]);
    const a = state.nodes[0].id;
    const b = state.nodes[1].id;
    const piled = layoutBoardDefault(state, {
      [a]: { x: 0, y: 0 },
      [b]: { x: 8, y: 8 },
    });
    expect(piled[a]).toEqual({ x: 0, y: 0 });
    expect(piled[b]).toEqual({ x: 8, y: 8 });
  });

  it('spreads files in a folder and recovers a collapsed pile', () => {
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
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    };
    (globalThis as { localStorage?: Storage }).localStorage = store as Storage;
    const state = buildBoardStateFromTree('D:/lib', [
      { rel: 'a.png', kind: 'image' },
      { rel: 'b.png', kind: 'image' },
      { rel: 'c.png', kind: 'image' },
      { rel: 'notes', kind: 'dir' },
    ]);
    const packed = layoutBoardDefault(state);
    const ids = state.nodes.map((node) => node.id);
    const xs = ids.map((id) => packed[id].x);
    expect(new Set(xs).size).toBe(ids.length);
    const collapsed: Record<string, { x: number; y: number }> = {};
    for (const id of [...ids, workshopFrontHallFrameId('D:/lib', ''), workshopFrontHallFrameId('D:/lib', 'notes')]) {
      collapsed[id] = { x: 0, y: 0 };
    }
    writeWorkshopFrontHallLayout('D:/lib', collapsed);
    const recovered = ensureWorkshopFrontHallLayout(state);
    const recoveredXs = ids.map((id) => recovered[id].x);
    expect(new Set(recoveredXs).size).toBe(ids.length);
    expect(recovered[ids[0]].x).not.toBe(0);
  });

  it('treats bad persist payloads as empty maps and never as deleted goods', () => {
    expect(parseWorkshopFrontHallLayout(null)).toEqual({});
    expect(parseWorkshopFrontHallLayout('nope')).toEqual({});
    expect(parseWorkshopFrontHallLayout({ poses: { a: { x: 1 } } })).toEqual({});
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const before = state.nodes.map((node) => node.id);
    const layout = parseWorkshopFrontHallLayout({ bad: true });
    expect(layout).toEqual({});
    expect(state.nodes.map((node) => node.id)).toEqual(before);
    expect(workshopFrontHallLayoutStorageKey('D:/lib')).toContain('workshopFrontHallLayout');
    expect(workshopFrontHallMetaUrlIsPersistable('http://localhost/x')).toBe(false);
  });

  it('round-trips layout through client persist helpers', () => {
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
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    };
    (globalThis as { localStorage?: Storage }).localStorage = store as Storage;
    writeWorkshopFrontHallLayout('D:/lib', { n1: { x: 8, y: 9 } });
    expect(readWorkshopFrontHallLayout('D:/lib')).toEqual({ n1: { x: 8, y: 9 } });
    expect(readWorkshopFrontHallLayout('missing-root')).toEqual({});
  });

  it('keeps saved poses when a packed default layout is passed in', () => {
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
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    };
    (globalThis as { localStorage?: Storage }).localStorage = store as Storage;
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    writeWorkshopFrontHallLayout('D:/lib', { [heroId]: { x: 777, y: 321 } });
    const packed = layoutBoardDefault(state);
    expect(packed[heroId]).not.toEqual({ x: 777, y: 321 });
    const ensured = ensureWorkshopFrontHallLayout(state, packed);
    expect(ensured[heroId]).toEqual({ x: 777, y: 321 });
    expect(readWorkshopFrontHallLayout('D:/lib')[heroId]).toEqual({ x: 777, y: 321 });
  });
});
