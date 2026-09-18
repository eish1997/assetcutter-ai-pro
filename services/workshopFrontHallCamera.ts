import { readLocalJson, writeLocalJson } from './clientPersist';

export const WORKSHOP_FRONT_HALL_ZOOM_MIN = 0.1;
export const WORKSHOP_FRONT_HALL_ZOOM_MAX = 8;
export const WORKSHOP_FRONT_HALL_CAMERA_KEY_PREFIX = 'workshopFrontHallCamera';

export type WorkshopFrontHallCamera = {
  x: number;
  y: number;
  zoom: number;
  frameRel?: string;
};

export function workshopFrontHallCameraStorageKey(root: string): string {
  return `${WORKSHOP_FRONT_HALL_CAMERA_KEY_PREFIX}:${String(root || '').trim()}`;
}

export function readFrontHallCamera(root: string): WorkshopFrontHallCamera | null {
  const raw = readLocalJson<WorkshopFrontHallCamera | null>(
    workshopFrontHallCameraStorageKey(root),
    null,
    (parsed) => {
      if (!parsed || typeof parsed !== 'object') return null;
      const cam = normalizeFrontHallCamera(parsed as WorkshopFrontHallCamera);
      const frameRel = String((parsed as WorkshopFrontHallCamera).frameRel || '');
      return { ...cam, frameRel };
    },
  );
  return raw;
}

export function writeFrontHallCamera(root: string, camera: WorkshopFrontHallCamera, frameRel?: string): void {
  const cam = normalizeFrontHallCamera(camera);
  writeLocalJson(workshopFrontHallCameraStorageKey(root), {
    ...cam,
      frameRel: String(frameRel ?? camera.frameRel ?? ''),
  });
}

export type WorkshopFrontHallViewport = {
  width: number;
  height: number;
};

function finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function normalizeFrontHallCamera(raw?: Partial<WorkshopFrontHallCamera> | null): WorkshopFrontHallCamera {
  const zoom = Math.min(
    WORKSHOP_FRONT_HALL_ZOOM_MAX,
    Math.max(WORKSHOP_FRONT_HALL_ZOOM_MIN, finite(raw?.zoom, 1)),
  );
  return {
    x: finite(raw?.x, 0),
    y: finite(raw?.y, 0),
    zoom,
  };
}

export function cameraToCss(camera: WorkshopFrontHallCamera): string {
  const cam = normalizeFrontHallCamera(camera);
  return `translate(${-cam.x * cam.zoom}px, ${-cam.y * cam.zoom}px) scale(${cam.zoom})`;
}

export function worldToScreen(
  world: { x: number; y: number },
  camera: WorkshopFrontHallCamera,
): { x: number; y: number } {
  const cam = normalizeFrontHallCamera(camera);
  return {
    x: (world.x - cam.x) * cam.zoom,
    y: (world.y - cam.y) * cam.zoom,
  };
}

export function screenToWorld(
  screen: { x: number; y: number },
  camera: WorkshopFrontHallCamera,
): { x: number; y: number } {
  const cam = normalizeFrontHallCamera(camera);
  return {
    x: screen.x / cam.zoom + cam.x,
    y: screen.y / cam.zoom + cam.y,
  };
}

export function applyPan(camera: WorkshopFrontHallCamera, dx: number, dy: number): WorkshopFrontHallCamera {
  const cam = normalizeFrontHallCamera(camera);
  return {
    ...cam,
    x: cam.x - finite(dx, 0) / cam.zoom,
    y: cam.y - finite(dy, 0) / cam.zoom,
  };
}

export function applyWheelZoom(
  camera: WorkshopFrontHallCamera,
  event: { deltaY: number; cx: number; cy: number },
  _viewport?: WorkshopFrontHallViewport,
): WorkshopFrontHallCamera {
  const cam = normalizeFrontHallCamera(camera);
  const world = screenToWorld({ x: finite(event.cx, 0), y: finite(event.cy, 0) }, cam);
  const factor = Math.exp(-finite(event.deltaY, 0) / 400);
  const zoom = Math.min(
    WORKSHOP_FRONT_HALL_ZOOM_MAX,
    Math.max(WORKSHOP_FRONT_HALL_ZOOM_MIN, cam.zoom * factor),
  );
  return {
    x: world.x - finite(event.cx, 0) / zoom,
    y: world.y - finite(event.cy, 0) / zoom,
    zoom,
  };
}

