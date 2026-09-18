import { describe, expect, it } from 'vitest';
import {
  applyPan,
  applyWheelZoom,
  cameraToCss,
  flyToFrame,
  frontHallCameraToViewport,
  flyToGroupViewport,
  normalizeFrontHallCamera,
  readFrontHallCamera,
  screenToWorld,
  viewportToFrontHallCamera,
  visibleNodeIds,
  worldToScreen,
  writeFrontHallCamera,
} from '../services/workshopFrontHallCamera';

describe('workshopFrontHallCamera', () => {
  it('pans world points with the camera and keeps wheel-zoom anchored', () => {
    const start = normalizeFrontHallCamera({ x: 0, y: 0, zoom: 1 });
    const panned = applyPan(start, 100, 0);
    expect(worldToScreen({ x: 0, y: 0 }, start)).toEqual({ x: 0, y: 0 });
    expect(worldToScreen({ x: 0, y: 0 }, panned).x).toBeCloseTo(100);
    const anchor = { x: 200, y: 150 };
    const worldBefore = screenToWorld(anchor, start);
    const zoomed = applyWheelZoom(start, { deltaY: -120, cx: anchor.x, cy: anchor.y }, { width: 800, height: 600 });
    const worldAfter = screenToWorld(anchor, zoomed);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(zoomed.zoom).toBeGreaterThan(start.zoom);
    expect(cameraToCss(start)).toContain('scale(1)');
  });

  it('clamps zoom to [0.1, 8]', () => {
    expect(normalizeFrontHallCamera({ zoom: 99 }).zoom).toBe(8);
    expect(normalizeFrontHallCamera({ zoom: 0.001 }).zoom).toBe(0.1);
  });

  it('flies a frame origin near the viewport center', () => {
    const next = flyToFrame({ x: 0, y: 0, zoom: 1 }, { x: 1000, y: 0 }, { width: 800, height: 600 });
    const screen = worldToScreen({ x: 1000, y: 0 }, next);
    expect(Math.abs(screen.x - 400)).toBeLessThan(2);
    expect(Math.abs(screen.y - 300)).toBeLessThan(2);
  });

  it('hydrates only nodes inside the viewport margin', () => {
    const ids = visibleNodeIds({
      nodes: [{ id: 'near' }, { id: 'far' }],
      layout: { near: { x: 0, y: 0 }, far: { x: 10000, y: 0 } },
      camera: { x: 0, y: 0, zoom: 1 },
      viewport: { width: 800, height: 600 },
    });
    expect(ids).toEqual(['near']);
  });

  it('converts front-hall camera to InfiniteCanvas viewport and back', () => {
    const cam = normalizeFrontHallCamera({ x: 40, y: 80, zoom: 2 });
    const viewport = frontHallCameraToViewport(cam);
    expect(viewport.k).toBe(2);
    expect(viewport.x).toBe(-80);
    expect(viewport.y).toBe(-160);
    const round = viewportToFrontHallCamera(viewport);
    expect(round.x).toBeCloseTo(cam.x);
    expect(round.y).toBeCloseTo(cam.y);
    expect(round.zoom).toBeCloseTo(cam.zoom);
    const fly = flyToGroupViewport({ x: 0, y: 0, width: 100, height: 100 }, { width: 800, height: 600 });
    expect(Number.isFinite(fly.x)).toBe(true);
    expect(Number.isFinite(fly.y)).toBe(true);
    expect(fly.k).toBe(1);
  });

  it('round-trips the camera with the hung-root frame rel', () => {
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
    writeFrontHallCamera('D:/lib', { x: 40, y: 80, zoom: 2 }, 'maps');
    const saved = readFrontHallCamera('D:/lib');
    expect(saved?.x).toBeCloseTo(40);
    expect(saved?.y).toBeCloseTo(80);
    expect(saved?.zoom).toBeCloseTo(2);
    expect(saved?.frameRel).toBe('maps');
  });
});
