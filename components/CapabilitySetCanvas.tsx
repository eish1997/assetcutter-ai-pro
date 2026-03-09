import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  getBezierPath,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type EdgeProps,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './CapabilitySetCanvas.css';
import type { CustomAppModule } from '../types';
import type { CapabilitySet, CapabilitySetNode, CapabilitySetEdge } from '../types';

const genId = () => Math.random().toString(36).slice(2, 11);

/** 节点：去掉 nodrag 使整块可拖拽移动 */
const PresetNode: React.FC<{ data: { label: string; presetId?: string } }> = ({ data }) => (
  <div className="svelteflow-node preset-node">
    <Handle type="target" position={Position.Left} className="svelteflow-handle" />
    <div className="svelteflow-node__label">{data.label}</div>
    <Handle type="source" position={Position.Right} className="svelteflow-handle" />
  </div>
);

/** 文本生成节点：输入框内容作为提示词输出，可连到下游 */
const TextGenNode: React.FC<{
  id: string;
  data: { label: string; text?: string };
}> = ({ id, data }) => {
  const { setNodes } = useReactFlow();
  const updateText = useCallback(
    (text: string) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
      );
    },
    [id, setNodes]
  );
  return (
    <div className="svelteflow-node textgen-node">
      <Handle type="target" position={Position.Left} className="svelteflow-handle" />
      <div className="svelteflow-node__label">文本生成</div>
      <textarea
        className="textgen-node__input"
        placeholder="输入描述，将生成提示词…"
        value={data.text ?? ''}
        onChange={(e) => updateText(e.target.value)}
        rows={3}
      />
      <Handle type="source" position={Position.Right} className="svelteflow-handle" />
    </div>
  );
};

/** 可双击删除的边（曲线 + 整条线任意位置双击断开） */
function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  onDelete,
}: EdgeProps & { onDelete: (edgeId: string) => void }) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(id);
    },
    [id, onDelete]
  );
  return (
    <g onDoubleClick={handleDoubleClick} style={{ cursor: 'pointer' }}>
      <path id={id} d={edgePath} fill="none" style={style} />
      {/* 加宽透明描边，使整条线都可双击 */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} />
    </g>
  );
}

const nodeTypes: NodeTypes = {
  preset: PresetNode,
  textGen: TextGenNode,
};

function toFlowNode(n: CapabilitySetNode): Node {
  const type =
    n.type === 'input' || n.type === 'output'
      ? n.type
      : n.type === 'textGen'
        ? 'textGen'
        : 'preset';
  return {
    id: n.id,
    type,
    position: n.position,
    data: n.data,
  };
}

function toFlowEdge(e: CapabilitySetEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  };
}

function fromFlowNode(n: Node): CapabilitySetNode {
  const t = n.type as string;
  const type =
    t === 'input' || t === 'output' ? t : t === 'textGen' ? 'textGen' : 'preset';
  return {
    id: n.id,
    type: type as CapabilitySetNode['type'],
    position: n.position,
    data: n.data as CapabilitySetNode['data'],
  };
}

function fromFlowEdge(e: Edge): CapabilitySetEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  };
}

export const DRAG_TYPE = 'application/x-capability-preset';
export const DRAG_TYPE_TEXT_GEN = 'application/x-capability-textgen';

const initialNodes: Node[] = [
  { id: 'input-1', type: 'input', position: { x: 250, y: 25 }, data: { label: '原始图片' } },
  { id: 'output-1', type: 'output', position: { x: 250, y: 325 }, data: { label: '生图模型' } },
];

type CanvasInnerProps = {
  presets: CustomAppModule[];
  initialSet: CapabilitySet | null;
  setLabel: string;
  onSetLabelChange: (v: string) => void;
  onSave: (set: CapabilitySet) => void;
  onClose: () => void;
};

/** 不允许删除的固定节点 id（原始图片、生图模型） */
const FIXED_NODE_IDS = new Set(['input-1', 'output-1']);

const MAX_UNDO_HISTORY = 50;

