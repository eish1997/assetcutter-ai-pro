import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoundingBox, CustomAppModule, WorkflowAsset } from '../../types';
import { CustomDropdown } from '../ui/CustomDropdown';
import { useDebouncedLocalText } from '../../hooks/useDebouncedLocalText';
import StoryboardSheetSplitAdjustModal from '../storyboard/StoryboardSheetSplitAdjustModal';
import { compressStoryboardFrameDataUrl } from '../storyboard/storyboardFrameImage';
import { executeCapability, getCapabilityEngine } from '../../services/capabilityExecutor';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import { getTripoApiKey } from '../../services/settingsStore';
import {
  computeAssetSetStats,
  listAssetSet3dEligibleComponents,
  listAssetSetSheetEligibleComponents,
  normalizeAssetSetDoc,
  patchAssetSetComponents,
  resolveAssetSetComponentCropSrc,
  resolveAssetSetSourceAssetDisplaySrc,
  resolveAssetSetTitle,
} from '../../services/assetSet/assetSetAsset';
import {
  applyCropPreviewsToComponents,
  buildAssetSetComponentsFromBoxes,
} from '../../services/assetSet/assetSetCrop';
import {
  createAssetSetSourceAsset,
  assetSetSourceAssetCompanionKey,
  resolveAssetSetSourceAssetBySlot,
} from '../../services/assetSet/assetSetSourceAssets';
import {
  ASSET_SET_PANEL_PREFS_KEY,
  listAssetSetImagePresets,
  listAssetSetMulti3dPresets,
  listAssetSetSingle3dPresets,
  resolveAssetSetPreset,
} from '../../services/assetSet/assetSetPresets';
import { splitAssetSetSheetToViews } from '../../services/assetSet/assetSetSheetPipeline';
import {
  pickAssetSet3dPreset,
  runAssetSetComponent3d,
} from '../../services/assetSet/assetSetBatch3d';
import {
  patchAssetSetTaskSession,
  clearAssetSetTaskSession,
  subscribeAssetSetTaskSession,
} from '../../services/assetSet/assetSetTaskSession';
import {
  assetSetComponentImageCompanionKey,
  persistAssetSetImageFields,
  resolveAssetSetImageDataUrl,
} from '../../services/assetSet/assetSetImage';
import { clearStoryboardNamedAssetImageFields } from '../../services/storyboardNamedAssetImage';
import {
  buildAssetSetCompanionHydrateKey,
  hydrateAssetSetCompanionTasks,
  listAssetSetCompanionHydrateTasks,
  applyAssetSetCompanionHydrateResults,
} from '../../services/assetSet/assetSetCompanion';
import { revokeStoryboardFrameCompanionHydrateUrls } from '../../services/storyboardFrameCompanion';
import AssetSetSourceStrip from './AssetSetSourceStrip';
import AssetSetCanvasGrid from './AssetSetCanvasGrid';
import AssetSetComponentEditor from './AssetSetComponentEditor';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_EDIT_DROPDOWN_Z,
  STORYBOARD_EDIT_EDITOR_RAIL_W,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_SIDE_RAIL,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
  ASSET_SET_MAIN_LAYOUT,
} from './assetSetPanelUi';

