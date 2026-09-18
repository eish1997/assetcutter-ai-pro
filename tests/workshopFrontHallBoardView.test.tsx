// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkshopFrontHallBoardView } from '../components/workshop/WorkshopFrontHallBoardView';
import {
  buildBoardStateFromTree,
  workshopFrontHallEntryId,
  workshopFrontHallFrameId,
} from '../services/workshopFrontHall';

afterEach(() => {
  cleanup();
});

const treeFixture = [
  { rel: 'maps/hero.png', kind: 'image' },
  { rel: 'notes', kind: 'dir' },
];

describe('WorkshopFrontHallBoardView', () => {
  it('renders vendor nodes with data-node-id and selects on click', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const onSelectNode = vi.fn();
    const { container } = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />,
    );
    expect(container.querySelector('[data-front-hall-frame="notes"]')).toBeTruthy();
    expect(container.querySelector(`[data-node-id="${heroId}"]`)).toBeTruthy();
    fireEvent.mouseDown(container.querySelector(`[data-node-id="${heroId}"]`) as HTMLElement);
    expect(onSelectNode).toHaveBeenCalledWith(heroId);
    expect(container.querySelector('button')?.textContent || '').not.toContain('::');
  });

  it('drags a node when the pointer moves', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const { container } = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={heroId}
        onSelectNode={() => undefined}
      />,
    );
    const wrap = container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement;
    const startX = Number(wrap.getAttribute('data-front-hall-x') || 0);
    fireEvent.mouseDown(container.querySelector(`[data-node-id="${heroId}"]`) as HTMLElement, {
      clientX: 40,
      clientY: 40,
      button: 0,
    });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 40 });
    const moved = container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement;
    expect(Number(moved.getAttribute('data-front-hall-x') || 0)).toBeCloseTo(startX + 40, 0);
    fireEvent.mouseUp(window);
  });

  it('moves files inside a folder group when the group is dragged', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const mapsId = workshopFrontHallFrameId('D:/lib', 'maps');
    const { container } = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={mapsId}
        onSelectNode={() => undefined}
      />,
    );
    const hero = container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement;
    const startX = Number(hero.getAttribute('data-front-hall-x') || 0);
    fireEvent.mouseDown(container.querySelector(`[data-node-id="${mapsId}"]`) as HTMLElement, {
      clientX: 20,
      clientY: 20,
      button: 0,
    });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 20 });
    const moved = container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement;
    expect(Number(moved.getAttribute('data-front-hall-x') || 0)).toBeCloseTo(startX + 60, 0);
  });

  it('shift-clicks to keep more than one node selected', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const mapsId = workshopFrontHallFrameId('D:/lib', 'maps');
    const { container } = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={null}
        onSelectNode={() => undefined}
      />,
    );
    fireEvent.mouseDown(container.querySelector(`[data-node-id="${heroId}"]`) as HTMLElement, { button: 0 });
    fireEvent.mouseDown(container.querySelector(`[data-node-id="${mapsId}"]`) as HTMLElement, {
      button: 0,
      shiftKey: true,
    });
    expect(container.querySelector(`[data-front-hall-node="${heroId}"]`)?.getAttribute('data-front-hall-selected')).toBe(
      '1',
    );
    expect(container.querySelector(`[data-front-hall-node="${mapsId}"]`)?.getAttribute('data-front-hall-selected')).toBe(
      '1',
    );
  });

  it('exposes tokens and onDragTokenToNode', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const tokenId = state.tokens[0].id;
    const onDragTokenToNode = vi.fn();
    const { container } = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={heroId}
        onSelectNode={() => undefined}
        onDragTokenToNode={onDragTokenToNode}
      />,
    );
    expect(container.querySelector(`[data-front-hall-token="${tokenId}"]`)).toBeTruthy();
    fireEvent.pointerDown(container.querySelector(`[data-front-hall-token="${tokenId}"]`) as HTMLElement);
    fireEvent.pointerUp(container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement);
    expect(onDragTokenToNode).toHaveBeenCalledWith(tokenId, heroId);
  });

  it('fires F3 add from the board hotkey', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const onF3Add = vi.fn();
    render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel=""
        selectedNodeId={null}
        onSelectNode={() => undefined}
        onF3Add={onF3Add}
      />,
    );
    fireEvent.keyDown(window, { key: 'F3' });
    expect(onF3Add).toHaveBeenCalled();
  });

  it('wires WorkflowSection to the board view and viewMode', () => {
    const src = fs.readFileSync(path.resolve('components/WorkflowSection.tsx'), 'utf8');
    expect(src).toContain('WorkshopFrontHallBoardView');
    expect(src).toMatch(/import\('\.\/workshop\/WorkshopFrontHallBoardView'\)/);
    expect(src).not.toMatch(/import \{ WorkshopFrontHallBoardView \}/);
    expect(src).toContain('viewMode');
    expect(src).toContain('data-front-hall-view-toggle');
    expect(src).toContain('listBoardEntries');
    expect(src).toContain('boardTree: true');
    expect(src).toContain('onDragTokenToNode');
    expect(src).toContain('overflow-hidden');
    expect(src).toContain('workshopFrontHallHotkey');
    expect(src).toContain('viewFilter');
    expect(src).toContain('workshopBoardEntries');
  });

  it('hosts InfiniteCanvas rather than xyflow', () => {
    const board = fs.readFileSync(path.resolve('components/workshop/WorkshopFrontHallBoardView.tsx'), 'utf8');
    const host = fs.readFileSync(path.resolve('components/workshop/WorkshopFrontHallCanvasHost.tsx'), 'utf8');
    const src = board + host;
    expect(src).toContain('InfiniteCanvas');
    expect(src).toContain('CanvasNode');
    expect(src).toContain('CanvasToolbar');
    expect(src).toContain('ConnectionPath');
    expect(src).not.toContain('@xyflow/react');
    expect(host).toMatch(/AntdApp className="[^"]*h-full/);
    expect(board).toContain('height: \'100%\'');
  });

  it('keeps a saved node pose across remounts', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const first = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={heroId}
        onSelectNode={() => undefined}
      />,
    );
    const wrap = first.container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement;
    const x = Number(wrap.getAttribute('data-front-hall-x') || 0);
    expect(Number.isFinite(x)).toBe(true);
    first.unmount();
    const second = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={heroId}
        onSelectNode={() => undefined}
      />,
    );
    const again = second.container.querySelector(`[data-front-hall-node="${heroId}"]`) as HTMLElement;
    expect(Number(again.getAttribute('data-front-hall-x') || 0)).toBe(x);
  });

  it('applies kind filters to canvas display only', () => {
    const state = buildBoardStateFromTree('D:/lib', treeFixture);
    const heroId = workshopFrontHallEntryId('D:/lib', 'maps/hero.png');
    const { container } = render(
      <WorkshopFrontHallBoardView
        state={state}
        cameraFrameRel="maps"
        selectedNodeId={null}
        onSelectNode={() => undefined}
        viewFilter={{ kinds: ['video'] }}
      />,
    );
    expect(container.querySelector(`[data-front-hall-node="${heroId}"]`)).toBeNull();
    expect(container.querySelector('[data-front-hall-frame="notes"]')).toBeNull();
    expect(state.nodes.some((node) => node.id === heroId)).toBe(true);
  });
});
