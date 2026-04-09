import React, {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  createContext,
  useContext,
  Fragment,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  useStore,
  useViewport,
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
import type { CapabilitySet, CapabilitySetNode, CapabilitySetEdge, CapabilityCategory } from '../types';
import { CAPABILITY_CATEGORIES } from '../types';
import { executeCapabilitySet } from '../services/capabilityExecutor';
import { findClosestFlowEdgeHit } from '../services/capabilityFlowEdgeHit';
import { CapabilityPreviewImg } from './CapabilityPreviewImg';
import { pickCapabilityPresetPreview, resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import {
  inferInputWorkflowMedia,
  inferOutputWorkflowMedia,
  inferUpstreamPresetCategory,
  type CapabilityGraphEdgeLite,
  type CapabilityGraphNodeLite,
} from '../services/inferCapabilitySetIo';

const genId = () => Math.random().toString(36).slice(2, 11);

function toGraphLite(nodes: Node[], edges: Edge[]): {
  nodes: CapabilityGraphNodeLite[];
  edges: CapabilityGraphEdgeLite[];
} {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: String(n.type),
      data: n.data as CapabilityGraphNodeLite['data'],
    })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

/** 与 `layoutVariant` 同步，供节点组件做紧凑排版 */
const CanvasLayoutContext = createContext<'default' | 'overlayGlass'>('default');

/** 侧栏预设列表：解析节点上缺失的预览图 */
const PresetsByIdContext = createContext<Map<string, CustomAppModule>>(new Map());
const AssetCandidatesContext = createContext<CapabilityAssetCandidate[]>([]);

/** 测试断点节点点击「运行测试」→ 画布内执行到该节点 */
const TestStopRunContext = createContext<(nodeId: string) => void>(() => {});

/** 边上释放 HTML5 拖放时转发到画布（SVG 边线默认不会触发 pane 的 onDrop） */
const CanvasDropForwardRefContext = createContext<React.MutableRefObject<
  (e: React.DragEvent, droppedOnEdgeId?: string) => void
> | null>(null);

/** 无输入图时仍可走通拓扑与预设链的 1×1 占位图 */
const PARTIAL_TEST_PLACEHOLDER_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2F6ZkAAAAASUVORK5CYII=';

export type CapabilityAssetCandidate = {
  id: string;
  label: string;
  scope: 'workspace' | 'repository';
  image: string;
};

const AssetCardPlaceholder: React.FC<{ variant: 'image' | 'text' | 'output' }> = ({ variant }) => (
  <div className={`asset-card-node__ph asset-card-node__ph--${variant}`} aria-hidden>
    {variant === 'text' ? (
      <span className="asset-card-node__ph-icon">T</span>
    ) : variant === 'output' ? (
      <span className="asset-card-node__ph-icon">⇥</span>
    ) : (
      <span className="asset-card-node__ph-icon">◢</span>
    )}
  </div>
);

/** 节点：资产卡 — 上预览、下标题；去掉 nodrag 使整块可拖拽 */
const PresetNode: React.FC<{ data: { label: string; presetId?: string; previewImage?: string } }> = ({ data }) => {
  const layout = useContext(CanvasLayoutContext);
  const presetsById = useContext(PresetsByIdContext);
  const compact = layout === 'overlayGlass';
  const raw =
    data.previewImage?.trim() ||
    (data.presetId ? pickCapabilityPresetPreview(presetsById.get(data.presetId)) : undefined);
  const resolved = useMemo(() => resolveCapabilityPreviewSrc(raw) ?? '', [raw]);
  return (
    <div
      className={`asset-card-node svelteflow-node preset-node${compact ? ' asset-card-node--compact preset-node--compact' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="svelteflow-handle" />
      <div className="asset-card-node__media">
        <CapabilityPreviewImg
          src={resolved}
          alt=""
          className="asset-card-node__img"
          fallback={<AssetCardPlaceholder variant="image" />}
        />
      </div>
      <div className="asset-card-node__bar">
        <span className="asset-card-node__title">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Right} className="svelteflow-handle" />
    </div>
  );
};

/** 文本生成节点：输入框内容作为提示词输出，可连到下游 */
const TextGenNode: React.FC<{
  id: string;
  data: { label: string; text?: string };
}> = ({ id, data }) => {
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = useContext(CanvasLayoutContext);
  const compact = layout === 'overlayGlass';
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const updateText = useCallback(
    (text: string) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
      );
    },
    [id, setNodes]
  );
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const minPx = compact ? 34 : 42;
    // 上限约为普通节点高度的 2.5 倍，避免超长文本把画布撑得过高。
    const maxPx = compact ? 110 : 140;
    // 文本节点高度跟随内容变化，避免内容被裁切。
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minPx), maxPx)}px`;
    updateNodeInternals(id);
  }, [id, compact, data.text, updateNodeInternals]);
  return (
    <div
      className={`asset-card-node svelteflow-node textgen-node${compact ? ' asset-card-node--compact textgen-node--compact' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="svelteflow-handle" />
      <div className="asset-card-node__media asset-card-node__media--textgen">
        <textarea
          ref={textareaRef}
          className="asset-card-node__textarea nodrag"
          placeholder="输入描述…"
          value={data.text ?? ''}
          onChange={(e) => updateText(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          rows={1}
        />
      </div>
      <div className="asset-card-node__bar">
        <span className="asset-card-node__title">文本生成</span>
      </div>
      <Handle type="source" position={Position.Right} className="svelteflow-handle" />
    </div>
  );
};

const AssetInputNode: React.FC<{ id: string; data: CapabilitySetNode['data'] }> = ({ id, data }) => {
  const { setNodes } = useReactFlow();
  const layout = useContext(CanvasLayoutContext);
  const compact = layout === 'overlayGlass';
  const candidates = useContext(AssetCandidatesContext);
  const [openPanel, setOpenPanel] = React.useState(false);
  const [panelScope, setPanelScope] = React.useState<'workspace' | 'repository'>(
    data.assetScope === 'repository' ? 'repository' : 'workspace'
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const panelGridRef = useRef<HTMLDivElement>(null);
  const scope = data.assetScope === 'repository' ? 'repository' : 'workspace';
  const scoped = useMemo(
    () => candidates.filter((x) => x.scope === scope),
    [candidates, scope]
  );
  const workspaceItems = useMemo(
    () => candidates.filter((x) => x.scope === 'workspace'),
    [candidates]
  );
  const repositoryItems = useMemo(
    () => candidates.filter((x) => x.scope === 'repository'),
    [candidates]
  );
  const panelItems = panelScope === 'repository' ? repositoryItems : workspaceItems;
  const selected = useMemo(
    () => scoped.find((x) => x.id === data.assetId) ?? null,
    [scoped, data.assetId]
  );
  const setDataPatch = useCallback(
    (patch: Partial<CapabilitySetNode['data']>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...(n.data as CapabilitySetNode['data']), ...patch } }
            : n
        )
      );
    },
    [id, setNodes]
  );

  useEffect(() => {
    setPanelScope(scope);
  }, [scope]);

  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (ev: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(ev.target as Node)) setOpenPanel(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpenPanel(false);
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openPanel]);

  const handlePanelWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const grid = panelGridRef.current;
    if (!grid) return;
    e.preventDefault();
    grid.scrollTop += e.deltaY;
  }, []);

  return (
    <div
      ref={rootRef}
      className={`asset-card-node asset-card-node--input asset-input-node svelteflow-node preset-node${compact ? ' asset-card-node--compact preset-node--compact' : ''}`}
    >
      <div className="asset-card-node__media">
        {selected ? (
          <CapabilityPreviewImg
            src={resolveCapabilityPreviewSrc(selected.image) ?? ''}
            alt=""
            className="asset-card-node__img"
            fallback={<AssetCardPlaceholder variant="image" />}
          />
        ) : (
          <AssetCardPlaceholder variant="image" />
        )}
      </div>
      <div className="asset-card-node__bar asset-input-node__bar">
        <span className="asset-card-node__title asset-input-node__title">
          {selected?.label || '选择资产'}
        </span>
        <button
          type="button"
          className="asset-input-node__pick nodrag"
          onClick={(e) => {
            e.stopPropagation();
            setPanelScope(scope);
            setOpenPanel((v) => !v);
          }}
        >
          选择
        </button>
      </div>
      {openPanel ? (
        <div
          className="asset-input-node__panel nodrag"
          onClick={(e) => e.stopPropagation()}
          onWheelCapture={handlePanelWheel}
        >
          <div className="asset-input-node__panel-head">
            <span className="asset-input-node__panel-scope">
              {panelScope === 'repository' ? '仓库' : '工作区'}
            </span>
            <button
              type="button"
              className="asset-input-node__scope-toggle"
              onClick={() =>
                setPanelScope((p) => (p === 'workspace' ? 'repository' : 'workspace'))
              }
            >
              切换到{panelScope === 'workspace' ? '仓库' : '工作区'}
            </button>
          </div>
          <div ref={panelGridRef} className="asset-input-node__grid">
            {panelItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`asset-input-node__thumb${item.id === data.assetId ? ' is-active' : ''}`}
                title={item.label}
                onClick={() => {
                  setDataPatch({
                    assetScope: panelScope,
                    assetId: item.id,
                    label: item.label,
                  });
                  setOpenPanel(false);
                }}
              >
                <CapabilityPreviewImg
                  src={resolveCapabilityPreviewSrc(item.image) ?? ''}
                  alt=""
                  className="asset-input-node__thumb-img"
                  fallback={<AssetCardPlaceholder variant="image" />}
                />
              </button>
            ))}
            {panelItems.length === 0 ? (
              <div className="asset-input-node__empty">暂无图片资产</div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="asset-input-node__handles">
        <Handle type="target" position={Position.Left} className="svelteflow-handle" />
        <Handle type="source" position={Position.Right} className="svelteflow-handle" />
      </div>
    </div>
  );
};

const WorkflowInputNode: React.FC<{ id: string; data: { label: string; previewImage?: string } }> = ({
  id,
  data,
}) => {
  const layout = useContext(CanvasLayoutContext);
  const presetsById = useContext(PresetsByIdContext);
  const compact = layout === 'overlayGlass';
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const { nodes: liteNodes, edges: liteEdges } = useMemo(
    () => toGraphLite(nodes, edges),
    [nodes, edges]
  );
  const inputMedia = useMemo(
    () => inferInputWorkflowMedia(id, liteEdges, liteNodes, presetsById),
    [id, liteEdges, liteNodes, presetsById]
  );
  const displayLabel =
    inputMedia === 'text'
      ? '原始文字'
      : inputMedia === 'image'
        ? '原始图片'
        : data.label?.trim() || '原始图片';
  const resolved = useMemo(() => resolveCapabilityPreviewSrc(data.previewImage) ?? '', [data.previewImage]);
  return (
    <div
      className={`asset-card-node asset-card-node--input svelteflow-node preset-node${compact ? ' asset-card-node--compact preset-node--compact' : ''}`}
    >
      <div className="asset-card-node__media">
        {inputMedia === 'text' ? (
          <AssetCardPlaceholder variant="text" />
        ) : (
          <CapabilityPreviewImg
            src={resolved}
            alt=""
            className="asset-card-node__img"
            fallback={<AssetCardPlaceholder variant="image" />}
          />
        )}
      </div>
      <div className="asset-card-node__bar">
        <span className="asset-card-node__title">{displayLabel}</span>
      </div>
      <Handle type="source" position={Position.Right} className="svelteflow-handle" />
    </div>
  );
};

/** 输出节点：仅作汇点；文字/图片态由直接上游预设分类推断 */
/** 插在连线上的断点：线穿过节点，向下伸出「运行测试」 */
const TestStopNode: React.FC<{ id: string }> = ({ id }) => {
  const run = useContext(TestStopRunContext);
  const layout = useContext(CanvasLayoutContext);
  const compact = layout === 'overlayGlass';
  return (
    <div className={`test-stop-node svelteflow-node${compact ? ' test-stop-node--compact' : ''}`}>
      <div className="test-stop-node__wire">
        <Handle type="target" position={Position.Left} className="svelteflow-handle test-stop-node__handle" />
        <div className="test-stop-node__joint" aria-hidden />
        <Handle type="source" position={Position.Right} className="svelteflow-handle test-stop-node__handle" />
      </div>
      <div className="test-stop-node__stem" aria-hidden />
      <button
        type="button"
        className="test-stop-node__run nodrag"
        onClick={(e) => {
          e.stopPropagation();
          run(id);
        }}
      >
        运行测试
      </button>
    </div>
  );
};

const WorkflowOutputNode: React.FC<{ id: string; data: CapabilitySetNode['data'] }> = ({ id, data }) => {
  const run = useContext(TestStopRunContext);
  const layout = useContext(CanvasLayoutContext);
  const presetsById = useContext(PresetsByIdContext);
  const compact = layout === 'overlayGlass';
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const { nodes: liteNodes, edges: liteEdges } = useMemo(
    () => toGraphLite(nodes, edges),
    [nodes, edges]
  );
  const outMedia = useMemo(
    () => inferOutputWorkflowMedia(id, liteEdges, liteNodes, presetsById),
    [id, liteEdges, liteNodes, presetsById]
  );
  const baseTitle = (data.label && String(data.label).trim()) || '输出';
  const titleLine =
    outMedia === 'text' ? `${baseTitle} · 文字` : outMedia === 'image' ? `${baseTitle} · 图片` : baseTitle;

  return (
    <div
      className={`asset-card-node svelteflow-node output-node${compact ? ' asset-card-node--compact output-node--compact' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="svelteflow-handle" />
      <div className="asset-card-node__media">
        <AssetCardPlaceholder variant={outMedia === 'text' ? 'text' : 'output'} />
      </div>
      <div className="asset-card-node__bar output-node__bar">
        <span className="asset-card-node__title">{titleLine}</span>
        <button
          type="button"
          className="output-node__run nodrag"
          onClick={(e) => {
            e.stopPropagation();
            run(id);
          }}
        >
          运行测试
        </button>
      </div>
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
  const dropForwardRef = useContext(CanvasDropForwardRefContext);
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
  const onDragOverEdge = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const onDropEdge = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropForwardRef?.current(e, id);
    },
    [dropForwardRef, id]
  );
  return (
    <g
      onDragOver={onDragOverEdge}
      onDrop={onDropEdge}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: 'pointer' }}
    >
      <path id={id} d={edgePath} fill="none" className="react-flow__edge-path" style={style} />
      {/* 加宽透明描边，使整条线都可双击；同时扩大可释放测试节点的命中 */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={28} />
    </g>
  );
}

const nodeTypes: NodeTypes = {
  input: WorkflowInputNode,
  output: WorkflowOutputNode,
  preset: PresetNode,
  textGen: TextGenNode,
  testStop: TestStopNode,
  assetInput: AssetInputNode,
};

function toFlowNode(n: CapabilitySetNode): Node {
  const type =
    n.type === 'input' || n.type === 'output'
      ? n.type
      : n.type === 'textGen'
        ? 'textGen'
        : n.type === 'testStop'
          ? 'testStop'
          : n.type === 'assetInput'
            ? 'assetInput'
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
    t === 'input' || t === 'output'
      ? t
      : t === 'textGen'
        ? 'textGen'
        : t === 'testStop'
          ? 'testStop'
          : t === 'assetInput'
            ? 'assetInput'
          : 'preset';
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
export const DRAG_TYPE_TEST_STOP = 'application/x-capability-teststop';
export const DRAG_TYPE_ASSET_INPUT = 'application/x-capability-asset-input';

function defaultOutputData(): CapabilitySetNode['data'] {
  return {
    label: '输出',
    /** 兼容旧数据与类型；执行器不依赖此字段，产物由上游预设决定 */
    outputCategory: 'image_to_image',
  };
}

const initialNodes: Node[] = [
  { id: 'asset-input-1', type: 'assetInput', position: { x: 250, y: 25 }, data: { label: '输入资产' } },
  { id: 'output-1', type: 'output', position: { x: 250, y: 325 }, data: defaultOutputData() },
];

function normalizeFlowNodesForLoad(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    if (n.type !== 'output') return n;
    const d = n.data as CapabilitySetNode['data'];
    const cat = d.outputCategory;
    const valid = cat && CAPABILITY_CATEGORIES.some((c) => c.id === cat);
    if (!valid) {
      return {
        ...n,
        data: {
          ...d,
          ...defaultOutputData(),
          label: (d.label && String(d.label).trim()) || '输出',
        },
      };
    }
    return {
      ...n,
      data: {
        ...d,
        label: (d.label && String(d.label).trim()) || '输出',
      },
    };
  });
}