type Props = {
  asset: WorkflowAsset;
  capabilityPresets: CustomAppModule[];
  onClose: () => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onPatchAsset: (
    patch: Partial<WorkflowAsset> | ((prev: WorkflowAsset) => WorkflowAsset)
  ) => void;
  readOnly?: boolean;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

const CATEGORY_OPTIONS = [
  { value: 'character', label: '角色' },
  { value: 'scene', label: '场景' },
  { value: 'prop', label: '道具' },
];

export default function AssetSetPanel({
  asset,
  capabilityPresets,
  onClose,
  onNotify,
  onPatchAsset,
  readOnly = false,
  companionBaseUrl = '',
  companionProjectId = '',
}: Props) {
  const doc = useMemo(() => normalizeAssetSetDoc(asset.assetSet), [asset.assetSet]);
  const stats = useMemo(() => computeAssetSetStats(doc), [doc]);

  const imagePresets = useMemo(() => listAssetSetImagePresets(capabilityPresets), [capabilityPresets]);
  const single3dPresets = useMemo(() => listAssetSetSingle3dPresets(capabilityPresets), [capabilityPresets]);
  const multi3dPresets = useMemo(() => listAssetSetMulti3dPresets(capabilityPresets), [capabilityPresets]);
  const imagePresetOptions = useMemo(
    () => imagePresets.map((p) => ({ value: p.id, label: p.label })),
    [imagePresets]
  );
  const single3dPresetOptions = useMemo(
    () => single3dPresets.map((p) => ({ value: p.id, label: p.label })),
    [single3dPresets]
  );
  const multi3dPresetOptions = useMemo(
    () => multi3dPresets.map((p) => ({ value: p.id, label: p.label })),
    [multi3dPresets]
  );

  const scopedPrefsKey = `${ASSET_SET_PANEL_PREFS_KEY}:${asset.id}`;
  const [storedPrefs] = useState(() =>
    readLocalJson<{
      stylePresetId?: string;
      assetMultiviewPresetId?: string;
      componentSheetPresetId?: string;
      single3dPresetId?: string;
      multi3dPresetId?: string;
    }>(scopedPrefsKey, {})
  );

  const [activeComponentId, setActiveComponentId] = useState<string | null>(
    doc.components[0]?.id ?? null
  );
  const [selectedComponentIds, setSelectedComponentIds] = useState<Set<string>>(new Set());
  const [sourceBusyId, setSourceBusyId] = useState<string | null>(null);
  const [busyComponentId, setBusyComponentId] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskProgress, setTaskProgress] = useState<{ done: number; total: number } | null>(null);
  const selectionAnchorRef = useRef<string | null>(null);
  const [hydrateSeq, setHydrateSeq] = useState(0);
  const hydrateDebounceRef = useRef(0);

  const requestCompanionHydrate = useCallback(() => {
    const now = Date.now();
    if (now - hydrateDebounceRef.current < 800) return;
    hydrateDebounceRef.current = now;
    setHydrateSeq((seq) => seq + 1);
  }, []);

  const panelPrefs = { ...storedPrefs, ...doc.panelPrefs };
  const stylePreset = resolveAssetSetPreset(imagePresets, panelPrefs.stylePresetId, imagePresets[0]);
  const assetMvPreset = resolveAssetSetPreset(
    imagePresets,
    panelPrefs.assetMultiviewPresetId,
    imagePresets[0]
  );
  const sheetPreset = resolveAssetSetPreset(
    imagePresets,
    panelPrefs.componentSheetPresetId,
    imagePresets[0]
  );
  const single3dPreset = resolveAssetSetPreset(
    single3dPresets,
    panelPrefs.single3dPresetId,
    single3dPresets[0]
  );
  const multi3dPreset = resolveAssetSetPreset(
    multi3dPresets,
    panelPrefs.multi3dPresetId,
    multi3dPresets[0]
  );

  const styledAsset = resolveAssetSetSourceAssetBySlot(doc.sourceAssets, 'styled');
  const originalAsset = resolveAssetSetSourceAssetBySlot(doc.sourceAssets, 'original');
  const styledSrc = resolveAssetSetSourceAssetDisplaySrc(styledAsset);
  const originalSrc = resolveAssetSetSourceAssetDisplaySrc(originalAsset);

  const activeComponent = doc.components.find((c) => c.id === activeComponentId) ?? null;

  const patchDoc = useCallback(
    (mutate: (prev: typeof doc) => typeof doc) => {
      onPatchAsset((prev) => {
        const cur = normalizeAssetSetDoc(prev.assetSet);
        const nextDoc = mutate(cur);
        return {
          ...prev,
          assetSet: nextDoc,
          textTitle: nextDoc.title?.trim() || prev.textTitle,
        };
      });
    },
    [onPatchAsset]
  );

  const commitTitle = useCallback(
    (value: string) => {
      patchDoc((prev) => ({ ...prev, title: value }));
    },
    [patchDoc]
  );
  const titleField = useDebouncedLocalText(doc.title ?? '', commitTitle);

  const savePanelPref = useCallback(
    (key: keyof typeof panelPrefs, value: string) => {
      const nextPrefs = { ...panelPrefs, [key]: value };
      writeLocalJson(scopedPrefsKey, nextPrefs);
      patchDoc((prev) => ({
        ...prev,
        panelPrefs: { ...prev.panelPrefs, [key]: value },
      }));
    },
    [panelPrefs, patchDoc, scopedPrefsKey]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !splitOpen) onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, splitOpen]);

  useEffect(() => {
    return subscribeAssetSetTaskSession(asset.id, (session) => {
      setTaskBusy(session.busy);
      setTaskProgress(session.progress);
    });
  }, [asset.id]);

  const companionHydrateKey = useMemo(
    () => buildAssetSetCompanionHydrateKey([asset]),
    [asset]
  );

  useEffect(() => {
    requestCompanionHydrate();
  }, [companionHydrateKey, requestCompanionHydrate]);

  useEffect(() => {
    if (!hydrateSeq) return;
    const base = String(companionBaseUrl || '').trim();
    const pid = String(companionProjectId || '').trim();
    if (!base || !pid) return;
    let cancelled = false;
    void (async () => {
      const tasks = listAssetSetCompanionHydrateTasks([asset]);
      const { hydrated, failures } = await hydrateAssetSetCompanionTasks(tasks, base, pid);
      if (cancelled) {
        revokeStoryboardFrameCompanionHydrateUrls(hydrated);
        return;
      }
      for (const failure of failures) {
        onNotify?.('warn', `图片恢复失败：${failure.error}`);
      }
      if (!hydrated.length) return;
      onPatchAsset((cur) => {
        if (cur.id !== asset.id) return cur;
        return applyAssetSetCompanionHydrateResults([cur], hydrated)[0] ?? cur;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    asset,
    companionBaseUrl,
    companionProjectId,
    hydrateSeq,
    onNotify,
    onPatchAsset,
  ]);

  useEffect(() => {
    if (activeComponentId && doc.components.some((c) => c.id === activeComponentId)) return;
    setActiveComponentId(doc.components[0]?.id ?? null);
  }, [activeComponentId, doc.components]);

  const handleCanvasSelect = useCallback(
    (componentId: string, modifiers?: { additive?: boolean; range?: boolean }) => {
      setActiveComponentId(componentId);
      setSelectedComponentIds((prev) => {
        if (modifiers?.range && selectionAnchorRef.current) {
          const ids = doc.components.map((c) => c.id);
          const a = ids.indexOf(selectionAnchorRef.current);
          const b = ids.indexOf(componentId);
          if (a >= 0 && b >= 0) {
            const [start, end] = a < b ? [a, b] : [b, a];
            const rangeIds = ids.slice(start, end + 1);
            return modifiers.additive ? new Set([...prev, ...rangeIds]) : new Set(rangeIds);
          }
        }
        if (modifiers?.additive) {
          const next = new Set(prev);
          if (next.has(componentId)) next.delete(componentId);
          else next.add(componentId);
          return next;
        }
        selectionAnchorRef.current = componentId;
        return new Set([componentId]);
      });
    },
    [doc.components]
  );

  const handleMarqueeSelect = useCallback((ids: string[], additive: boolean) => {
    setSelectedComponentIds((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
    if (ids[0]) setActiveComponentId(ids[0]);
  }, []);

  const assignSourceImage = useCallback(
    async (sourceId: string, file: File) => {
      if (readOnly) return;
      setSourceBusyId(sourceId);
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(file);
        });
        const compressed = await compressStoryboardFrameDataUrl(dataUrl);
        const fields = await persistAssetSetImageFields({
          dataUrl: compressed,
          tableAssetId: asset.id,
          companionKey: assetSetSourceAssetCompanionKey(sourceId),
          companionBaseUrl,
          companionProjectId,
        });
        patchDoc((prev) => ({
          ...prev,
          sourceAssets: prev.sourceAssets.map((item) =>
            item.id === sourceId ? { ...item, ...fields } : item
          ),
        }));
      } catch (e) {
        onNotify?.('error', e instanceof Error ? e.message : '上传失败');
      } finally {
        setSourceBusyId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchDoc, readOnly]
  );

  const runSourceCapability = useCallback(
    async (slotKind: 'styled' | 'multiview', preset: CustomAppModule | null) => {
      if (readOnly || !preset) {
        onNotify?.('warn', '请选择能力预设');
        return;
      }
      if (getCapabilityEngine(preset) !== 'gen_image') {
        onNotify?.('warn', '需选择图生图/文生图预设');
        return;
      }
      const source = resolveAssetSetSourceAssetBySlot(doc.sourceAssets, 'original');
      const resolved = await resolveAssetSetImageDataUrl(
        source,
        companionBaseUrl,
        companionProjectId
      );
      if (!resolved.ok) {
        onNotify?.('warn', resolved.error);
        return;
      }
      const target = resolveAssetSetSourceAssetBySlot(doc.sourceAssets, slotKind);
      if (!target) return;
      setSourceBusyId(target.id);
      try {
        const result = await executeCapability(preset, resolved.dataUrl, {
          onLog: (level, message) => onNotify?.(level, message),
        });
        const out = result.ok && result.kind === 'image' ? result.image : '';
        if (!out) {
          onNotify?.('error', '生成未返回图片');
          return;
        }
        const compressed = await compressStoryboardFrameDataUrl(out);
        const fields = await persistAssetSetImageFields({
          dataUrl: compressed,
          tableAssetId: asset.id,
          companionKey: assetSetSourceAssetCompanionKey(target.id),
          companionBaseUrl,
          companionProjectId,
        });
        patchDoc((prev) => ({
          ...prev,
          sourceAssets: prev.sourceAssets.map((item) =>
            item.id === target.id ? { ...item, ...fields } : item
          ),
        }));
        onNotify?.('info', slotKind === 'styled' ? '转风格完成' : '多视角拼图已生成');
      } catch (e) {
        onNotify?.('error', e instanceof Error ? e.message : '生成失败');
      } finally {
        setSourceBusyId(null);
      }
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      doc.sourceAssets,
      onNotify,
      patchDoc,
      readOnly,
    ]
  );

  const confirmSplit = useCallback(
    async (boxes: BoundingBox[]) => {
      if (!styledAsset) return;
      const styledResolved = await resolveAssetSetImageDataUrl(
        styledAsset,
        companionBaseUrl,
        companionProjectId
      );
      const styledDataUrl = styledResolved.ok ? styledResolved.dataUrl : styledSrc;
      if (!styledDataUrl) {
        onNotify?.('warn', '风格图无法加载，请重新转风格');
        return;
      }
      const built = buildAssetSetComponentsFromBoxes(boxes, doc.components);
      const withCrops = await applyCropPreviewsToComponents(styledDataUrl, built);
      const withPersistedCrops = await Promise.all(
        withCrops.map(async (component) => {
          if (!component.cropPreview) return component;
          const compressed = await compressStoryboardFrameDataUrl(component.cropPreview);
          const fields = await persistAssetSetImageFields({
            dataUrl: compressed,
            tableAssetId: asset.id,
            companionKey: assetSetComponentImageCompanionKey(component.id, 'crop'),
            companionBaseUrl,
            companionProjectId,
          });
          return {
            ...component,
            cropPreview: fields.image ?? compressed,
            cropPreviewCompanionKey: fields.imageCompanionKey,
            cropPreviewObjectKey: fields.imageObjectKey,
          };
        })
      );
      patchDoc((prev) => ({ ...prev, components: withPersistedCrops }));
      setSplitOpen(false);
      if (withPersistedCrops[0]) {
        setActiveComponentId(withPersistedCrops[0].id);
        setSelectedComponentIds(new Set(withPersistedCrops.map((c) => c.id)));
      }
      onNotify?.('info', `已创建 ${withPersistedCrops.length} 个组件占位格`);
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      doc.components,
      onNotify,
      patchDoc,
      styledAsset,
      styledSrc,
    ]
  );

  const selectedList = useMemo(
    () => [...selectedComponentIds],
    [selectedComponentIds]
  );

  const sheetEligible = useMemo(() => {
    const pool = selectedList.length
      ? doc.components.filter((c) => selectedList.includes(c.id))
      : doc.components;
    return listAssetSetSheetEligibleComponents(pool);
  }, [doc.components, selectedList]);

  const runComponentSheetBatch = useCallback(async () => {
    if (readOnly || !sheetPreset || sheetEligible.length === 0) return;
    const total = sheetEligible.length;
    patchAssetSetTaskSession(asset.id, {
      kind: 'component_sheet',
      busy: true,
      progress: { done: 0, total },
      busyComponentIds: new Set(sheetEligible.map((c) => c.id)),
    });
    const pendingPatches = new Map<string, import('../../types').AssetSetComponent>();
    let done = 0;
    for (const component of sheetEligible) {
      setBusyComponentId(component.id);
      try {
        const cropResolved = await resolveAssetSetImageDataUrl(
          {
            image: component.cropPreview,
            imageCompanionKey: component.cropPreviewCompanionKey,
            imageObjectKey: component.cropPreviewObjectKey,
          },
          companionBaseUrl,
          companionProjectId
        );
        const cropSrc = cropResolved.ok
          ? cropResolved.dataUrl
          : resolveAssetSetComponentCropSrc(component);
        if (!cropSrc) continue;
        const result = await executeCapability(sheetPreset, cropSrc);
        const sheet = result.ok && result.kind === 'image' ? result.image : '';
        if (!sheet) continue;
        const compressed = await compressStoryboardFrameDataUrl(sheet);
        const split = await splitAssetSetSheetToViews(compressed);
        const sheetFields = await persistAssetSetImageFields({
          dataUrl: compressed,
          tableAssetId: asset.id,
          companionKey: assetSetComponentImageCompanionKey(component.id, 'sheet'),
          companionBaseUrl,
          companionProjectId,
        });
        const viewsWithPersist = await Promise.all(
          split.views.map(async (view) => {
            if (!view.image) return view;
            const viewCompressed = await compressStoryboardFrameDataUrl(view.image);
            const vFields = await persistAssetSetImageFields({
              dataUrl: viewCompressed,
              tableAssetId: asset.id,
              companionKey: assetSetComponentImageCompanionKey(component.id, 'view', view.id),
              companionBaseUrl,
              companionProjectId,
            });
            return {
              ...view,
              image: vFields.image ?? viewCompressed,
              imageCompanionKey: vFields.imageCompanionKey,
              imageObjectKey: vFields.imageObjectKey,
            };
          })
        );
        pendingPatches.set(component.id, {
          ...component,
          multiviewSheet: sheetFields.image ?? compressed,
          multiviewSheetCompanionKey: sheetFields.imageCompanionKey,
          multiviewSheetObjectKey: sheetFields.imageObjectKey,
          views: viewsWithPersist,
          model3d: undefined,
        });
      } catch (e) {
        onNotify?.('warn', e instanceof Error ? e.message : '组件出图失败');
      } finally {
        done += 1;
        patchAssetSetTaskSession(asset.id, {
          progress: { done, total },
        });
        setBusyComponentId(null);
      }
    }
    if (pendingPatches.size > 0) {
      patchDoc((prev) => ({
        ...prev,
        components: prev.components.map((c) => pendingPatches.get(c.id) ?? c),
      }));
    }
    clearAssetSetTaskSession(asset.id);
    onNotify?.('info', `组件多视角：${pendingPatches.size}/${total} 完成`);
  }, [
    asset.id,
    companionBaseUrl,
    companionProjectId,
    onNotify,
    patchDoc,
    readOnly,
    sheetEligible,
    sheetPreset,
  ]);

  const threeDEligible = useMemo(() => {
    const pool = selectedList.length
      ? doc.components.filter((c) => selectedList.includes(c.id))
      : doc.components;
    return listAssetSet3dEligibleComponents(pool);
  }, [doc.components, selectedList]);

  const runBatch3d = useCallback(async () => {
    if (readOnly || threeDEligible.length === 0) return;
    const apiKey = getTripoApiKey();
    if (!apiKey) {
      onNotify?.('warn', '请先在设置中配置 Tripo API Key');
      return;
    }
    const total = threeDEligible.length;
    patchAssetSetTaskSession(asset.id, {
      kind: 'batch_3d',
      busy: true,
      progress: { done: 0, total },
      busyComponentIds: new Set(threeDEligible.map((c) => c.id)),
    });
    let done = 0;
    for (const component of threeDEligible) {
      const preset = pickAssetSet3dPreset(component.views, single3dPreset, multi3dPreset);
      if (!preset) {
        onNotify?.('warn', `组件 ${component.name}：无可用 3D 预设`);
        done += 1;
        continue;
      }
      setBusyComponentId(component.id);
      patchDoc((prev) =>
        patchAssetSetComponents(prev, [component.id], (c) => ({
          ...c,
          model3d: { status: 'running', updatedAt: Date.now() },
        }))
      );
      const result = await runAssetSetComponent3d({
        apiKey,
        preset,
        component,
        onStatus: (status) => {
          patchDoc((prev) =>
            patchAssetSetComponents(prev, [component.id], (c) => ({
              ...c,
              model3d: {
                status: status === 'queued' ? 'queued' : 'running',
                updatedAt: Date.now(),
              },
            }))
          );
        },
      });
      patchDoc((prev) =>
        patchAssetSetComponents(prev, [component.id], (c) => ({
          ...c,
          model3d: result.ok
            ? {
                status: 'done',
                jobId: result.jobId,
                provider: 'tripo',
                files: result.files,
                previewUrl: result.previewUrl,
                updatedAt: Date.now(),
              }
            : {
                status: 'failed',
                error: result.error,
                updatedAt: Date.now(),
              },
        }))
      );
      done += 1;
      patchAssetSetTaskSession(asset.id, { progress: { done, total } });
      setBusyComponentId(null);
    }
    clearAssetSetTaskSession(asset.id);
    onNotify?.('info', `批量 3D：${done}/${total} 完成`);
  }, [
    asset.id,
    multi3dPreset,
    onNotify,
    patchDoc,
    readOnly,
    single3dPreset,
    threeDEligible,
  ]);

  const splitSeedBoxes = useMemo(
    () => doc.components.map((c) => c.cropRegion),
    [doc.components]
  );

  const handleActiveComponentRename = useCallback(
    (name: string) => {
      if (!activeComponentId) return;
      patchDoc((prev) => patchAssetSetComponents(prev, [activeComponentId], { name }));
    },
    [activeComponentId, patchDoc]
  );

  const handleActiveComponentToggleLock = useCallback(
    (locked: boolean) => {
      if (!activeComponentId) return;
      patchDoc((prev) => patchAssetSetComponents(prev, [activeComponentId], { locked }));
    },
    [activeComponentId, patchDoc]
  );

  const panel = (
    <div className="fixed inset-0 z-[2100] flex flex-col bg-[#07090c]/95 backdrop-blur-md">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/70">
            资产集
          </p>
          <input
            type="text"
            value={titleField.draft}
            disabled={readOnly}
            onChange={(e) => titleField.onChange(e.target.value)}
            onBlur={titleField.onBlur}
            placeholder={resolveAssetSetTitle(asset)}
            className="mt-0.5 w-full max-w-md bg-transparent text-lg font-bold text-gray-50 outline-none placeholder:text-gray-600"
          />
        </div>
        <CustomDropdown
          value={doc.category}
          options={CATEGORY_OPTIONS}
          disabled={readOnly}
          onChange={(value) =>
            patchDoc((prev) => ({
              ...prev,
              category: value as typeof doc.category,
            }))
          }
          triggerClassName="h-8 min-w-[5rem] rounded-lg bg-white/5 px-2 text-[11px] text-gray-200 ring-1 ring-white/10"
          portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
        />
        <span className="text-[10px] tabular-nums text-gray-500">
          {stats.componentCount} 组件 · {stats.withViewsCount} 已出图 · {stats.withModelCount} 已出模
        </span>
        <button type="button" onClick={onClose} className={STORYBOARD_TOOL_BTN_NEUTRAL}>
          关闭
        </button>
      </header>

      <div className={`flex min-h-0 flex-1 flex-col ${STORYBOARD_PAD_PANEL}`}>
        <div className="mb-3 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
          <p className={`${STORYBOARD_COLUMN_HEAD} !mb-2`}>参考图条（L0）</p>
          <AssetSetSourceStrip
            assets={doc.sourceAssets}
            readOnly={readOnly}
            busyId={sourceBusyId}
            onAdd={() =>
              patchDoc((prev) => ({
                ...prev,
                sourceAssets: [
                  ...prev.sourceAssets,
                  createAssetSetSourceAsset({ slotKind: 'custom' }, prev.sourceAssets.length),
                ],
              }))
            }
            onRemove={(id) =>
              patchDoc((prev) => ({
                ...prev,
                sourceAssets: prev.sourceAssets.filter((item) => item.id !== id),
              }))
            }
            onRename={(id, name) =>
              patchDoc((prev) => ({
                ...prev,
                sourceAssets: prev.sourceAssets.map((item) =>
                  item.id === id ? { ...item, name } : item
                ),
              }))
            }
            onAssignImage={(id, file) => void assignSourceImage(id, file)}
            onClearImage={(id) =>
              patchDoc((prev) => ({
                ...prev,
                sourceAssets: prev.sourceAssets.map((item) =>
                  item.id === id ? { ...item, ...clearStoryboardNamedAssetImageFields() } : item
                ),
              }))
            }
            onSourceAssetImageClick={(sourceAsset) => {
              if (sourceAsset.slotKind !== 'styled') return false;
              if (!resolveAssetSetSourceAssetDisplaySrc(sourceAsset)) return false;
              setSplitOpen(true);
              return true;
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CustomDropdown
              value={stylePreset?.id ?? ''}
              options={imagePresetOptions}
              disabled={readOnly || taskBusy}
              onChange={(value) => savePanelPref('stylePresetId', value)}
              triggerClassName="h-7 min-w-[8rem] rounded-lg bg-white/5 px-2 text-[10px] text-gray-200 ring-1 ring-white/10"
              portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
            />
            <button
              type="button"
              disabled={readOnly || !originalSrc || taskBusy}
              onClick={() => void runSourceCapability('styled', stylePreset)}
              className={STORYBOARD_TOOL_BTN_PRIMARY}
            >
              转风格
            </button>
            <CustomDropdown
              value={assetMvPreset?.id ?? ''}
              options={imagePresetOptions}
              disabled={readOnly || taskBusy}
              onChange={(value) => savePanelPref('assetMultiviewPresetId', value)}
              triggerClassName="h-7 min-w-[8rem] rounded-lg bg-white/5 px-2 text-[10px] text-gray-200 ring-1 ring-white/10"
              portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
            />
            <button
              type="button"
              disabled={readOnly || !originalSrc || taskBusy}
              onClick={() => void runSourceCapability('multiview', assetMvPreset)}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              资产级多视角
            </button>
          </div>
        </div>

        <div className={ASSET_SET_MAIN_LAYOUT}>
          <div className={`${STORYBOARD_SIDE_RAIL} flex min-h-0 min-w-0 flex-col`}>
            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0`}>组件画板</p>
              <span className="text-[9px] text-gray-500">已选 {selectedComponentIds.size}</span>
            </div>
            <div className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1`}>
              <AssetSetCanvasGrid
                components={doc.components}
                activeComponentId={activeComponentId}
                selectedComponentIds={selectedComponentIds}
                busyComponentId={busyComponentId}
                readOnly={readOnly}
                onSelectComponent={handleCanvasSelect}
                onMarqueeSelect={handleMarqueeSelect}
              />
            </div>
            {!readOnly ? (
              <div className="mt-2 flex shrink-0 flex-wrap gap-1.5">
                <CustomDropdown
                  value={sheetPreset?.id ?? ''}
                  options={imagePresetOptions}
                  disabled={taskBusy}
                  onChange={(value) => savePanelPref('componentSheetPresetId', value)}
                  triggerClassName="h-7 min-w-[7rem] rounded-lg bg-white/5 px-2 text-[10px] ring-1 ring-white/10"
                  portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
                />
                <button
                  type="button"
                  disabled={taskBusy || sheetEligible.length === 0}
                  onClick={() => void runComponentSheetBatch()}
                  className={STORYBOARD_TOOL_BTN_PRIMARY}
                >
                  {taskBusy && taskProgress
                    ? `出图中 ${taskProgress.done}/${taskProgress.total}`
                    : `生成组件多视角 (${sheetEligible.length})`}
                </button>
                <CustomDropdown
                  value={single3dPreset?.id ?? ''}
                  options={single3dPresetOptions}
                  disabled={taskBusy}
                  onChange={(value) => savePanelPref('single3dPresetId', value)}
                  triggerClassName="h-7 min-w-[6rem] rounded-lg bg-white/5 px-2 text-[10px] ring-1 ring-white/10"
                  portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
                />
                <CustomDropdown
                  value={multi3dPreset?.id ?? ''}
                  options={multi3dPresetOptions}
                  disabled={taskBusy}
                  onChange={(value) => savePanelPref('multi3dPresetId', value)}
                  triggerClassName="h-7 min-w-[6rem] rounded-lg bg-white/5 px-2 text-[10px] ring-1 ring-white/10"
                  portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
                />
                <button
                  type="button"
                  disabled={taskBusy || threeDEligible.length === 0}
                  onClick={() => void runBatch3d()}
                  className={STORYBOARD_TOOL_BTN_PRIMARY}
                >
                  批量 3D ({threeDEligible.length})
                </button>
              </div>
            ) : null}
          </div>

          <aside className={`${STORYBOARD_SIDE_RAIL} ${STORYBOARD_EDIT_EDITOR_RAIL_W} min-h-0 shrink-0`}>
            <p className={`${STORYBOARD_COLUMN_HEAD} shrink-0`}>组件编辑</p>
            <div className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1`}>
              {activeComponent ? (
                <AssetSetComponentEditor
                  component={activeComponent}
                  readOnly={readOnly}
                  onRename={handleActiveComponentRename}
                  onToggleLock={handleActiveComponentToggleLock}
                />
              ) : (
                <p className="py-8 text-center text-[10px] text-gray-600">请选择组件</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      <StoryboardSheetSplitAdjustModal
        open={splitOpen}
        imageSrc={styledSrc}
        boxes={splitSeedBoxes}
        sheetLabel="风格图拆分"
        onClose={() => setSplitOpen(false)}
        onConfirm={(boxes) => void confirmSplit(boxes)}
      />
    </div>
  );

  return createPortal(panel, document.body);
}
