import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssetSetComponent, BoundingBox, CustomAppModule, WorkflowAsset } from '../../types';
import { CustomDropdown } from '../ui/CustomDropdown';
import { ImagePreviewOverlay } from '../ImagePreviewOverlay';
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
  buildAssetSetComponentsFromBoxesAppend,
} from '../../services/assetSet/assetSetCrop';
import {
  ASSET_SET_GENERATION_OUTPUT_OPTIONS,
  assetSetGenerationInputRefKey,
  defaultAssetSetGenerationInputRef,
  listAssetSetGenerationInputOptions,
  nextAssetSetGenerationOutputName,
  parseAssetSetGenerationInputRefKey,
  resolveAssetSetGenerationInputFields,
  type AssetSetGenerationInputRef,
  type AssetSetGenerationOutputMode,
} from '../../services/assetSet/assetSetGeneration';
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
  resolveAssetSetComponentSheetPresetFallback,
  resolveAssetSetPreset,
} from '../../services/assetSet/assetSetPresets';
import { splitAssetSetSheetToViews } from '../../services/assetSet/assetSetSheetPipeline';
import {
  pickAssetSet3dPreset,
  persistAssetSetComponent3dModels,
  runAssetSetComponent3d,
} from '../../services/assetSet/assetSetBatch3d';
import {
  abortAssetSetTaskSession,
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

const ASSET_SET_LIGHTBOX_Z = 'z-[2180]';

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
      genPresetId?: string;
      genOutputMode?: AssetSetGenerationOutputMode;
    }>(scopedPrefsKey, {})
  );

  const [activeComponentId, setActiveComponentId] = useState<string | null>(
    doc.components[0]?.id ?? null
  );
  const [selectedComponentIds, setSelectedComponentIds] = useState<Set<string>>(new Set());
  const [sourceBusyId, setSourceBusyId] = useState<string | null>(null);
  const [busyComponentId, setBusyComponentId] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSourceAssetId, setSplitSourceAssetId] = useState<string | null>(null);
  const [splitAppendMode, setSplitAppendMode] = useState(true);
  const [genInputKey, setGenInputKey] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskKind, setTaskKind] = useState<'component_sheet' | 'batch_3d' | null>(null);
  const [taskProgress, setTaskProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
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
  const genOutputMode: AssetSetGenerationOutputMode =
    panelPrefs.genOutputMode === 'styled' ||
    panelPrefs.genOutputMode === 'multiview' ||
    panelPrefs.genOutputMode === 'append'
      ? panelPrefs.genOutputMode
      : 'append';
  const genPreset = resolveAssetSetPreset(
    imagePresets,
    panelPrefs.genPresetId || panelPrefs.stylePresetId,
    imagePresets[0]
  );
  const sheetPreset = resolveAssetSetPreset(
    imagePresets,
    panelPrefs.componentSheetPresetId,
    resolveAssetSetComponentSheetPresetFallback(imagePresets)
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

  const genInputOptions = useMemo(() => listAssetSetGenerationInputOptions(doc), [doc]);
  const genInputRef = useMemo(
    () => parseAssetSetGenerationInputRefKey(genInputKey),
    [genInputKey]
  );
  const genInputHasImage = useMemo(
    () => genInputOptions.find((o) => o.key === genInputKey)?.hasImage ?? false,
    [genInputKey, genInputOptions]
  );
  const genInputSelectOptions = useMemo(
    () =>
      genInputOptions.map((o) => ({
        value: o.key,
        label: o.hasImage ? o.label : `${o.label}（无图）`,
        disabled: !o.hasImage,
      })),
    [genInputOptions]
  );
  const genInputHighlightSourceId =
    genInputRef?.kind === 'source' ? genInputRef.sourceId : null;

  const splitSourceAsset = useMemo(() => {
    if (splitSourceAssetId) {
      return doc.sourceAssets.find((s) => s.id === splitSourceAssetId);
    }
    if (genInputRef?.kind === 'source') {
      return doc.sourceAssets.find((s) => s.id === genInputRef.sourceId);
    }
    return styledAsset ?? doc.sourceAssets.find((s) => resolveAssetSetSourceAssetDisplaySrc(s));
  }, [doc.sourceAssets, genInputRef, splitSourceAssetId, styledAsset]);
  const splitSourceSrc = resolveAssetSetSourceAssetDisplaySrc(splitSourceAsset);
  const canSplitCurrent =
    genInputRef?.kind !== 'component' && Boolean(splitSourceSrc);

  useEffect(() => {
    if (genInputKey && genInputOptions.some((o) => o.key === genInputKey && o.hasImage)) return;
    const def = defaultAssetSetGenerationInputRef(doc);
    if (def) setGenInputKey(assetSetGenerationInputRefKey(def));
  }, [doc, genInputKey, genInputOptions]);

  const openLightbox = useCallback((src: string) => {
    const trimmed = String(src || '').trim();
    if (trimmed) setLightboxSrc(trimmed);
  }, []);

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
      setTaskKind(session.kind);
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

  const runGeneration = useCallback(
    async (params: {
      inputRef: AssetSetGenerationInputRef;
      preset: CustomAppModule | null;
      outputMode: AssetSetGenerationOutputMode;
      outputComponentId?: string;
      successMessage?: string;
    }) => {
      if (readOnly || !params.preset) {
        onNotify?.('warn', '请选择能力预设');
        return null;
      }
      if (getCapabilityEngine(params.preset) !== 'gen_image') {
        onNotify?.('warn', '需选择图生图/文生图预设');
        return null;
      }
      const fields = resolveAssetSetGenerationInputFields(doc, params.inputRef);
      const resolved = await resolveAssetSetImageDataUrl(
        fields,
        companionBaseUrl,
        companionProjectId
      );
      if (!resolved.ok) {
        onNotify?.('warn', resolved.error);
        return null;
      }
      const busyKey =
        params.inputRef.kind === 'source'
          ? params.inputRef.sourceId
          : params.inputRef.componentId;
      setSourceBusyId(busyKey);
      try {
        const result = await executeCapability(params.preset, resolved.dataUrl, {
          onLog: (level, message) => onNotify?.(level, message),
        });
        const out = result.ok && result.kind === 'image' ? result.image : '';
        if (!out) {
          onNotify?.('error', '生成未返回图片');
          return null;
        }
        const compressed = await compressStoryboardFrameDataUrl(out);

        if (params.outputComponentId) {
          const fieldsOut = await persistAssetSetImageFields({
            dataUrl: compressed,
            tableAssetId: asset.id,
            companionKey: assetSetComponentImageCompanionKey(params.outputComponentId, 'crop'),
            companionBaseUrl,
            companionProjectId,
          });
          patchDoc((prev) =>
            patchAssetSetComponents(prev, [params.outputComponentId!], (c) => ({
              ...c,
              cropPreview: fieldsOut.image ?? compressed,
              cropPreviewCompanionKey: fieldsOut.imageCompanionKey,
              cropPreviewObjectKey: fieldsOut.imageObjectKey,
              views: [],
              multiviewSheet: undefined,
              multiviewSheetCompanionKey: undefined,
              multiviewSheetObjectKey: undefined,
              model3d: undefined,
            }))
          );
          onNotify?.('info', params.successMessage ?? '裁切图已更新');
          return { kind: 'component' as const, componentId: params.outputComponentId };
        }

        if (params.outputMode === 'append') {
          const newId = Math.random().toString(36).slice(2, 11);
          const name = nextAssetSetGenerationOutputName(doc.sourceAssets);
          const fieldsOut = await persistAssetSetImageFields({
            dataUrl: compressed,
            tableAssetId: asset.id,
            companionKey: assetSetSourceAssetCompanionKey(newId),
            companionBaseUrl,
            companionProjectId,
          });
          const newAsset = createAssetSetSourceAsset(
            {
              id: newId,
              name,
              slotKind: 'custom',
              image: fieldsOut.image ?? compressed,
              imageCompanionKey: fieldsOut.imageCompanionKey,
              imageObjectKey: fieldsOut.imageObjectKey,
            },
            doc.sourceAssets.length
          );
          patchDoc((prev) => ({
            ...prev,
            sourceAssets: [...prev.sourceAssets, newAsset],
          }));
          setGenInputKey(assetSetGenerationInputRefKey({ kind: 'source', sourceId: newId }));
          onNotify?.('info', params.successMessage ?? `已追加「${name}」`);
          return { kind: 'source' as const, sourceId: newId };
        }

        const slotKind = params.outputMode;
        const target = resolveAssetSetSourceAssetBySlot(doc.sourceAssets, slotKind);
        if (!target) {
          onNotify?.('warn', `缺少 ${slotKind} 槽位`);
          return null;
        }
        const fieldsOut = await persistAssetSetImageFields({
          dataUrl: compressed,
          tableAssetId: asset.id,
          companionKey: assetSetSourceAssetCompanionKey(target.id),
          companionBaseUrl,
          companionProjectId,
        });
        patchDoc((prev) => ({
          ...prev,
          sourceAssets: prev.sourceAssets.map((item) =>
            item.id === target.id ? { ...item, ...fieldsOut } : item
          ),
        }));
        setGenInputKey(assetSetGenerationInputRefKey({ kind: 'source', sourceId: target.id }));
        onNotify?.(
          'info',
          params.successMessage ?? (slotKind === 'styled' ? '转风格完成' : '多视角拼图已生成')
        );
        return { kind: 'source' as const, sourceId: target.id };
      } catch (e) {
        onNotify?.('error', e instanceof Error ? e.message : '生成失败');
        return null;
      } finally {
        setSourceBusyId(null);
      }
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      doc,
      onNotify,
      patchDoc,
      readOnly,
    ]
  );

  const openSplitForSource = useCallback((sourceId: string) => {
    setSplitSourceAssetId(sourceId);
    setSplitAppendMode(doc.components.length > 0);
    setSplitOpen(true);
  }, [doc.components.length]);

  const confirmSplit = useCallback(
    async (boxes: BoundingBox[]) => {
      if (!splitSourceAsset) return;
      const sourceResolved = await resolveAssetSetImageDataUrl(
        splitSourceAsset,
        companionBaseUrl,
        companionProjectId
      );
      const sourceDataUrl = sourceResolved.ok
        ? sourceResolved.dataUrl
        : splitSourceSrc || '';
      if (!sourceDataUrl) {
        onNotify?.('warn', '拆分底图无法加载');
        return;
      }
      const built = splitAppendMode
        ? buildAssetSetComponentsFromBoxesAppend(boxes, doc.components)
        : buildAssetSetComponentsFromBoxes(boxes, []);
      const withCrops = await applyCropPreviewsToComponents(sourceDataUrl, built);
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
      const nextComponents = splitAppendMode
        ? [...doc.components, ...withPersistedCrops]
        : withPersistedCrops;
      patchDoc((prev) => ({ ...prev, components: nextComponents }));
      setSplitOpen(false);
      if (withPersistedCrops[0]) {
        setActiveComponentId(withPersistedCrops[0].id);
        setSelectedComponentIds(new Set(withPersistedCrops.map((c) => c.id)));
      }
      onNotify?.(
        'info',
        splitAppendMode
          ? `已追加 ${withPersistedCrops.length} 个组件（共 ${nextComponents.length} 个）`
          : `已创建 ${withPersistedCrops.length} 个组件`
      );
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      doc.components,
      onNotify,
      patchDoc,
      splitAppendMode,
      splitSourceAsset,
      splitSourceSrc,
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
    const abortController = new AbortController();
    patchAssetSetTaskSession(asset.id, {
      kind: 'component_sheet',
      busy: true,
      progress: { done: 0, total },
      busyComponentIds: new Set(sheetEligible.map((c) => c.id)),
      abortController,
    });
    const pendingPatches = new Map<string, import('../../types').AssetSetComponent>();
    let done = 0;
    let cancelled = false;
    for (const component of sheetEligible) {
      if (abortController.signal.aborted) {
        cancelled = true;
        break;
      }
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
    if (cancelled) {
      onNotify?.('info', `组件多视角已取消：${pendingPatches.size}/${total} 完成`);
    } else {
      onNotify?.('info', `组件多视角：${pendingPatches.size}/${total} 完成`);
    }
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

  const runOneComponent3d = useCallback(
    async (component: AssetSetComponent, options?: { forceNew?: boolean }) => {
      const apiKey = getTripoApiKey();
      if (!apiKey) {
        onNotify?.('warn', '请先在设置中配置 Tripo API Key');
        return false;
      }
      const preset = pickAssetSet3dPreset(component.views, single3dPreset, multi3dPreset);
      if (!preset) {
        onNotify?.('warn', `组件 ${component.name ?? component.id}：无可用 3D 预设`);
        return false;
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
        existingJobId: options?.forceNew ? undefined : component.model3d?.jobId,
        forceNewTask: options?.forceNew,
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
      if (result.ok) {
        let files = result.files;
        let fileCompanionKeys: string[] | undefined;
        let previewUrl = result.previewUrl;
        let previewCompanionKey: string | undefined;
        try {
          const persisted = await persistAssetSetComponent3dModels({
            apiKey,
            taskId: result.jobId,
            assetId: asset.id,
            componentId: component.id,
            glbSourceUrls: result.files,
            previewUrl: result.previewUrl,
            companionBaseUrl,
            companionProjectId,
            existing: component.model3d,
            onLog: (level, message) => onNotify?.(level, message),
          });
          files = persisted.files;
          fileCompanionKeys = persisted.fileCompanionKeys;
          previewUrl = persisted.previewUrl;
          previewCompanionKey = persisted.previewCompanionKey;
        } catch (e) {
          onNotify?.(
            'warn',
            e instanceof Error ? e.message : '3D 模型落盘失败，仅保留远程链接'
          );
        }
        patchDoc((prev) =>
          patchAssetSetComponents(prev, [component.id], (c) => ({
            ...c,
            model3d: {
              status: 'done',
              jobId: result.jobId,
              provider: 'tripo',
              files,
              fileCompanionKeys,
              previewUrl,
              previewCompanionKey,
              updatedAt: Date.now(),
            },
          }))
        );
        setBusyComponentId(null);
        return true;
      }
      patchDoc((prev) =>
        patchAssetSetComponents(prev, [component.id], (c) => ({
          ...c,
          model3d: {
            status: 'failed',
            error: result.error,
            updatedAt: Date.now(),
          },
        }))
      );
      setBusyComponentId(null);
      return false;
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      multi3dPreset,
      onNotify,
      patchDoc,
      single3dPreset,
    ]
  );

  const runBatch3d = useCallback(async () => {
    if (readOnly || threeDEligible.length === 0) return;
    const count = threeDEligible.length;
    if (
      !window.confirm(
        `将对 ${count} 个组件提交 3D 生成（已锁定或无视角图的格已跳过），是否继续？`
      )
    ) {
      return;
    }
    const total = count;
    patchAssetSetTaskSession(asset.id, {
      kind: 'batch_3d',
      busy: true,
      progress: { done: 0, total },
      busyComponentIds: new Set(threeDEligible.map((c) => c.id)),
      abortController: null,
    });
    let done = 0;
    let success = 0;
    for (const component of threeDEligible) {
      const ok = await runOneComponent3d(component);
      if (ok) success += 1;
      done += 1;
      patchAssetSetTaskSession(asset.id, { progress: { done, total } });
    }
    clearAssetSetTaskSession(asset.id);
    onNotify?.('info', `批量 3D：${success}/${total} 成功`);
  }, [asset.id, onNotify, readOnly, runOneComponent3d, threeDEligible]);

  const handleRetryActive3d = useCallback(() => {
    if (!activeComponent || readOnly) return;
    void runOneComponent3d(activeComponent, { forceNew: true });
  }, [activeComponent, readOnly, runOneComponent3d]);

  const splitSeedBoxes = useMemo(
    () => (splitAppendMode ? [] : doc.components.map((c) => c.cropRegion)),
    [doc.components, splitAppendMode]
  );

  const handleRunWorkbenchGeneration = useCallback(() => {
    if (!genInputRef) {
      onNotify?.('warn', '请选择输入图');
      return;
    }
    void runGeneration({
      inputRef: genInputRef,
      preset: genPreset,
      outputMode: genOutputMode,
    });
  }, [genInputRef, genOutputMode, genPreset, onNotify, runGeneration]);

  const handleRegenerateActiveCrop = useCallback(() => {
    if (!activeComponentId) return;
    void runGeneration({
      inputRef: { kind: 'component', componentId: activeComponentId },
      preset: genPreset,
      outputMode: genOutputMode,
      outputComponentId: activeComponentId,
      successMessage: '已用裁切图再生成并更新该组件',
    });
  }, [activeComponentId, genOutputMode, genPreset, runGeneration]);

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
            highlightInputId={genInputHighlightSourceId}
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
            onPreviewImage={openLightbox}
            onUseAsGenerationInput={(sourceAsset) => {
              setGenInputKey(assetSetGenerationInputRefKey({ kind: 'source', sourceId: sourceAsset.id }));
            }}
            onSplitFromAsset={(sourceAsset) => {
              if (!resolveAssetSetSourceAssetDisplaySrc(sourceAsset)) {
                onNotify?.('warn', '该参考图尚无画面，无法框选');
                return;
              }
              openSplitForSource(sourceAsset.id);
            }}
            onSourceAssetImageClick={(sourceAsset) => {
              if (!resolveAssetSetSourceAssetDisplaySrc(sourceAsset)) return false;
              openLightbox(resolveAssetSetSourceAssetDisplaySrc(sourceAsset));
              return true;
            }}
          />
          <div className="mt-2 rounded-lg border border-white/[0.05] bg-black/20 p-2">
            <p className={`${STORYBOARD_COLUMN_HEAD} !mb-2`}>生成工作台</p>
            <div className="flex flex-wrap items-center gap-2">
              <CustomDropdown
                value={genInputKey}
                options={genInputSelectOptions}
                disabled={readOnly || taskBusy}
                onChange={(value) => setGenInputKey(value)}
                triggerClassName="h-7 min-w-[9rem] max-w-[12rem] rounded-lg bg-white/5 px-2 text-[10px] text-gray-200 ring-1 ring-white/10"
                portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
              />
              <CustomDropdown
                value={genPreset?.id ?? ''}
                options={imagePresetOptions}
                disabled={readOnly || taskBusy}
                onChange={(value) => savePanelPref('genPresetId', value)}
                triggerClassName="h-7 min-w-[8rem] rounded-lg bg-white/5 px-2 text-[10px] text-gray-200 ring-1 ring-white/10"
                portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
              />
              <CustomDropdown
                value={genOutputMode}
                options={ASSET_SET_GENERATION_OUTPUT_OPTIONS}
                disabled={readOnly || taskBusy}
                onChange={(value) =>
                  savePanelPref('genOutputMode', value as AssetSetGenerationOutputMode)
                }
                triggerClassName="h-7 min-w-[7rem] rounded-lg bg-white/5 px-2 text-[10px] text-gray-200 ring-1 ring-white/10"
                portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
              />
              <button
                type="button"
                disabled={readOnly || !genInputHasImage || !genPreset || taskBusy || Boolean(sourceBusyId)}
                onClick={handleRunWorkbenchGeneration}
                className={STORYBOARD_TOOL_BTN_PRIMARY}
              >
                {sourceBusyId ? '生成中…' : '生成'}
              </button>
              <button
                type="button"
                disabled={readOnly || !canSplitCurrent || taskBusy}
                onClick={() => {
                  if (genInputRef?.kind === 'source') {
                    openSplitForSource(genInputRef.sourceId);
                    return;
                  }
                  if (splitSourceAsset?.id) openSplitForSource(splitSourceAsset.id);
                }}
                className={STORYBOARD_TOOL_BTN_NEUTRAL}
                title={canSplitCurrent ? '在当前输入图上框选组件' : '请选择参考图作为输入后再框选'}
              >
                框选拆分
              </button>
              <label className="flex items-center gap-1 text-[9px] text-gray-400">
                <input
                  type="checkbox"
                  checked={splitAppendMode}
                  disabled={readOnly}
                  onChange={(e) => setSplitAppendMode(e.target.checked)}
                  className="h-3 w-3 rounded border-white/20 bg-white/5"
                />
                拆分时追加格
              </label>
            </div>
            {!genInputHasImage ? (
              <p className="mt-1.5 text-[9px] text-amber-200/70">
                选择有图的输入；生成结果默认追加到参考图条，可链式「作输入 → 再生成」
              </p>
            ) : null}
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
                {taskBusy && taskKind === 'component_sheet' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (abortAssetSetTaskSession(asset.id)) {
                        onNotify?.('info', '已取消组件出图');
                      }
                    }}
                    className={STORYBOARD_TOOL_BTN_NEUTRAL}
                  >
                    取消
                  </button>
                ) : null}
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
                  onPreviewImage={openLightbox}
                  onRetry3d={handleRetryActive3d}
                  retry3dBusy={busyComponentId === activeComponent.id}
                  onRegenerateFromCrop={
                    resolveAssetSetComponentCropSrc(activeComponent)
                      ? handleRegenerateActiveCrop
                      : undefined
                  }
                  regenerateCropBusy={sourceBusyId === activeComponent.id}
                  cropRegenPresetLabel={genPreset?.label}
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
        imageSrc={splitSourceSrc}
        boxes={splitSeedBoxes}
        sheetLabel={splitSourceAsset?.name?.trim() || '参考图拆分'}
        onClose={() => setSplitOpen(false)}
        onConfirm={(boxes) => void confirmSplit(boxes)}
      />
    </div>
  );

  return (
    <>
      {createPortal(panel, document.body)}
      {lightboxSrc ? (
        <ImagePreviewOverlay
          open
          resetKey={lightboxSrc}
          imageSrc={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
          shellZIndexClassName={ASSET_SET_LIGHTBOX_Z}
        />
      ) : null}
    </>
  );
}