export function frontHallCameraToViewport(camera: WorkshopFrontHallCamera): {
  x: number;
  y: number;
  k: number;
} {
  const cam = normalizeFrontHallCamera(camera);
  return { x: -cam.x * cam.zoom, y: -cam.y * cam.zoom, k: cam.zoom };
}

export function viewportToFrontHallCamera(viewport: { x?: number; y?: number; k?: number }): WorkshopFrontHallCamera {
  const k = Math.min(
    WORKSHOP_FRONT_HALL_ZOOM_MAX,
    Math.max(WORKSHOP_FRONT_HALL_ZOOM_MIN, finite(viewport?.k, 1)),
  );
  return {
    x: -finite(viewport?.x, 0) / k,
    y: -finite(viewport?.y, 0) / k,
    zoom: k,
  };
}

export function flyToGroupViewport(
  groupRect: { x: number; y: number; width?: number; height?: number; w?: number; h?: number },
  viewSize: { width: number; height: number },
): { x: number; y: number; k: number } {
  const width = finite(groupRect.width ?? groupRect.w, 760);
  const height = finite(groupRect.height ?? groupRect.h, 480);
  const vw = Math.max(1, finite(viewSize.width, 1));
  const vh = Math.max(1, finite(viewSize.height, 1));
  return {
    x: vw / 2 - (finite(groupRect.x, 0) + width / 2),
    y: vh / 2 - (finite(groupRect.y, 0) + height / 2),
    k: 1,
  };
}

export function flyToFrame(
  camera: WorkshopFrontHallCamera,
  framePose: { x: number; y: number },
  viewport: WorkshopFrontHallViewport,
  _padding = 48,
): WorkshopFrontHallCamera {
  const cam = normalizeFrontHallCamera(camera);
  const vw = Math.max(1, finite(viewport.width, 1));
  const vh = Math.max(1, finite(viewport.height, 1));
  const targetX = finite(framePose.x, 0) - vw / 2 / cam.zoom;
  const targetY = finite(framePose.y, 0) - vh / 2 / cam.zoom;
  return { ...cam, x: targetX, y: targetY };
}

export function nodeWorldAabb(
  pose: { x: number; y: number },
  size = { width: 140, height: 100 },
): { x: number; y: number; w: number; h: number } {
  return { x: pose.x, y: pose.y, w: size.width, h: size.height };
}

export function visibleNodeIds(input: {
  nodes: Array<{ id: string }>;
  layout: Record<string, { x: number; y: number } | undefined | null>;
  camera: WorkshopFrontHallCamera;
  viewport: WorkshopFrontHallViewport;
  margin?: number;
  size?: { width: number; height: number };
}): string[] {
  const margin = finite(input.margin, 200);
  const vw = Math.max(0, finite(input.viewport.width, 0));
  const vh = Math.max(0, finite(input.viewport.height, 0));
  const cam = normalizeFrontHallCamera(input.camera);
  const size = input.size || { width: 140, height: 100 };
  return input.nodes
    .filter((node) => {
      const pose = input.layout[node.id];
      if (!pose) return false;
      const aabb = nodeWorldAabb(pose, size);
      const tl = worldToScreen({ x: aabb.x, y: aabb.y }, cam);
      const br = worldToScreen({ x: aabb.x + aabb.w, y: aabb.y + aabb.h }, cam);
      const left = Math.min(tl.x, br.x);
      const right = Math.max(tl.x, br.x);
      const top = Math.min(tl.y, br.y);
      const bottom = Math.max(tl.y, br.y);
      return right >= -margin && left <= vw + margin && bottom >= -margin && top <= vh + margin;
    })
    .map((node) => node.id);
}