type CanvasInnerProps = {
  presets: CustomAppModule[];
  initialSet: CapabilitySet | null;
  setLabel: string;
  onSetLabelChange: (v: string) => void;
  onSave: (set: CapabilitySet) => void;
  onClose: () => void;
  /** 工作流创建全屏层：紧凑尺寸 + 透明模糊画布 */
  layoutVariant?: 'default' | 'overlayGlass';
  /** 断点「运行测试」日志（可选） */
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 断点测试用的输入图；未返回则使用 1×1 占位图并打 warn */
  getPartialTestInputImage?: () => string | null;
  /** 资产节点可选项（工作区/仓库） */
  assetCandidates?: CapabilityAssetCandidate[];
};

/** 不允许删除的固定节点：默认保留一个「资产输入」节点 */
const FIXED_NODE_IDS = new Set(['asset-input-1']);

const MAX_UNDO_HISTORY = 50;

function CanvasInner({
  presets,
  initialSet,
  setLabel,
  onSetLabelChange,
  onSave,
  onClose,
  layoutVariant = 'default',
  onLog,
  getPartialTestInputImage,
  assetCandidates = [],
}: CanvasInnerProps) {
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();
  const { zoom } = useViewport();
  const canvasDropForwardRef = useRef<(e: React.DragEvent, droppedOnEdgeId?: string) => void>(() => {});
  const lastTestStopDropRef = useRef<{ edgeId?: string; x: number; y: number; at: number } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    normalizeFlowNodesForLoad(initialSet ? initialSet.nodes.map(toFlowNode) : initialNodes)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialSet ? initialSet.edges.map(toFlowEdge) : []
  );

  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const dndRootRef = useRef<HTMLDivElement>(null);
  const presetsById = useMemo(() => new Map(presets.map((p) => [p.id, p])), [presets]);
  const assetById = useMemo(() => new Map(assetCandidates.map((a) => [a.id, a])), [assetCandidates]);

  const enabledPresets = useMemo(
    () => presets.filter((p) => p.enabled !== false),
    [presets]
  );

  const presetsGroupedByCategory = useMemo(() => {
    const byCat = new Map<CapabilityCategory, CustomAppModule[]>();
    for (const c of CAPABILITY_CATEGORIES) byCat.set(c.id, []);
    const other: CustomAppModule[] = [];
    for (const p of enabledPresets) {
      const cat = p.category;
      if (cat && byCat.has(cat)) byCat.get(cat)!.push(p);
      else other.push(p);
    }
    return { byCat, other };
  }, [enabledPresets]);

  const syncMinimapHeightVar = useCallback(() => {
    const root = dndRootRef.current;
    if (!root) return;
    const mm = root.querySelector('.svelteflow-minimap');
    if (!mm) {
      root.style.setProperty('--ac-minimap-h', '150px');
      return;
    }
    const h = Math.ceil(mm.getBoundingClientRect().height);
    root.style.setProperty('--ac-minimap-h', `${Math.max(h, 1)}px`);
  }, []);

  useLayoutEffect(() => {
    const root = dndRootRef.current;
    if (!root) return;
    const mm = root.querySelector('.svelteflow-minimap');
    syncMinimapHeightVar();
    if (!mm) return;
    const ro = new ResizeObserver(() => syncMinimapHeightVar());
    ro.observe(mm);
    return () => ro.disconnect();
  }, [syncMinimapHeightVar, layoutVariant]);

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

  const handleSurfaceDrop = useCallback(
    (e: React.DragEvent, droppedOnEdgeId?: string) => {
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
      const assetInput = e.dataTransfer.getData(DRAG_TYPE_ASSET_INPUT);
      if (assetInput === '1') {
        pushSnapshot();
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const id = `assetInput-${genId()}`;
        const firstWorkspace = assetCandidates.find((a) => a.scope === 'workspace');
        const firstRepository = assetCandidates.find((a) => a.scope === 'repository');
        const picked = firstWorkspace ?? firstRepository;
        setNodes((nds) =>
          nds.concat({
            id,
            type: 'assetInput',
            position,
            data: {
              label: picked?.label || '资产输入',
              assetScope: picked?.scope ?? 'workspace',
              assetId: picked?.id,
            },
          })
        );
        return;
      }
      const testStop = e.dataTransfer.getData(DRAG_TYPE_TEST_STOP);
      if (testStop === '1') {
        const now = Date.now();
        const last = lastTestStopDropRef.current;
        if (
          last &&
          now - last.at < 220 &&
          Math.abs(last.x - e.clientX) <= 2 &&
          Math.abs(last.y - e.clientY) <= 2 &&
          (last.edgeId ?? '') === (droppedOnEdgeId ?? '')
        ) {
          return;
        }
        lastTestStopDropRef.current = {
          edgeId: droppedOnEdgeId,
          x: e.clientX,
          y: e.clientY,
          at: now,
        };
        const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const edgesNow = getEdges();
        let old =
          droppedOnEdgeId != null ? edgesNow.find((ed) => ed.id === droppedOnEdgeId) : undefined;
        if (!old) {
          const maxHitFlow = 72 / Math.max(zoom, 0.12);
          const hit = findClosestFlowEdgeHit(flow.x, flow.y, getNodes(), edgesNow, maxHitFlow);
          old = hit?.edge;
        }
        if (!old) {
          onLog?.('warn', '测试节点请拖到已有连线上再释放', undefined);
          return;
        }
        pushSnapshot();
        const newNodeId = `testStop-${genId()}`;
        const e1 = `e-${genId()}`;
        const e2 = `e-${genId()}`;
        const edgeType = (old.type as string | undefined) || 'deletable';
        const NODE_W = 100;
        const WIRE_MID = 10;
        setEdges((eds) =>
          eds
            .filter((ed) => ed.id !== old.id)
            .concat([
              {
                id: e1,
                source: old.source,
                target: newNodeId,
                type: edgeType,
                sourceHandle: old.sourceHandle,
                targetHandle: undefined,
              },
              {
                id: e2,
                source: newNodeId,
                target: old.target,
                type: edgeType,
                sourceHandle: undefined,
                targetHandle: old.targetHandle,
              },
            ])
        );
        setNodes((nds) =>
          nds.concat({
            id: newNodeId,
            type: 'testStop',
            position: { x: flow.x - NODE_W / 2, y: flow.y - WIRE_MID },
            data: { label: '测试' },
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
          data: {
            label: preset.label,
            presetId: preset.id,
            previewImage: pickCapabilityPresetPreview(preset),
          },
        })
      );
    },
    [screenToFlowPosition, setNodes, setEdges, getNodes, getEdges, pushSnapshot, onLog, zoom, assetCandidates]
  );

  canvasDropForwardRef.current = handleSurfaceDrop;

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      handleSurfaceDrop(e);
    },
    [handleSurfaceDrop]
  );

  const onNodeDragStart = useCallback(() => {
    pushSnapshot();
  }, [pushSnapshot]);

  const addOutputNode = useCallback(() => {
    pushSnapshot();
    const id = `output-${genId()}`;
    setNodes((nds) => {
      const outs = nds.filter((n) => n.type === 'output');
      const last = outs[outs.length - 1];
      const position = last
        ? { x: last.position.x + 48, y: last.position.y + 72 }
        : { x: 250, y: 400 };
      const nextIndex = outs.length + 1;
      return nds.concat({
        id,
        type: 'output',
        position,
        data: {
          ...defaultOutputData(),
          label: nextIndex <= 1 ? '输出' : `输出 ${nextIndex}`,
        },
      });
    });
  }, [pushSnapshot, setNodes]);

  const buildPersistedSet = useCallback((): CapabilitySet => {
    const setId = initialSet?.id ?? `set-${genId()}`;
    const now = Date.now();
    const { nodes: liteNodes, edges: liteEdges } = toGraphLite(nodes, edges);
    const savedNodes = nodes.map((n) => {
      const base = fromFlowNode(n);
      if (n.type !== 'output') return base;
      const cat = inferUpstreamPresetCategory(n.id, liteEdges, liteNodes, presetsById);
      if (cat) {
        return { ...base, data: { ...base.data, outputCategory: cat } };
      }
      return base;
    });
    return {
      id: setId,
      label: setLabel.trim() || '未命名能力集合',
      nodes: savedNodes,
      edges: edges.map(fromFlowEdge),
      createdAt: initialSet?.createdAt ?? now,
      updatedAt: now,
    };
  }, [initialSet, setLabel, nodes, edges, presetsById]);

  const handleSave = useCallback(() => {
    onSave(buildPersistedSet());
  }, [onSave, buildPersistedSet]);

  const runPartialTest = useCallback(
    (stopNodeId: string) => {
      void (async () => {
        const set = buildPersistedSet();
        const assetInputs: Record<string, string> = {};
        for (const n of set.nodes) {
          if (n.type !== 'assetInput') continue;
          const aid = n.data.assetId;
          if (!aid) continue;
          const c = assetById.get(aid);
          const img = (c?.image ?? '').trim();
          if (img) assetInputs[n.id] = img;
        }
        const raw = getPartialTestInputImage?.() ?? null;
        const trimmed = (raw ?? '').trim();
        const input = trimmed.length > 0 ? trimmed : PARTIAL_TEST_PLACEHOLDER_IMAGE;
        if (trimmed.length === 0 && Object.keys(assetInputs).length === 0) {
          onLog?.('warn', '运行测试：未配置输入图，使用占位图', undefined);
        }
        try {
          const result = await executeCapabilitySet(set, input, {
            presets,
            onLog,
            assetInputs,
            stopAtNodeId: stopNodeId,
          });
          if (!result.ok) onLog?.('warn', result.error, undefined);
          else onLog?.('info', `[测试] 已执行至断点，耗时 ${result.durationMs}ms`, undefined);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onLog?.('error', `[测试] ${msg}`, undefined);
        }
      })();
    },
    [buildPersistedSet, getPartialTestInputImage, onLog, presets, assetById]
  );

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
      const deletableSelected = currentNodes.filter((n) => n.selected && !FIXED_NODE_IDS.has(n.id));
      if (deletableSelected.length === 0) return;
      const outputCount = currentNodes.filter((n) => n.type === 'output').length;
      const selectedOutputCount = deletableSelected.filter((n) => n.type === 'output').length;
      if (outputCount - selectedOutputCount < 1) return;
      const selectedIds = new Set(deletableSelected.map((n) => n.id));
      const currentEdges = getEdges();
      const bridgeEdges: Edge[] = [];
      for (const n of deletableSelected) {
        if (n.type !== 'testStop') continue;
        const inc = currentEdges.filter((ed) => ed.target === n.id);
        const out = currentEdges.filter((ed) => ed.source === n.id);
        if (
          inc.length === 1 &&
          out.length === 1 &&
          !selectedIds.has(inc[0].source) &&
          !selectedIds.has(out[0].target)
        ) {
          bridgeEdges.push({
            id: `e-${genId()}`,
            source: inc[0].source,
            target: out[0].target,
            type: 'deletable',
            sourceHandle: inc[0].sourceHandle,
            targetHandle: out[0].targetHandle,
          });
        }
      }
      e.preventDefault();
      pushSnapshot();
      setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
      setEdges((eds) => {
        const remaining = eds.filter(
          (ed) => !selectedIds.has(ed.source) && !selectedIds.has(ed.target)
        );
        return remaining.concat(bridgeEdges);
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [getNodes, getEdges, setNodes, setEdges, pushSnapshot, undo]);

  return (
    <CanvasLayoutContext.Provider value={layoutVariant}>
    <PresetsByIdContext.Provider value={presetsById}>
    <AssetCandidatesContext.Provider value={assetCandidates}>
    <TestStopRunContext.Provider value={runPartialTest}>
    <CanvasDropForwardRefContext.Provider value={canvasDropForwardRef}>
    <div
      ref={dndRootRef}
      className={layoutVariant === 'overlayGlass' ? 'dndflow dndflow--overlay-glass' : 'dndflow'}
    >
      <aside className="sidebar">
        <div className="sidebar-header">能力集合</div>
        <input
          value={setLabel}
          onChange={(e) => onSetLabelChange(e.target.value)}
          placeholder="集合名称"
          className="sidebar-input w-full rounded border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30"
        />
        <div className={layoutVariant === 'overlayGlass' ? '' : 'flex gap-2'}>
          <button
            type="button"
            onClick={handleSave}
            className={
              layoutVariant === 'overlayGlass'
                ? 'w-full rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500'
                : 'flex-1 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500'
            }
          >
            保存
          </button>
          {layoutVariant !== 'overlayGlass' ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-[#2e2e36]"
            >
              返回
            </button>
          ) : null}
        </div>
        <div className="sidebar-header">通用节点</div>
        <button
          type="button"
          onClick={addOutputNode}
          className="w-full rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] font-black uppercase text-blue-300 hover:bg-[#2e2e36] transition-colors"
        >
          添加输出节点
        </button>
        <div
          className="dndnode dndnode-teststop mt-2"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE_TEST_STOP, '1');
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          测试节点
        </div>
        <div
          className="dndnode mt-2"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE_ASSET_INPUT, '1');
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          资产节点
        </div>
        <p className="text-[9px] text-gray-500 leading-snug mt-1 px-0.5">
          测试节点拖到<strong className="text-gray-400">已有连线</strong>上释放；资产节点拖到画布后可选工作区/仓库资产。
        </p>
        <div className="sidebar-header">拖到画布</div>
        <div className="sidebar-nodes">
          <div className="sidebar-group-title">文本生成</div>
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

          {CAPABILITY_CATEGORIES.map((cat) => {
            const list = presetsGroupedByCategory.byCat.get(cat.id) ?? [];
            if (list.length === 0) return null;
            return (
              <Fragment key={cat.id}>
                <div className="sidebar-group-title">{cat.label}</div>
                {list.map((p) => (
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
              </Fragment>
            );
          })}

          {presetsGroupedByCategory.other.length > 0 ? (
            <Fragment key="__other__">
              <div className="sidebar-group-title">其他</div>
              {presetsGroupedByCategory.other.map((p) => (
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
            </Fragment>
          ) : null}

          {enabledPresets.length === 0 && (
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
            style: {
              stroke: 'rgba(255,255,255,0.28)',
              strokeWidth: 1.1,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            },
          }}
          panOnDrag={false}
          selectionOnDrag
          panOnScroll
          onPaneContextMenu={(e) => e.preventDefault()}
          onPaneMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          /** 松手时更易吸附到邻近 Handle */
          connectionRadius={32}
          fitView
        >
          <Background
            variant="dots"
            gap={layoutVariant === 'overlayGlass' ? 14 : 20}
            size={layoutVariant === 'overlayGlass' ? 0.85 : 1}
            color="rgba(255,255,255,0.06)"
          />
          <Controls className="svelteflow-controls" position="bottom-right" />
          <MiniMap className="svelteflow-minimap" pannable zoomable />
        </ReactFlow>
      </div>
    </div>
    </CanvasDropForwardRefContext.Provider>
    </TestStopRunContext.Provider>
    </AssetCandidatesContext.Provider>
    </PresetsByIdContext.Provider>
    </CanvasLayoutContext.Provider>
  );
}

export type CapabilitySetCanvasProps = {
  presets: CustomAppModule[];
  initialSet: CapabilitySet | null;
  setLabel: string;
  onSetLabelChange: (v: string) => void;
  onSave: (set: CapabilitySet) => void;
  onClose: () => void;
  layoutVariant?: 'default' | 'overlayGlass';
  onLog?: CanvasInnerProps['onLog'];
  getPartialTestInputImage?: CanvasInnerProps['getPartialTestInputImage'];
  assetCandidates?: CanvasInnerProps['assetCandidates'];
};

export default function CapabilitySetCanvas(props: CapabilitySetCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