function CanvasInner({ presets, initialSet, setLabel, onSetLabelChange, onSave, onClose }: CanvasInnerProps) {
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialSet ? initialSet.nodes.map(toFlowNode) : initialNodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialSet ? initialSet.edges.map(toFlowEdge) : []
  );

  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);

  const pushSnapshot = useCallback(() => {
    const n = getNodes();
    const e = getEdges();
    historyRef.current.push({
      nodes: JSON.parse(JSON.stringify(n)),
      edges: JSON.parse(JSON.stringify(e)),
    });
    if (historyRef.current.length > MAX_UNDO_HISTORY) historyRef.current.shift();
  }, [getNodes, getEdges]);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      pushSnapshot();
      setEdges((eds) => addEdge(params, eds));
    },
    [pushSnapshot, setEdges]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      pushSnapshot();
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    [pushSnapshot, setEdges]
  );

  const edgeTypes: EdgeTypes = useMemo(
    () => ({
      deletable: (props: EdgeProps) => <DeletableEdge {...props} onDelete={handleDeleteEdge} />,
    }),
    [handleDeleteEdge]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const textGen = e.dataTransfer.getData(DRAG_TYPE_TEXT_GEN);
      if (textGen === '1') {
        pushSnapshot();
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const id = `textGen-${genId()}`;
        setNodes((nds) =>
          nds.concat({
            id,
            type: 'textGen',
            position,
            data: { label: '文本生成', text: '' },
          })
        );
        return;
      }
      const presetJson = e.dataTransfer.getData(DRAG_TYPE);
      if (!presetJson) return;
      pushSnapshot();
      const preset = JSON.parse(presetJson) as CustomAppModule;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `preset-${preset.id}-${genId()}`;
      setNodes((nds) =>
        nds.concat({
          id,
          type: 'preset',
          position,
          data: { label: preset.label, presetId: preset.id },
        })
      );
    },
    [screenToFlowPosition, setNodes, pushSnapshot]
  );

  const onNodeDragStart = useCallback(() => {
    pushSnapshot();
  }, [pushSnapshot]);

  const handleSave = useCallback(() => {
    const setId = initialSet?.id ?? `set-${genId()}`;
    const now = Date.now();
    onSave({
      id: setId,
      label: setLabel.trim() || '未命名能力集合',
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      createdAt: initialSet?.createdAt ?? now,
      updatedAt: now,
    });
  }, [initialSet, setLabel, nodes, edges, onSave]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = (e.target as HTMLElement) ?? document.body;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        if (!inInput) {
          e.preventDefault();
          undo();
        }
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (inInput) return;
      if (target.closest?.('.sidebar')) return;
      const currentNodes = getNodes();
      const selectedIds = new Set(
        currentNodes.filter((n) => n.selected && !FIXED_NODE_IDS.has(n.id)).map((n) => n.id)
      );
      if (selectedIds.size === 0) return;
      e.preventDefault();
      pushSnapshot();
      setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
      setEdges((eds) =>
        eds.filter((ed) => !selectedIds.has(ed.source) && !selectedIds.has(ed.target))
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [getNodes, getEdges, setNodes, setEdges, pushSnapshot, undo]);

  return (
    <div className="dndflow">
      <aside className="sidebar">
        <div className="sidebar-header">能力集合</div>
        <input
          value={setLabel}
          onChange={(e) => onSetLabelChange(e.target.value)}
          placeholder="集合名称"
          className="sidebar-input w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10"
          >
            返回
          </button>
        </div>
        <div className="sidebar-header">拖到画布</div>
        <div className="sidebar-nodes">
          <div
            className="dndnode dndnode-textgen"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE_TEXT_GEN, '1');
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            文本生成
          </div>
          {presets.filter((p) => p.enabled !== false).map((p) => (
            <div
              key={p.id}
              className="dndnode"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(p));
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              {p.label}
            </div>
          ))}
          {presets.filter((p) => p.enabled !== false).length === 0 && (
            <div className="text-xs text-gray-500 py-2">暂无启用预设</div>
          )}
        </div>
      </aside>
      <div className="reactflow-wrapper svelteflow-style" role="application" aria-label="能力集合画布">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStart={onNodeDragStart}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{
            type: 'deletable',
            style: { stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2, strokeDasharray: '8 4' },
          }}
          panOnDrag={false}
          selectionOnDrag
          panOnScroll
          onPaneContextMenu={(e) => e.preventDefault()}
          onPaneMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          fitView
        >
          <Background variant="dots" gap={20} size={1} color="rgba(255,255,255,0.06)" />
          <Controls className="svelteflow-controls" />
          <MiniMap className="svelteflow-minimap" pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

type CapabilitySetCanvasProps = {
  presets: CustomAppModule[];
  initialSet: CapabilitySet | null;
  setLabel: string;
  onSetLabelChange: (v: string) => void;
  onSave: (set: CapabilitySet) => void;
  onClose: () => void;
};

export default function CapabilitySetCanvas(props: CapabilitySetCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
