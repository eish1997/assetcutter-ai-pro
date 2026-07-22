import React, { useMemo, useState } from 'react';
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
import type { WorkflowAsset, WorkflowAssetVariant } from '../../types';
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
} from './assetPreviewTypes';

const IC = { size: 15, strokeWidth: 1.8, className: 'shrink-0' as const };
const MODEL_3D_DISPLAY_MODES: Array<{ key: Model3DDisplayMode; label: string; title: string }> = [
  { key: 'material', label: '材质', title: '使用模型原始材质' },
  { key: 'clay', label: '素模', title: '使用白模观察形体' },
  { key: 'wire', label: '线框', title: '显示模型网格线框' },
  { key: 'normal', label: '法线', title: '用法线颜色检查表面方向' },
];

function iconForAction(action: AssetPreviewAction) {
  if (action.id === 'download') return <Download {...IC} aria-hidden />;
  if (action.id === 'copy') return <Copy {...IC} aria-hidden />;
  if (action.id === 'add-to-input') return <Plus {...IC} aria-hidden />;
  if (action.id === 'start-crop') return <Crop {...IC} aria-hidden />;
  if (action.id === 'run-rembg') return <Scissors {...IC} aria-hidden />;
  if (action.id === 'reset-camera') return <RotateCcw {...IC} aria-hidden />;
  if (action.id === 'toggle-grid') return <Grid3X3 {...IC} aria-hidden />;
  if (action.id === 'toggle-backface-culling') {
    return action.label.includes('显示') ? <Eye {...IC} aria-hidden /> : <EyeOff {...IC} aria-hidden />;
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

type Props = {
  asset: WorkflowAsset;
  variant: WorkflowAssetVariant | null;
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
  const [outputs, setOutputs] = useState<AssetCapabilityOutputAsset[]>([]);
  const assetKind = resolveWorkflowAssetKind(asset);
  const adapter = getAssetPreviewAdapter(variant?.kind === 'model3d' ? 'model3d' : assetKind);
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
    }),
    [adapter.type, asset, model3dBackfaceCulling, model3dDisplayMode, model3dGridVisible, previewLayout, variant]
  );
  const actions = adapter.getToolbarActions?.(context) || [];
  const primaryActions = actions.filter((action) => action.placement === 'primary').slice(0, isModel3dPreview ? 6 : 5);
  const menuActions = actions.filter((action) => action.placement === 'menu');
  const capabilities = (adapter.getCapabilities?.(context) || [])
    .map((ref) => getAssetPreviewCapability(ref.capabilityId))
    .filter(Boolean) as AssetCapability[];
  const sections = adapter.getInspectorSections?.(context) || [];

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

  const renderPrimaryAction = (action: AssetPreviewAction) => {
    if (action.id === 'display-mode') {
      return (
        <div
          key={action.id}
          className={
            isModel3dPreview
              ? 'flex h-8 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
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
              className={`inline-flex h-7 items-center justify-center rounded-md text-[10px] font-bold transition-colors ${
                model3dDisplayMode === mode.key
                  ? 'bg-white text-black'
                  : 'text-gray-300 hover:bg-white/[0.08] hover:text-white'
              } ${isModel3dPreview ? 'w-8 px-0' : 'px-2'}`}
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
            ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-gray-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35'
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
        className={
          isModel3dPreview
            ? 'pointer-events-auto fixed left-1/2 top-4 z-[2135] flex max-w-[min(42rem,calc(100vw-8rem))] -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[#101115]/82 p-1 text-gray-200 shadow-[0_18px_48px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.05] backdrop-blur-md'
            : 'pointer-events-auto fixed left-1/2 top-4 z-[2135] flex max-w-[min(54rem,calc(100vw-7rem))] -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0d0e12]/88 p-1.5 text-gray-200 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl'
        }
        role="toolbar"
        aria-label="资产预览工具"
        data-image-preview-no-wheel
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={
            isModel3dPreview
              ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.055] text-gray-200 ring-1 ring-white/10'
              : 'flex min-w-0 items-center gap-1.5 border-r border-white/10 py-0.5 pl-1 pr-2'
          }
          title={isModel3dPreview ? `${adapter.label}预览` : undefined}
        >
          {iconForKind(adapter.type)}
          <div className={isModel3dPreview ? 'hidden' : 'min-w-0'}>
            <div className="truncate text-[10px] font-black text-white">{adapter.label}预览</div>
            <div className="max-w-36 truncate text-[8px] text-gray-500">{variant?.label || asset.id}</div>
          </div>
        </div>
        {isModel3dPreview ? <div className="mx-0.5 h-5 w-px shrink-0 bg-white/12" aria-hidden /> : null}
        {primaryActions.map(renderPrimaryAction)}
        <button
          type="button"
          onClick={() => setInspectorOpen((open) => !open)}
          className={`flex h-8 items-center justify-center rounded-lg border text-[10px] font-bold transition-colors ${
            isModel3dPreview ? 'w-8 px-0 [&>span]:hidden' : 'gap-1.5 px-2'
          } ${
            inspectorOpen
              ? 'border-blue-400/35 bg-blue-600/35 text-blue-100'
              : 'border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white'
          }`}
          aria-pressed={inspectorOpen}
          aria-label="面板"
          title="面板"
        >
          <SlidersHorizontal {...IC} aria-hidden />
          <span className="hidden sm:inline">面板</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="更多预览操作"
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
          <div className="mb-2 text-[11px] font-black text-white">预览面板</div>
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
                <div className="text-[9px] font-black uppercase text-gray-500">高级能力</div>
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
