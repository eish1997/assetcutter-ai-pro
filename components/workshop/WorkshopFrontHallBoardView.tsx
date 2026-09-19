import React, { useEffect, useMemo, useRef } from 'react';
import {
  workshopFrontHallFrameId,
  type FrontHallViewFilter,
  type WorkshopFrontHallBoardState,
  type WorkshopFrontHallLayoutMap,
} from '../../services/workshopFrontHall';
import {
  flyToFrame,
  normalizeFrontHallCamera,
  readFrontHallCamera,
  writeFrontHallCamera,
  type WorkshopFrontHallCamera,
} from '../../services/workshopFrontHallCamera';
import { ensureWorkshopFrontHallLayout } from '../../services/workshopFrontHallLayout';
import { workshopFrontHallHotkey } from '../../services/workshopFrontHallHotkeys';
import { WorkshopFrontHallCanvasHost } from './WorkshopFrontHallCanvasHost';

export function WorkshopFrontHallBoardView(props: {
  state: WorkshopFrontHallBoardState;
  cameraFrameRel: string;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  layout?: WorkshopFrontHallLayoutMap | null;
  camera?: WorkshopFrontHallCamera | null;
  onCameraChange?: (camera: WorkshopFrontHallCamera) => void;
  onDragTokenToNode?: (tokenId: string, nodeId: string) => void;
  onF3Add?: () => void;
  onF3Remove?: () => void;
  hotkeysEnabled?: boolean;
  previewByNodeId?: Record<string, string>;
  viewFilter?: FrontHallViewFilter | null;
}): React.ReactElement {
  const cameraRel = String(props.cameraFrameRel || '');
  const layout = useMemo(() => ensureWorkshopFrontHallLayout(props.state, props.layout), [props.state, props.layout]);
  const [internalCamera, setInternalCamera] = React.useState(() => {
    const saved = readFrontHallCamera(props.state.root);
    if (saved && String(saved.frameRel || '') === cameraRel) return normalizeFrontHallCamera(saved);
    return normalizeFrontHallCamera(props.camera);
  });
  const camera = props.camera ? normalizeFrontHallCamera(props.camera) : internalCamera;
  const setCamera = (next: WorkshopFrontHallCamera) => {
    const cam = normalizeFrontHallCamera(next);
    if (!props.camera) setInternalCamera(cam);
    writeFrontHallCamera(props.state.root, cam, cameraRel);
    props.onCameraChange?.(cam);
  };
  const lastFlyRel = useRef<string | null>(null);
  const lastFlySize = useRef<string>('');
  const lastFlyReal = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [viewSize, setViewSize] = React.useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 80 || rect.height < 80) return;
      setViewSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const size = viewSize && viewSize.width >= 80 && viewSize.height >= 80 ? viewSize : { width: 800, height: 600 };
    const sizeKey = `${Math.round(size.width)}x${Math.round(size.height)}`;
    const real = Boolean(viewSize && viewSize.width >= 80);
    if (lastFlyRel.current === cameraRel && (lastFlySize.current === sizeKey || (lastFlyReal.current && !real))) return;
    lastFlyRel.current = cameraRel;
    lastFlySize.current = sizeKey;
    lastFlyReal.current = real;
    const saved = readFrontHallCamera(props.state.root);
    if (saved && String(saved.frameRel || '') === cameraRel) {
      setCamera(saved);
      return;
    }
    const frameId = workshopFrontHallFrameId(props.state.root, cameraRel);
    const pose = layout[frameId];
    if (!pose) return;
    setCamera(flyToFrame(camera, pose, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fly once per folder after a real measure
  }, [cameraRel, layout, props.state.root, viewSize]);

  useEffect(() => {
    if (props.hotkeysEnabled === false) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const action = workshopFrontHallHotkey(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'f3-add') props.onF3Add?.();
      else props.onF3Remove?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.hotkeysEnabled, props.onF3Add, props.onF3Remove]);

  return (
    <div
      ref={boardRef}
      data-front-hall-board
      data-front-hall-viewport
      data-front-hall-camera-frame={cameraRel}
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-[#0f0f12]"
    >
      <div className="min-h-0 flex-1" style={{ height: '100%' }}>
      <WorkshopFrontHallCanvasHost
        state={props.state}
        layout={layout}
        selectedNodeId={props.selectedNodeId}
        onSelectNode={props.onSelectNode}
        camera={camera}
        onCameraChange={setCamera}
        tokens={props.state.tokens}
        previewByNodeId={props.previewByNodeId}
        onDragTokenToNode={props.onDragTokenToNode}
        cameraFrameRel={cameraRel}
        viewFilter={props.viewFilter}
      />
      </div>
    </div>
  );
}
