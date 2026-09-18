import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp } from 'antd';
import { I18nextProvider } from 'react-i18next';
import icI18n from '@ic/i18n';
import { InfiniteCanvas } from '@ic/components/canvas/infinite-canvas';
import { CanvasNode } from '@ic/components/canvas/canvas-node';
import { ActiveConnectionPath, ConnectionPath } from '@ic/components/canvas/canvas-connections';
import { CanvasToolbar } from '@ic/components/canvas/canvas-toolbar';
import { Minimap } from '@ic/components/canvas/canvas-mini-map';
import { CanvasZoomControls } from '@ic/components/canvas/canvas-zoom-controls';
import { ConnectionCreateMenu, NodeCreateMenu, type PendingConnectionCreate } from '@ic/components/canvas/canvas-create-menus';
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from '@ic/components/canvas/canvas-node-hover-toolbar';
import { CanvasSelectionToolbar } from '@ic/components/canvas/canvas-selection-toolbar';
import { CanvasNodeContextMenu } from '@ic/components/canvas/canvas-context-menu';
import { registerBuiltinNodes } from '@ic/components/canvas/nodes/builtin-nodes';
import { createCanvasNode } from '@ic/lib/canvas/canvas-node-factory';
import {
  applyGroupSelection,
  applyUngroupSelection,
  canGroupSelectedNodes,
  canUngroupSelectedNodes,
  findContainingGroupId,
  findGroupDropTarget,
  getConnectionTargetAnchor,
  normalizeConnection,
  snapNodesIntoGroup,
} from '@ic/lib/canvas/canvas-node-geometry';
import type { CanvasBackgroundMode } from '@ic/lib/canvas-theme';
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type ConnectionHandle,
  type ContextMenuState,
  type SelectionBox,
  type ViewportTransform,
} from '@ic/types/canvas';
import type { FrontHallViewFilter, WorkshopFrontHallBoardState, WorkshopFrontHallLayoutMap, WorkshopFrontHallToken } from '../../services/workshopFrontHall';
import {
  addFrontHallCanvasNode,
  boardStateToCanvasNodes,
  canvasNodesToLayout,
  connectFrontHallNodes,
  extraNodesFromLive,
  filterCanvasNodesForView,
  frontHallListingNodeIds,
  isFrontHallFolderFrame,
  mergeFrontHallLiveNodes,
  readWorkshopFrontHallGraph,
  writeWorkshopFrontHallGraph,
  type WorkshopFrontHallExtraNode,
} from '../../services/workshopFrontHallGraph';
import { ensureWorkshopFrontHallLayout, layoutBoardDefault, readWorkshopFrontHallLayout, writeWorkshopFrontHallLayout } from '../../services/workshopFrontHallLayout';
import { frontHallCameraToViewport, viewportToFrontHallCamera, type WorkshopFrontHallCamera } from '../../services/workshopFrontHallCamera';
import type { WorkshopFrontHallEdge } from '../../services/workshopFrontHall';

registerBuiltinNodes();

const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const HISTORY_LIMIT = 40;

type DragState = {
  isDraggingNode: boolean;
  hasMoved: boolean;
  startX: number;
  startY: number;
  initialSelectedNodes: Map<string, { x: number; y: number }>;
  movedIds: Set<string>;
};

type HistoryEntry = { nodes: CanvasNodeData[]; edges: WorkshopFrontHallEdge[] };

function cloneNodes(nodes: CanvasNodeData[]): CanvasNodeData[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    metadata: node.metadata ? { ...node.metadata } : undefined,
  }));
}

function withPreview(node: CanvasNodeData, preview?: string): CanvasNodeData {
  if (!preview) return node;
  return {
    ...node,
    metadata: {
      ...node.metadata,
      content: preview,
      images: [
        {
          id: `${node.id}:preview`,
          status: 'success',
          content: preview,
          naturalWidth: 0,
          naturalHeight: 0,
          bytes: 0,
          mimeType: 'image/jpeg',
        },
      ],
    },
  };
}

function nodeContentUrl(node: CanvasNodeData): string {
  const content = node.metadata && typeof node.metadata.content === 'string' ? node.metadata.content : '';
  if (content) return content;
  const image = node.metadata?.images?.find((item) => item.content);
  return image?.content || '';
}

