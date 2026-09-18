import { describe, expect, it } from 'vitest';
import { workshopFrontHallHotkey } from '../services/workshopFrontHallHotkeys';
import { buildBoardStateFromTree, f3AddToken, f3RemoveToken, listingFromTokens } from '../services/workshopFrontHall';

describe('workshopFrontHallHotkeys', () => {
  it('maps F3 and Shift+F3', () => {
    expect(workshopFrontHallHotkey({ key: 'F3' })).toBe('f3-add');
    expect(workshopFrontHallHotkey({ key: 'F3', shiftKey: true })).toBe('f3-remove');
    expect(workshopFrontHallHotkey({ key: 'a' })).toBeNull();
  });

  it('adds and removes tokens in the selected-node folder', () => {
    const state = buildBoardStateFromTree('D:/lib', [
      { rel: 'maps/hero.png', kind: 'image' },
      { rel: 'notes', kind: 'dir' },
    ]);
    const heroId = state.nodes[0].id;
    const added = f3AddToken(state, heroId, 'tok:new', 'slot.md');
    expect(listingFromTokens('D:/lib', 'maps', added.tokens).map((row) => row.rel)).toContain('maps/slot.md');
    const removed = f3RemoveToken(added, 'tok:new');
    expect(removed.nodes.map((node) => node.id)).toEqual(state.nodes.map((node) => node.id));
  });
});
