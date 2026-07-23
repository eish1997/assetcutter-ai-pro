import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Camera,
  Copy,
  Crop,
  Download,
  Eye,
  EyeOff,
  FileText,
  Grid3X3,
  GripVertical,
  Image as ImageIcon,
  MoreHorizontal,
  Palette,
  Plus,
  RotateCcw,
  ScanLine,
  Scissors,
  SlidersHorizontal,
} from 'lucide-react';

import { resolveWorkflowAssetKind } from '../../services/workflowAssetVariants';
import type { WorkflowAsset, WorkflowAssetKind, WorkflowAssetVariant } from '../../types';
import type { ImagePreviewLayoutMode, Model3DDisplayMode } from './index';
import {
  getAssetPreviewAdapter,
  getAssetPreviewCapability,
} from './assetPreviewAdapters';
import { AssetPreviewCapabilityPanel } from './AssetPreviewCapabilityPanel';
import { AssetPreviewOutputTray } from './AssetPreviewOutputTray';
import type {
  AssetCapability,
  AssetCapabilityOutputAsset,
  AssetPreviewAction,
  AssetPreviewActionHandler,
  AssetPreviewContext,
  Model3DInspectionStats,
} from './assetPreviewTypes';

const IC = { size: 15, strokeWidth: 1.8, className: 'shrink-0' as const };
const MODEL_TOOL_BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] transition-colors hover:bg-white/[0.11] hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]';
const MODEL_TOOL_ACTIVE = 'bg-blue-600/35 text-blue-100 ring-2 ring-inset ring-blue-400/40';
const MODEL_3D_DISPLAY_MODES: Array<{ key: Model3DDisplayMode; label: string; title: string }> = [
  { key: 'material', label: 'Material', title: 'Show original model materials' },
  { key: 'clay', label: 'Clay', title: 'Show a neutral clay material' },
  { key: 'wire', label: 'Wire', title: 'Show model wireframe' },
  { key: 'normal', label: 'Normal', title: 'Show normal direction colors' },
];
const MODEL3D_STATS_EVENT = 'asset-preview:model3d-stats';

function iconForAction(action: AssetPreviewAction) {
  if (action.id === 'download') return <Download {...IC} aria-hidden />;
  if (action.id === 'copy') return <Copy {...IC} aria-hidden />;
  if (action.id === 'add-to-input') return <Plus {...IC} aria-hidden />;
  if (action.id === 'start-crop') return <Crop {...IC} aria-hidden />;
  if (action.id === 'run-rembg') return <Scissors {...IC} aria-hidden />;
  if (action.id === 'reset-camera') return <RotateCcw {...IC} aria-hidden />;
  if (action.id === 'toggle-grid') return <Grid3X3 {...IC} aria-hidden />;
  if (action.id === 'toggle-backface-culling') {
    return action.label.includes('显示') || action.label.includes('Show') ? (
      <Eye {...IC} aria-hidden />
    ) : (
      <EyeOff {...IC} aria-hidden />
    );
  }
  if (action.id === 'capture-preview') return <Camera {...IC} aria-hidden />;
  if (action.id === 'display-mode') return <SlidersHorizontal {...IC} aria-hidden />;
  return <MoreHorizontal {...IC} aria-hidden />;
}

function iconForKind(kind: string) {
  if (kind === 'model3d') return <Box {...IC} aria-hidden />;
  if (kind === 'text') return <FileText {...IC} aria-hidden />;
  return <ImageIcon {...IC} aria-hidden />;
}