function HostCanvas(props: {
  state: WorkshopFrontHallBoardState;
  layout?: WorkshopFrontHallLayoutMap | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  camera?: WorkshopFrontHallCamera | null;
  onCameraChange?: (camera: WorkshopFrontHallCamera) => void;
  tokens?: WorkshopFrontHallToken[];
  previewByNodeId?: Record<string, string>;
  onDragTokenToNode?: (tokenId: string, nodeId: string) => void;
  cameraFrameRel?: string;
  viewFilter?: FrontHallViewFilter | null;
}): React.ReactElement {
  const { message } = AntdApp.useApp();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const persisted = useMemo(() => readWorkshopFrontHallGraph(props.state.root), [props.state.root]);
  const listingIds = useMemo(() => frontHallListingNodeIds(props.state), [props.state]);
  const [liveNodes, setLiveNodes] = useState<CanvasNodeData[]>(() =>
    boardStateToCanvasNodes(props.state, ensureWorkshopFrontHallLayout(props.state, props.layout), persisted.extraNodes),
  );
  const [edges, setEdges] = useState(() => persisted.edges);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() =>
    props.selectedNodeId ? new Set([props.selectedNodeId]) : new Set(),
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(props.selectedNodeId);
  const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<ConnectionHandle | null>(null);
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 });
  const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [createPos, setCreatePos] = useState<{ x: number; y: number } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnectionCreate | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>('dots');
  const [showImageInfo, setShowImageInfo] = useState(false);
  const [miniMapOpen, setMiniMapOpen] = useState(true);
  const [internalViewport, setInternalViewport] = useState<ViewportTransform>(() =>
    frontHallCameraToViewport(props.camera || { x: 0, y: 0, zoom: 1 }),
  );
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [history, setHistory] = useState<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const dragTokenRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSelectionRef = useRef<Set<string> | null>(null);
  const nodeDraggingRef = useRef(false);
  const dragRef = useRef<DragState>({
    isDraggingNode: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    initialSelectedNodes: new Map(),
    movedIds: new Set(),
  });
  const liveRef = useRef(liveNodes);
  liveRef.current = liveNodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const selectedRef = useRef(selectedNodeIds);
  selectedRef.current = selectedNodeIds;
  const listingRef = useRef(listingIds);
  listingRef.current = listingIds;
  const connectingRef = useRef(connecting);
  connectingRef.current = connecting;
  const pendingConnectionRef = useRef(pendingConnection);
  pendingConnectionRef.current = pendingConnection;
  const selectionBoxRef = useRef(selectionBox);
  selectionBoxRef.current = selectionBox;
  const viewport = props.camera ? frontHallCameraToViewport(props.camera) : internalViewport;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  useEffect(() => {
    setLiveNodes((prev) =>
      mergeFrontHallLiveNodes(
        prev,
        boardStateToCanvasNodes(
          props.state,
          layoutBoardDefault(props.state, {
            ...readWorkshopFrontHallLayout(props.state.root),
            ...canvasNodesToLayout(prev),
          }),
          extraNodesFromLive(prev, frontHallListingNodeIds(props.state)),
        ),
      ),
    );
  }, [props.state]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setViewportSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const persistLive = useCallback(
    (nextNodes: CanvasNodeData[], nextEdges = edgesRef.current) => {
      const nextLayout = {
        ...readWorkshopFrontHallLayout(props.state.root),
        ...canvasNodesToLayout(nextNodes),
      };
      writeWorkshopFrontHallLayout(props.state.root, nextLayout);
      writeWorkshopFrontHallGraph(props.state.root, {
        ...readWorkshopFrontHallGraph(props.state.root),
        extraNodes: extraNodesFromLive(nextNodes, listingRef.current),
        edges: nextEdges,
      });
    },
    [props.state.root],
  );

  const pushHistory = useCallback((nodes: CanvasNodeData[], nextEdges = edgesRef.current) => {
    setHistory((prev) => ({
      past: [...prev.past, { nodes: cloneNodes(nodes), edges: nextEdges.map((edge) => ({ ...edge })) }].slice(-HISTORY_LIMIT),
      future: [],
    }));
  }, []);

  const commitNodes = useCallback(
    (nextNodes: CanvasNodeData[], nextEdges = edgesRef.current) => {
      pushHistory(liveRef.current, edgesRef.current);
      setLiveNodes(nextNodes);
      setEdges(nextEdges);
      persistLive(nextNodes, nextEdges);
    },
    [persistLive, pushHistory],
  );

  const setViewport = (next: ViewportTransform) => {
    if (!props.camera) setInternalViewport(next);
    props.onCameraChange?.(viewportToFrontHallCamera(next));
  };

  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const vp = viewportRef.current;
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - vp.x) / vp.k,
        y: (clientY - rect.top - vp.y) / vp.k,
      };
    },
    [],
  );

  const publishFinger = useCallback(
    (ids: Set<string>, clickedId?: string | null) => {
      setSelectedNodeIds(ids);
      if (ids.size === 1) {
        const id = [...ids][0];
        setToolbarNodeId(id);
        props.onSelectNode(id);
        return;
      }
      if (ids.size === 0) {
        setToolbarNodeId(null);
        props.onSelectNode(null);
        return;
      }
      const finger = clickedId && ids.has(clickedId) ? clickedId : toolbarNodeId && ids.has(toolbarNodeId) ? toolbarNodeId : [...ids][0];
      setToolbarNodeId(finger);
      props.onSelectNode(finger);
    },
    [props, toolbarNodeId],
  );

  const selectNodeByEvent = useCallback(
    (event: Pick<React.MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>, nodeId: string) => {
      const nextSelected = new Set(selectedRef.current);
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
        else nextSelected.add(nodeId);
      } else if (!nextSelected.has(nodeId)) {
        nextSelected.clear();
        nextSelected.add(nodeId);
      }
      publishFinger(nextSelected, nodeId);
      return nextSelected;
    },
    [publishFinger],
  );

  const startNodeDrag = useCallback(
    (event: React.MouseEvent, nodeId: string, nextSelected: Set<string>) => {
      const currentNodes = liveRef.current;
      const dragIds = new Set(nextSelected);
      currentNodes.forEach((node) => {
        if (!nextSelected.has(node.id)) return;
        if (node.type === CanvasNodeType.Group) {
          currentNodes.forEach((child) => {
            if (child.metadata?.groupId === node.id) dragIds.add(child.id);
          });
        }
      });
      const initialSelectedNodes = new Map(
        currentNodes.filter((node) => dragIds.has(node.id)).map((node): [string, { x: number; y: number }] => [node.id, { x: node.position.x, y: node.position.y }]),
      );
      dragRef.current = {
        isDraggingNode: true,
        hasMoved: false,
        startX: event.clientX,
        startY: event.clientY,
        initialSelectedNodes,
        movedIds: new Set(initialSelectedNodes.keys()),
      };
      nodeDraggingRef.current = true;
    },
    [],
  );

  const handleNodeSelectCapture = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      if (event.button !== 0) return;
      setContextMenu(null);
      setHoveredNodeId(null);
      setSelectedConnectionId(null);
      const nextSelected = selectNodeByEvent(event, nodeId);
      pendingSelectionRef.current = nextSelected;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,[contenteditable="true"]')) return;
      startNodeDrag(event, nodeId, nextSelected);
    },
    [selectNodeByEvent, startNodeDrag],
  );

  const handleNodeMouseDown = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      event.stopPropagation();
      const nextSelected = pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId);
      pendingSelectionRef.current = null;
      startNodeDrag(event, nodeId, nextSelected);
    },
    [selectNodeByEvent, startNodeDrag],
  );

  const finishNodeDrag = useCallback(
    (clientX?: number, clientY?: number) => {
      if (!dragRef.current.isDraggingNode) return;
      const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / viewportRef.current.k;
      const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / viewportRef.current.k;
      const initialPositions = dragRef.current.initialSelectedNodes;
      const movedIds = dragRef.current.movedIds;
      const moved = dragRef.current.hasMoved;
      dragRef.current.isDraggingNode = false;
      dragRef.current.hasMoved = false;
      nodeDraggingRef.current = false;
      setDropTargetGroupId(null);
      if (!moved) return;
      setLiveNodes((prev) => {
        const preview = prev.map((node) => {
          const initial = initialPositions.get(node.id);
          return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
        });
        const listing = listingRef.current;
        const extraMoved = new Set([...movedIds].filter((id) => !listing.has(id)));
        const targetGroup = extraMoved.size ? findGroupDropTarget(extraMoved, preview) : null;
        const next = targetGroup
          ? snapNodesIntoGroup(extraMoved, preview, targetGroup)
          : preview.map((node) => {
              if (!extraMoved.has(node.id) || node.type === CanvasNodeType.Group) return node;
              const groupId = findContainingGroupId(node, preview);
              if (node.metadata?.groupId === groupId) return node;
              return { ...node, metadata: { ...node.metadata, groupId } };
            });
        persistLive(next);
        return next;
      });
    },
    [persistLive],
  );

  const getConnectionDropTarget = useCallback(
    (clientX: number, clientY: number, current: ConnectionHandle) => {
      const world = screenToCanvas(clientX, clientY);
      const scale = Math.max(viewportRef.current.k, 0.05);
      const padding = CONNECTION_NODE_HIT_PADDING / scale;
      const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
      let isNearNode = false;
      let bestNodeId: string | null = null;
      let bestPriority = Number.POSITIVE_INFINITY;
      [...liveRef.current].reverse().forEach((node) => {
        const anchor = getConnectionTargetAnchor(node, current);
        const dx = world.x - anchor.x;
        const dy = world.y - anchor.y;
        const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
        const hitsInside =
          world.x >= node.position.x &&
          world.x <= node.position.x + node.width &&
          world.y >= node.position.y &&
          world.y <= node.position.y + node.height;
        const hitsExpanded =
          world.x >= node.position.x - padding &&
          world.x <= node.position.x + node.width + padding &&
          world.y >= node.position.y - padding &&
          world.y <= node.position.y + node.height + padding;
        if (!hitsHandle && !hitsInside && !hitsExpanded) return;
        isNearNode = true;
        if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, liveRef.current, current.handleType)) return;
        const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
        if (priority < bestPriority) {
          bestNodeId = node.id;
          bestPriority = priority;
        }
      });
      return { nodeId: bestNodeId, isNearNode };
    },
    [screenToCanvas],
  );

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.isDraggingNode) {
        const dx = (event.clientX - drag.startX) / viewportRef.current.k;
        const dy = (event.clientY - drag.startY) / viewportRef.current.k;
        if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) drag.hasMoved = true;
        const initialPositions = drag.initialSelectedNodes;
        setLiveNodes((prev) =>
          prev.map((node) => {
            const initial = initialPositions.get(node.id);
            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
          }),
        );
        const preview = liveRef.current.map((node) => {
          const initial = initialPositions.get(node.id);
          return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
        });
        const extraMoved = new Set([...drag.movedIds].filter((id) => !listingRef.current.has(id)));
        setDropTargetGroupId(extraMoved.size ? findGroupDropTarget(extraMoved, preview)?.id || null : null);
        return;
      }
      const currentConnection = connectingRef.current;
      if (currentConnection && !pendingConnectionRef.current) {
        const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
        setConnectionTargetNodeId(dropTarget.nodeId);
        setMouseWorld(screenToCanvas(event.clientX, event.clientY));
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const currentSelection = selectionBoxRef.current;
      if (!currentSelection) return;
      if (event.buttons === 0) {
        selectionBoxRef.current = null;
        setSelectionBox(null);
        return;
      }
      const world = screenToCanvas(event.clientX, event.clientY);
      const rectX = Math.min(currentSelection.startWorldX, world.x);
      const rectY = Math.min(currentSelection.startWorldY, world.y);
      const rectW = Math.abs(world.x - currentSelection.startWorldX);
      const rectH = Math.abs(world.y - currentSelection.startWorldY);
      const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);
      liveRef.current.forEach((node) => {
        const intersects =
          rectX < node.position.x + node.width &&
          rectX + rectW > node.position.x &&
          rectY < node.position.y + node.height &&
          rectY + rectH > node.position.y;
        if (intersects) nextSelected.add(node.id);
      });
      const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
      selectionBoxRef.current = nextSelectionBox;
      setSelectionBox(nextSelectionBox);
      publishFinger(nextSelected);
    };
    const onUp = (event: MouseEvent) => {
      finishNodeDrag(event.clientX, event.clientY);
      selectionBoxRef.current = null;
      setSelectionBox(null);
      if (pendingConnectionRef.current) return;
      const currentConnection = connectingRef.current;
      if (!currentConnection) return;
      const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
      if (dropTarget.nodeId) {
        const connection = normalizeConnection(
          currentConnection.nodeId,
          dropTarget.nodeId,
          liveRef.current,
          currentConnection.handleType,
        );
        const next = connection
          ? connectFrontHallNodes(edgesRef.current, connection.fromNodeId, connection.toNodeId)
          : edgesRef.current;
        commitNodes(liveRef.current, next);
        setConnecting(null);
        setConnectionTargetNodeId(null);
      } else if (dropTarget.isNearNode) {
        setConnecting(null);
        setConnectionTargetNodeId(null);
      } else {
        setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        setPendingConnection({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [commitNodes, finishNodeDrag, getConnectionDropTarget, publishFinger, screenToCanvas]);

  const centerPose = useCallback(() => {
    const vp = viewportRef.current;
    return {
      x: (-vp.x + viewportSize.width / 2) / vp.k - 170,
      y: (-vp.y + viewportSize.height / 2) / vp.k - 120,
    };
  }, [viewportSize.height, viewportSize.width]);

  const addNodeAt = useCallback(
    (kind: 'image' | 'video' | 'text' | 'audio', pose?: { x: number; y: number }) => {
      const extra = addFrontHallCanvasNode({
        root: props.state.root,
        folderRel: props.cameraFrameRel || '',
        kind,
        originPose: pose || centerPose(),
        now: Date.now(),
      });
      commitNodes([...liveRef.current, extra]);
      publishFinger(new Set([extra.id]), extra.id);
    },
    [centerPose, commitNodes, props.cameraFrameRel, props.state.root, publishFinger],
  );

  const deleteSelected = useCallback(() => {
    const listing = listingRef.current;
    const extraIds = new Set([...selectedRef.current].filter((id) => !listing.has(id)));
    if (selectedConnectionId && !extraIds.size) {
      const nextEdges = edgesRef.current.filter((edge) => edge.id !== selectedConnectionId);
      commitNodes(liveRef.current, nextEdges);
      setSelectedConnectionId(null);
      return;
    }
    if (!extraIds.size) return;
    const nextNodes = liveRef.current
      .filter((node) => !extraIds.has(node.id))
      .map((node) =>
        node.metadata?.groupId && extraIds.has(node.metadata.groupId)
          ? { ...node, metadata: { ...node.metadata, groupId: undefined } }
          : node,
      );
    const nextEdges = edgesRef.current.filter((edge) => !extraIds.has(edge.fromNodeId) && !extraIds.has(edge.toNodeId));
    commitNodes(nextNodes, nextEdges);
    publishFinger(new Set());
    setSelectedConnectionId(null);
    setHoveredNodeId((current) => (current && extraIds.has(current) ? null : current));
    setContextMenu(null);
  }, [commitNodes, publishFinger, selectedConnectionId]);

  const groupSelection = useCallback(() => {
    const extras = liveRef.current.filter((node) => selectedRef.current.has(node.id) && !listingRef.current.has(node.id) && node.type !== CanvasNodeType.Group);
    if (extras.length < 2) return;
    const ids = new Set(extras.map((node) => node.id));
    if (!canGroupSelectedNodes(ids, liveRef.current)) return;
    const created = createCanvasNode(CanvasNodeType.Group, { x: 0, y: 0 });
    const result = applyGroupSelection(ids, liveRef.current, edgesRef.current, created);
    if (!result) return;
    commitNodes(result.nodes, result.connections);
    publishFinger(new Set(result.selectedIds), result.selectedIds[0]);
  }, [commitNodes, publishFinger]);

  const ungroupSelection = useCallback(() => {
    const extraGroups = new Set(
      liveRef.current
        .filter((node) => selectedRef.current.has(node.id) && node.type === CanvasNodeType.Group && !isFrontHallFolderFrame(node))
        .map((node) => node.id),
    );
    if (!extraGroups.size && !liveRef.current.some((node) => selectedRef.current.has(node.id) && node.metadata?.groupId && !listingRef.current.has(node.id))) {
      return;
    }
    const result = applyUngroupSelection(selectedRef.current, liveRef.current, edgesRef.current);
    if (!result) return;
    const nextNodes = result.nodes.filter((node) => !isFrontHallFolderFrame(node) || listingRef.current.has(node.id));
    commitNodes(nextNodes, result.connections);
    publishFinger(new Set(result.selectedIds.filter((id) => nextNodes.some((node) => node.id === id))));
  }, [commitNodes, publishFinger]);

  const duplicateSelected = useCallback(() => {
    const listing = listingRef.current;
    const copies: WorkshopFrontHallExtraNode[] = extraNodesFromLive(liveRef.current, listing)
      .filter((node) => selectedRef.current.has(node.id))
      .map((node, index) => ({
        ...node,
        id: `board:${props.state.root}:copy:${Date.now()}:${index}`,
        position: { x: node.position.x + 36, y: node.position.y + 36 },
      }));
    if (!copies.length) return;
    commitNodes([...liveRef.current, ...copies]);
    publishFinger(new Set(copies.map((node) => node.id)), copies[0].id);
  }, [commitNodes, props.state.root, publishFinger]);

  const undoCanvas = useCallback(() => {
    setHistory((prev) => {
      const last = prev.past[prev.past.length - 1];
      if (!last) return prev;
      persistLive(last.nodes, last.edges);
      setLiveNodes(cloneNodes(last.nodes));
      setEdges(last.edges.map((edge) => ({ ...edge })));
      return {
        past: prev.past.slice(0, -1),
        future: [{ nodes: cloneNodes(liveRef.current), edges: edgesRef.current.map((edge) => ({ ...edge })) }, ...prev.future],
      };
    });
  }, [persistLive]);

  const redoCanvas = useCallback(() => {
    setHistory((prev) => {
      const next = prev.future[0];
      if (!next) return prev;
      persistLive(next.nodes, next.edges);
      setLiveNodes(cloneNodes(next.nodes));
      setEdges(next.edges.map((edge) => ({ ...edge })));
      return {
        past: [...prev.past, { nodes: cloneNodes(liveRef.current), edges: edgesRef.current.map((edge) => ({ ...edge })) }],
        future: prev.future.slice(1),
      };
    });
  }, [persistLive]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        target?.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoCanvas();
        else undoCanvas();
        return;
      }
      if (mod && !event.altKey && key === 'y') {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (mod && !event.altKey && key === 'a') {
        event.preventDefault();
        publishFinger(new Set(liveRef.current.map((node) => node.id)));
        return;
      }
      if (mod && !event.altKey && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (mod && !event.altKey && key === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === 'Escape') {
        publishFinger(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setCreatePos(null);
        setConnecting(null);
        setPendingConnection(null);
        setHoveredNodeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, duplicateSelected, groupSelection, publishFinger, redoCanvas, undoCanvas, ungroupSelection]);

  const zoomAroundCenter = (k: number) => {
    const cx = viewportSize.width / 2;
    const cy = viewportSize.height / 2;
    const worldX = (cx - viewport.x) / viewport.k;
    const worldY = (cy - viewport.y) / viewport.k;
    setViewport({ x: cx - worldX * k, y: cy - worldY * k, k });
  };

  const visibleDerived = useMemo(() => filterCanvasNodesForView(liveNodes, props.viewFilter), [liveNodes, props.viewFilter]);
  const viewBounds = useMemo(() => {
    const padding = 280;
    const left = -viewport.x / viewport.k - padding;
    const top = -viewport.y / viewport.k - padding;
    return {
      left,
      top,
      right: left + viewportSize.width / viewport.k + padding * 2,
      bottom: top + viewportSize.height / viewport.k + padding * 2,
    };
  }, [viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
  const nodes = useMemo(
    () =>
      visibleDerived.filter(
        (node) =>
          node.position.x + node.width > viewBounds.left &&
          node.position.x < viewBounds.right &&
          node.position.y + node.height > viewBounds.top &&
          node.position.y < viewBounds.bottom,
      ),
    [viewBounds, visibleDerived],
  );
  const nodeById = useMemo(() => new Map(liveNodes.map((node) => [node.id, node])), [liveNodes]);
  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const connections: CanvasConnection[] = edges
    .filter((edge) => visibleIds.has(edge.fromNodeId) && visibleIds.has(edge.toNodeId))
    .map((edge) => ({ id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId }));
  const groupChildCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of liveNodes) {
      const groupId = node.metadata?.groupId;
      if (!groupId) continue;
      counts.set(groupId, (counts.get(groupId) || 0) + 1);
    }
    return counts;
  }, [liveNodes]);
  const hovered = hoveredNodeId ? nodeById.get(hoveredNodeId) || null : null;
  const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
  const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
  const selectedNodes = liveNodes.filter((node) => selectedNodeIds.has(node.id));
  const canGroup = canGroupSelectedNodes(
    new Set(selectedNodes.filter((node) => !listingIds.has(node.id) && node.type !== CanvasNodeType.Group).map((node) => node.id)),
    liveNodes,
  );
  const canUngroup = selectedNodes.some((node) => !isFrontHallFolderFrame(node) && (node.type === CanvasNodeType.Group || (Boolean(node.metadata?.groupId) && !listingIds.has(node.id))));
  const generationDisabled = () => message.info('前厅画板不走原版生成通道');

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    const origin = screenToCanvas(event.clientX, event.clientY);
    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = () => {
        const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'text';
        const extra = addFrontHallCanvasNode({
          root: props.state.root,
          folderRel: props.cameraFrameRel || '',
          kind,
          originPose: { x: origin.x + index * 24, y: origin.y + index * 24 },
          now: Date.now() + index,
        });
        extra.title = file.name;
        extra.metadata = { ...extra.metadata, content: String(reader.result || ''), status: 'success' };
        commitNodes([...liveRef.current, extra]);
      };
      reader.readAsDataURL(file);
    });
  };

  return (
      <div className="relative min-h-0 w-full flex-1" style={{ height: '100%' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.txt,.md"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'text';
              const extra = addFrontHallCanvasNode({
                root: props.state.root,
                folderRel: props.cameraFrameRel || '',
                kind,
                originPose: centerPose(),
                now: Date.now(),
              });
              extra.title = file.name;
              extra.metadata = { ...extra.metadata, content: String(reader.result || ''), status: 'success' };
              commitNodes([...liveRef.current, extra]);
              publishFinger(new Set([extra.id]), extra.id);
            };
            reader.readAsDataURL(file);
          }}
        />
        <InfiniteCanvas
          containerRef={containerRef}
          viewport={viewport}
          tool={tool}
          backgroundMode={backgroundMode}
          onViewportChange={(next) => {
            setViewport(next);
            setContextMenu(null);
          }}
          onCanvasDeselect={() => {
            publishFinger(new Set());
            setSelectedConnectionId(null);
            setContextMenu(null);
            setCreatePos(null);
          }}
          onCanvasDoubleClick={(event) => {
            setContextMenu(null);
            setCreatePos(screenToCanvas(event.clientX, event.clientY));
          }}
          onContextMenu={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <svg
            data-front-hall-edges
            className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible"
            style={{ pointerEvents: 'none', transform: 'translateZ(0)', zIndex: 0 }}
          >
            {connections.map((connection) => {
              const from = nodeById.get(connection.fromNodeId);
              const to = nodeById.get(connection.toNodeId);
              if (!from || !to) return null;
              return (
                <ConnectionPath
                  key={connection.id}
                  connection={connection}
                  from={from}
                  to={to}
                  active={selectedConnectionId === connection.id}
                  onSelect={() => {
                    setSelectedConnectionId(connection.id);
                    publishFinger(new Set());
                    setContextMenu(null);
                  }}
                  onContextMenu={(event) => {
                    setSelectedConnectionId(connection.id);
                    publishFinger(new Set());
                    setContextMenu({ type: 'connection', x: event.clientX, y: event.clientY, connectionId: connection.id });
                  }}
                />
              );
            })}
            {connecting ? (
              <ActiveConnectionPath
                node={nodeById.get(connecting.nodeId)}
                handle={connecting}
                mouseWorld={mouseWorld}
                target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined}
              />
            ) : null}
          </svg>
          {nodes.map((node) => {
            const folderRel =
              node.type === CanvasNodeType.Group && node.metadata && 'folderRel' in node.metadata
                ? String((node.metadata as { folderRel?: string }).folderRel || '')
                : undefined;
            const data = withPreview(node, props.previewByNodeId?.[node.id]);
            return (
              <div
                key={node.id}
                data-front-hall-node={node.id}
                data-front-hall-frame={folderRel}
                data-front-hall-preview-src={props.previewByNodeId?.[node.id]}
                data-front-hall-x={node.position.x}
                data-front-hall-y={node.position.y}
                data-front-hall-selected={selectedNodeIds.has(node.id) ? '1' : undefined}
                className="contents"
                onPointerUp={() => {
                  const tokenId = dragTokenRef.current;
                  dragTokenRef.current = null;
                  if (tokenId) props.onDragTokenToNode?.(tokenId, node.id);
                }}
              >
                <CanvasNode
                  data={data}
                  scale={viewport.k}
                  isSelected={selectedNodeIds.has(node.id)}
                  isRelated={false}
                  isFocusRelated={toolbarNodeId === node.id}
                  isConnectionTarget={connectionTargetNodeId === node.id}
                  isConnecting={Boolean(connecting)}
                  showPanel={false}
                  showImageInfo={showImageInfo}
                  groupChildCount={groupChildCountById.get(node.id) || 0}
                  isGroupDropTarget={dropTargetGroupId === node.id}
                  onMouseDown={handleNodeMouseDown}
                  onSelectCapture={handleNodeSelectCapture}
                  onHoverStart={(nodeId) => {
                    if (nodeDraggingRef.current) return;
                    setHoveredNodeId(nodeId);
                  }}
                  onHoverEnd={(nodeId) => setHoveredNodeId((current) => (current === nodeId ? null : current))}
                  onConnectStart={(event, nodeId, handleType) => {
                    event.stopPropagation();
                    dragRef.current.isDraggingNode = false;
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setConnecting({ nodeId, handleType });
                    setConnectionTargetNodeId(null);
                    setSelectedConnectionId(null);
                  }}
                  onResizeStart={() => undefined}
                  onResize={(nodeId, width, height, position) => {
                    setLiveNodes((prev) =>
                      prev.map((item) => (item.id === nodeId ? { ...item, width, height, position: position || item.position } : item)),
                    );
                  }}
                  onResizeEnd={() => persistLive(liveRef.current)}
                  onContentChange={(nodeId, content) => {
                    setLiveNodes((prev) =>
                      prev.map((item) =>
                        item.id === nodeId ? { ...item, metadata: { ...item.metadata, content } } : item,
                      ),
                    );
                    persistLive(
                      liveRef.current.map((item) =>
                        item.id === nodeId ? { ...item, metadata: { ...item.metadata, content } } : item,
                      ),
                    );
                  }}
                  onTitleChange={(nodeId, title) => {
                    setLiveNodes((prev) => prev.map((item) => (item.id === nodeId ? { ...item, title } : item)));
                    persistLive(liveRef.current.map((item) => (item.id === nodeId ? { ...item, title } : item)));
                  }}
                  onViewImage={(item) => setPreviewNodeId(item.id)}
                  onContextMenu={(event, nodeId) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!selectedRef.current.has(nodeId)) publishFinger(new Set([nodeId]), nodeId);
                    setContextMenu({ type: 'node', x: event.clientX, y: event.clientY, nodeId });
                  }}
                />
              </div>
            );
          })}
          {(props.tokens || []).map((token) => {
            const host = nodeById.get(token.nodeId);
            if (!host || !visibleIds.has(host.id)) return null;
            return (
              <button
                key={token.id}
                type="button"
                data-front-hall-token={token.id}
                className="absolute z-[80] rounded bg-black/70 px-1 text-[10px] text-white"
                style={{ left: host.position.x + 8, top: host.position.y + 8 }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  dragTokenRef.current = token.id;
                }}
              >
                token
              </button>
            );
          })}
          {selectionBox ? (
            <div
              className="pointer-events-none absolute border border-[#2f80ff] bg-[#2f80ff]/15"
              style={{
                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
              }}
            />
          ) : null}
          {createPos ? (
            <NodeCreateMenu
              position={createPos}
              onCreate={(kind) => {
                const mapped =
                  kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : kind === 'image' ? 'image' : 'text';
                addNodeAt(mapped, createPos);
                setCreatePos(null);
              }}
              onClose={() => setCreatePos(null)}
            />
          ) : null}
          {pendingConnection ? (
            <ConnectionCreateMenu
              pending={pendingConnection}
              onCreate={(type) => {
                const mapped =
                  type === CanvasNodeType.Video
                    ? 'video'
                    : type === CanvasNodeType.Audio
                      ? 'audio'
                      : type === CanvasNodeType.Image
                        ? 'image'
                        : 'text';
                const extra = addFrontHallCanvasNode({
                  root: props.state.root,
                  folderRel: props.cameraFrameRel || '',
                  kind: mapped,
                  originPose: pendingConnection.position,
                  now: Date.now(),
                });
                const connection = normalizeConnection(
                  pendingConnection.connection.nodeId,
                  extra.id,
                  [...liveRef.current, extra],
                  pendingConnection.connection.handleType,
                );
                const nextEdges = connection
                  ? connectFrontHallNodes(edgesRef.current, connection.fromNodeId, connection.toNodeId)
                  : edgesRef.current;
                commitNodes([...liveRef.current, extra], nextEdges);
                publishFinger(new Set([extra.id]), extra.id);
                setPendingConnection(null);
                setConnecting(null);
              }}
              onClose={() => {
                setPendingConnection(null);
                setConnecting(null);
              }}
            />
          ) : null}
        </InfiniteCanvas>
        <CanvasToolbar
          selectedCount={selectedNodeIds.size}
          canvasTool={tool}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          backgroundMode={backgroundMode}
          showImageInfo={showImageInfo}
          onAddImage={() => addNodeAt('image')}
          onAddVideo={() => addNodeAt('video')}
          onAddAudio={() => addNodeAt('audio')}
          onAddText={() => addNodeAt('text')}
          onAddConfig={generationDisabled}
          onAddGroup={() => {
            const created = createCanvasNode(CanvasNodeType.Group, {
              x: centerPose().x + 380,
              y: centerPose().y + 240,
            });
            commitNodes([...liveRef.current, created]);
            publishFinger(new Set([created.id]), created.id);
          }}
          onAddExtensionNode={generationDisabled}
          onUndo={undoCanvas}
          onRedo={redoCanvas}
          onUpload={() => fileInputRef.current?.click()}
          onDelete={deleteSelected}
          onClear={() => {
            const listing = listingRef.current;
            commitNodes(
              liveRef.current.filter((node) => listing.has(node.id)),
              [],
            );
            publishFinger(new Set());
          }}
          onCanvasToolChange={setTool}
          onBackgroundModeChange={setBackgroundMode}
          onShowImageInfoChange={setShowImageInfo}
        />
        {miniMapOpen ? (
          <Minimap nodes={liveNodes} viewport={viewport} viewportSize={viewportSize} onViewportChange={setViewport} />
        ) : null}
        <CanvasZoomControls
          scale={viewport.k}
          onScaleChange={zoomAroundCenter}
          onReset={() => setViewport({ x: 0, y: 0, k: 1 })}
          isMiniMapOpen={miniMapOpen}
          onToggleMiniMap={() => setMiniMapOpen((open) => !open)}
        />
        <CanvasSelectionToolbar
          nodes={selectedNodes}
          viewport={viewport}
          showToolbar={selectedNodeIds.size > 1 && !selectionBox}
          canGroup={canGroup}
          canUngroup={canUngroup}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
        />
        {contextMenu ? (
          <CanvasNodeContextMenu
            menu={contextMenu}
            canCaptureVideoFrame={false}
            onClose={() => setContextMenu(null)}
            onCaptureVideoFrame={() => undefined}
            onDuplicate={() => {
              duplicateSelected();
              setContextMenu(null);
            }}
            onDelete={() => {
              if (contextMenu.type === 'connection') {
                commitNodes(
                  liveRef.current,
                  edgesRef.current.filter((edge) => edge.id !== contextMenu.connectionId),
                );
                setSelectedConnectionId(null);
              } else deleteSelected();
              setContextMenu(null);
            }}
          />
        ) : null}
        <CanvasNodeHoverToolbar
          node={hovered}
          viewport={viewport}
          onKeep={() => undefined}
          onLeave={() => setHoveredNodeId(null)}
          onInfo={(node) => setInfoNodeId(node.id)}
          onDecreaseFont={(node) => {
            const next = liveRef.current.map((item) =>
              item.id === node.id
                ? { ...item, metadata: { ...item.metadata, fontSize: Math.max(12, Number(item.metadata?.fontSize || 16) - 2) } }
                : item,
            );
            commitNodes(next);
          }}
          onIncreaseFont={(node) => {
            const next = liveRef.current.map((item) =>
              item.id === node.id
                ? { ...item, metadata: { ...item.metadata, fontSize: Number(item.metadata?.fontSize || 16) + 2 } }
                : item,
            );
            commitNodes(next);
          }}
          onToggleDialog={generationDisabled}
          onGenerateImage={generationDisabled}
          onUpload={() => fileInputRef.current?.click()}
          onDownload={(node) => {
            const url = nodeContentUrl(node) || props.previewByNodeId?.[node.id];
            if (!url) {
              message.info('这个节点没有可下载的内容');
              return;
            }
            const link = document.createElement('a');
            link.href = url;
            link.download = node.title || 'node';
            link.click();
          }}
          onSaveAsset={generationDisabled}
          onMaskEdit={generationDisabled}
          onCrop={generationDisabled}
          onSplit={generationDisabled}
          onAngle={generationDisabled}
          onUpscale={generationDisabled}
          onSuperResolve={generationDisabled}
          onViewImage={(node) => setPreviewNodeId(node.id)}
          onReversePrompt={generationDisabled}
          onRetry={generationDisabled}
          onToggleFreeResize={(node) => {
            const next = liveRef.current.map((item) =>
              item.id === node.id ? { ...item, metadata: { ...item.metadata, freeResize: !item.metadata?.freeResize } } : item,
            );
            commitNodes(next);
          }}
          onDelete={(node) => {
            publishFinger(new Set([node.id]), node.id);
            deleteSelected();
          }}
          onUngroup={ungroupSelection}
        />
        {infoNode ? <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} /> : null}
        {previewNode ? (
          <button
            type="button"
            className="absolute inset-0 z-[200] flex items-center justify-center bg-black/70"
            onClick={() => setPreviewNodeId(null)}
          >
            <img
              alt={previewNode.title}
              src={nodeContentUrl(previewNode) || props.previewByNodeId?.[previewNode.id] || ''}
              className="max-h-[80%] max-w-[80%] object-contain"
            />
          </button>
        ) : null}
      </div>
  );
}

export function WorkshopFrontHallCanvasHost(props: React.ComponentProps<typeof HostCanvas>): React.ReactElement {
  return (
    <I18nextProvider i18n={icI18n}>
      <AntdApp className="flex h-full min-h-0 flex-col" style={{ height: '100%' }}>
        <HostCanvas {...props} />
      </AntdApp>
    </I18nextProvider>
  );
}