function iconForModelDisplayMode(mode: Model3DDisplayMode) {
  if (mode === 'material') return <Palette {...IC} aria-hidden />;
  if (mode === 'clay') return <Box {...IC} aria-hidden />;
  if (mode === 'wire') return <Grid3X3 {...IC} aria-hidden />;
  return <ScanLine {...IC} aria-hidden />;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function model3dStatsBelongsToContext(stats: Model3DInspectionStats, asset: WorkflowAsset, variant: WorkflowAssetVariant | null): boolean {
  const source = cleanText(stats.source);
  if (!source) return false;
  const candidates = new Set<string>();
  const add = (value: unknown) => {
    const text = cleanText(value);
    if (text) candidates.add(text);
  };
  add(variant?.url);
  add(variant?.modelUrls?.[0]);
  variant?.modelUrls?.forEach(add);
  add(asset.original);
  asset.modelUrls?.forEach(add);
  Object.values(asset.stepModelUrls || {}).forEach((urls) => urls?.forEach(add));
  return candidates.size === 0 ? false : candidates.has(source);
}

type Props = {
  asset: WorkflowAsset;
  variant: WorkflowAssetVariant | null;
  previewKindOverride?: WorkflowAssetKind;
  previewLayout?: ImagePreviewLayoutMode;
  model3dDisplayMode?: Model3DDisplayMode;
  model3dGridVisible?: boolean;
  model3dBackfaceCulling?: boolean;
  onAction?: AssetPreviewActionHandler;
  onUseOutputAsInput?: (output: AssetCapabilityOutputAsset) => void;
  onSaveOutput?: (output: AssetCapabilityOutputAsset) => void;
  children?: React.ReactNode;
};

export const AssetPreviewShell: React.FC<Props> = ({
  asset,
  variant,
  previewKindOverride,
  previewLayout,
  model3dDisplayMode,
  model3dGridVisible,
  model3dBackfaceCulling,
  onAction,
  onUseOutputAsInput,
  onSaveOutput,
  children,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeCapability, setActiveCapability] = useState<AssetCapability | null>(null);
  const [model3dStats, setModel3dStats] = useState<Model3DInspectionStats | null>(null);
  const [outputs, setOutputs] = useState<AssetCapabilityOutputAsset[]>([]);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ left: number; top: number } | null>(null);
  const assetKind = previewKindOverride || resolveWorkflowAssetKind(asset);
  const adapter = getAssetPreviewAdapter(
    previewKindOverride || (variant?.kind === 'model3d' ? 'model3d' : assetKind)
  );
  const isModel3dPreview = adapter.type === 'model3d';
  const context: AssetPreviewContext = useMemo(
    () => ({
      asset,
      variant,
      assetKind: adapter.type,
      previewLayout,
      model3dDisplayMode,
      model3dGridVisible,
      model3dBackfaceCulling,
      model3dStats,
    }),
    [adapter.type, asset, model3dBackfaceCulling, model3dDisplayMode, model3dGridVisible, model3dStats, previewLayout, variant]
  );
  const actions = adapter.getToolbarActions?.(context) || [];
  const primaryActions = actions.filter((action) => action.placement === 'primary').slice(0, isModel3dPreview ? 6 : 5);
  const menuActions = actions.filter((action) => action.placement === 'menu');
  const capabilities = (adapter.getCapabilities?.(context) || [])
    .map((ref) => getAssetPreviewCapability(ref.capabilityId))
    .filter(Boolean) as AssetCapability[];
  const sections = adapter.getInspectorSections?.(context) || [];

  useEffect(() => {
    if (!isModel3dPreview) {
      setModel3dStats(null);
      return;
    }
    setModel3dStats(null);
  }, [asset.id, isModel3dPreview, variant?.id, variant?.url]);

  useEffect(() => {
    if (!isModel3dPreview) return;
    const onStats = (event: Event) => {
      const detail = (event as CustomEvent<Model3DInspectionStats>).detail;
      if (!detail || !model3dStatsBelongsToContext(detail, asset, variant)) return;
      setModel3dStats(detail);
    };
    window.addEventListener(MODEL3D_STATS_EVENT, onStats);
    return () => window.removeEventListener(MODEL3D_STATS_EVENT, onStats);
  }, [asset, isModel3dPreview, variant]);

  const openCapability = (capability: AssetCapability) => {
    setActiveCapability(capability);
    setInspectorOpen(false);
    setMenuOpen(false);
  };

  const runAction = (action: AssetPreviewAction) => {
    if (action.disabled) return;
    if (action.capabilityId) {
      const capability = getAssetPreviewCapability(action.capabilityId);
      if (capability) openCapability(capability);
      return;
    }
    void onAction?.(action, context);
    setMenuOpen(false);
  };

  const clampToolbarPosition = useCallback((left: number, top: number) => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const rect = toolbarRef.current?.getBoundingClientRect();
    const w = rect?.width || 360;
    const h = rect?.height || 36;
    const margin = 8;
    return {
      left: Math.max(margin, Math.min(Math.max(margin, vw - w - margin), left)),
      top: Math.max(margin, Math.min(Math.max(margin, vh - h - margin), top)),
    };
  }, []);

  const resetToolbarPosition = useCallback(() => {
    setToolbarPos(null);
  }, []);

  const beginToolbarDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!isModel3dPreview) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = toolbarRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setToolbarPos(clampToolbarPosition(rect.left, rect.top));
    },
    [clampToolbarPosition, isModel3dPreview]
  );

  useEffect(() => {
    if (!isModel3dPreview || !toolbarPos || !dragOffsetRef.current) return;
    const onMove = (event: PointerEvent) => {
      const offset = dragOffsetRef.current;
      if (!offset) return;
      setToolbarPos(clampToolbarPosition(event.clientX - offset.x, event.clientY - offset.y));
    };
    const onUp = () => {
      dragOffsetRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [clampToolbarPosition, isModel3dPreview, toolbarPos]);

  useEffect(() => {
    if (!isModel3dPreview) return;
    const onResize = () => {
      setToolbarPos((prev) => (prev ? clampToolbarPosition(prev.left, prev.top) : prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToolbarPosition, isModel3dPreview]);

  const renderPrimaryAction = (action: AssetPreviewAction) => {
    if (action.id === 'display-mode') {
      return (
        <div
          key={action.id}
          className={
            isModel3dPreview
              ? 'flex h-7 shrink-0 overflow-hidden rounded-md bg-white/[0.05] ring-1 ring-white/[0.06]'
              : 'flex h-8 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] p-0.5'
          }
          role="group"
          aria-label={action.label}
          title={action.title}
        >
          {MODEL_3D_DISPLAY_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              title={mode.title}
              aria-label={mode.label}
              aria-pressed={model3dDisplayMode === mode.key}
              onClick={() => runAction({ ...action, id: `display-mode:${mode.key}`, label: mode.label })}
              className={`inline-flex h-7 items-center justify-center text-[10px] font-bold transition-colors ${
                model3dDisplayMode === mode.key
                  ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-400/30'
                  : 'text-gray-300 hover:bg-white/[0.08] hover:text-white'
              } ${isModel3dPreview ? 'w-7 px-0' : 'rounded-md px-2'}`}
            >
              {isModel3dPreview ? iconForModelDisplayMode(mode.key) : mode.label}
            </button>
          ))}
        </div>
      );
    }
    return (
      <button
        key={action.id}
        type="button"
        disabled={action.disabled}
        onClick={() => runAction(action)}
        className={
          isModel3dPreview
            ? MODEL_TOOL_BTN
            : 'flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35'
        }
        title={action.disabled ? action.disabledReason || action.title : action.title || action.label}
        aria-label={action.label}
      >
        {iconForAction(action)}
        {isModel3dPreview ? null : <span className="hidden sm:inline">{action.label}</span>}
      </button>
    );
  };

  return (
    <>
      {children}
      <div
        ref={toolbarRef}
        className={
          isModel3dPreview
            ? 'pointer-events-auto fixed z-[2135] flex max-w-[min(42rem,calc(100vw-8rem))] items-center gap-1 rounded-xl border border-white/10 bg-[#0f0f12]/95 px-1.5 py-1 text-gray-200 shadow-xl ring-1 ring-white/[0.05] backdrop-blur-[2px]'
            : 'pointer-events-auto fixed left-1/2 top-4 z-[2135] flex max-w-[min(54rem,calc(100vw-7rem))] -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0d0e12]/88 p-1.5 text-gray-200 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl'
        }
        style={
          isModel3dPreview
            ? toolbarPos
              ? { left: toolbarPos.left, top: toolbarPos.top }
              : { left: '50%', top: 'max(0.5rem, env(safe-area-inset-top, 0px))', transform: 'translateX(-50%)' }
            : undefined
        }
        role="toolbar"
        aria-label="Preview tools"
        data-image-preview-no-wheel
        onClick={(e) => e.stopPropagation()}
      >
        {isModel3dPreview ? (
          <button
            type="button"
            onPointerDown={beginToolbarDrag}
            onDoubleClick={(event) => {
              event.stopPropagation();
              resetToolbarPosition();
            }}
            className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/60 active:cursor-grabbing"
            title="Drag toolbar, double-click to reset"
            aria-label="Drag 3D toolbar"
          >
            <GripVertical size={14} strokeWidth={1.8} aria-hidden />
          </button>
        ) : null}
        <div
          className={
            isModel3dPreview
              ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-gray-200 ring-1 ring-white/10'
              : 'flex min-w-0 items-center gap-1.5 border-r border-white/10 py-0.5 pl-1 pr-2'
          }
          title={isModel3dPreview ? `${adapter.label} preview` : undefined}
        >
          {iconForKind(adapter.type)}
          <div className={isModel3dPreview ? 'hidden' : 'min-w-0'}>
            <div className="truncate text-[10px] font-black text-white">{adapter.label} preview</div>
            <div className="max-w-36 truncate text-[8px] text-gray-500">{variant?.label || asset.id}</div>
          </div>
        </div>
        {isModel3dPreview ? <div className="mx-0.5 h-5 w-px shrink-0 bg-white/12" aria-hidden /> : null}
        {primaryActions.map(renderPrimaryAction)}
        <button
          type="button"
          onClick={() => setInspectorOpen((open) => !open)}
          className={`flex items-center justify-center text-[10px] font-bold transition-colors ${
            isModel3dPreview ? 'h-7 w-7 rounded-md px-0 ring-1 [&>span]:hidden' : 'h-8 rounded-lg border gap-1.5 px-2'
          } ${
            inspectorOpen
              ? isModel3dPreview
                ? MODEL_TOOL_ACTIVE
                : 'border-blue-400/35 bg-blue-600/35 text-blue-100'
              : isModel3dPreview
                ? 'bg-white/[0.06] text-gray-300 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100'
                : 'border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white'
          }`}
          aria-pressed={inspectorOpen}
          aria-label="Panel"
          title="Panel"
        >
          <SlidersHorizontal {...IC} aria-hidden />
          <span className="hidden sm:inline">Panel</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className={isModel3dPreview ? MODEL_TOOL_BTN : 'flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white'}
            aria-label="More preview actions"
          >
            <MoreHorizontal {...IC} aria-hidden />
          </button>
          {menuOpen ? (
            <div className="absolute left-0 top-10 w-52 rounded-xl border border-white/10 bg-[#0d0e12] p-1.5 shadow-xl">
              {([
                ...menuActions,
                ...capabilities.map((capability): AssetPreviewAction => ({
                id: `capability:${capability.id}`,
                label: capability.label,
                title: capability.description,
                placement: 'menu' as const,
                capabilityId: capability.id,
                })),
              ] as AssetPreviewAction[]).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => runAction(action)}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  title={action.title}
                >
                  {iconForAction(action)}
                  <span className="min-w-0 truncate">{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {inspectorOpen ? (
        <div
          className="pointer-events-auto fixed left-4 top-20 z-[2130] max-h-[calc(100vh-7rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-white/10 bg-[#0d0e12]/92 p-3 text-gray-200 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl"
          data-image-preview-no-wheel
          data-image-preview-scroll
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-[11px] font-black text-white">Preview panel</div>
          <div className="space-y-2">
            {sections.map((section) => (
              <section key={section.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
                <div className="text-[9px] font-black uppercase text-gray-500">{section.title}</div>
                {section.render ? <div className="mt-2">{section.render(context)}</div> : null}
                {section.rows ? (
                  <div className="mt-2 space-y-1">
                    {section.rows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 text-[9px]">
                        <span className="shrink-0 text-gray-500">{row.label}</span>
                        <span className="min-w-0 truncate text-right text-gray-300">{row.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
            {capabilities.length > 0 ? (
              <section className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
                <div className="text-[9px] font-black uppercase text-gray-500">Advanced capabilities</div>
                <div className="mt-2 grid gap-1.5">
                  {capabilities.map((capability) => {
                    const availability = capability.availability?.(context) || { available: true };
                    return (
                      <button
                        key={capability.id}
                        type="button"
                        disabled={!availability.available}
                        onClick={() => openCapability(capability)}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-left text-[10px] font-bold text-gray-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                        title={availability.reason || capability.description}
                      >
                        {capability.label}
                        {capability.description ? (
                          <span className="mt-0.5 block text-[8px] font-normal leading-4 text-gray-500">
                            {capability.description}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
      {activeCapability ? (
        <div className="fixed left-4 top-20 z-[2145]">
          <AssetPreviewCapabilityPanel
            capability={activeCapability}
            context={context}
            onClose={() => setActiveCapability(null)}
            onResult={(result) => {
              if (result.outputs?.length) setOutputs((prev) => [...result.outputs!, ...prev].slice(0, 8));
            }}
          />
        </div>
      ) : null}
      <AssetPreviewOutputTray
        outputs={outputs}
        onClear={() => setOutputs([])}
        onUseAsInput={onUseOutputAsInput}
        onSaveOutput={onSaveOutput}
      />
    </>
  );
};

export default AssetPreviewShell;
