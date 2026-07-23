import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import './ImageModel3DViewer.css';
import type { LazyImagePreviewViewerProps } from '../registry';
import {
  defaultWorkflowPbrChannel,
  defaultWorkflowPbrColorSpace,
  inferWorkflowPbrSlotsFromFileName,
  normalizeWorkflowModelPbrEditDoc,
  readWorkflowModelPbrEditDoc,
  WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT,
  workflowModelPbrEditKey,
  WORKFLOW_MODEL_PBR_SLOTS,
  writeWorkflowModelPbrEditDoc,
  type WorkflowModelPbrChannel,
  type WorkflowModelPbrEditDoc,
  type WorkflowModelPbrEditPersistEventDetail,
  type WorkflowModelPbrMaterialEdit,
  type WorkflowModelPbrSlot,
  type WorkflowModelPbrTextureEdit,
} from '../../../services/workflowModelPbrEdits';
import {
  disposeObjectHierarchy,
  frameCameraToObject,
  inferModelFormat,
} from '../../../services/workflowModelThreeShared';
import type { Model3DInspectionStats } from '../assetPreviewTypes';
import {
  aimWorkflowModelLightsAtBox,
  configureWorkflowModelSoftShadows,
  createStudioGroundMesh,
  createWorkflowModelViewerStageAsync,
  enhanceLoadedModelMaterials,
} from '../../../services/workflowModelViewerStage';

type ViewerStatus = 'loading' | 'ready' | 'error' | 'unsupported';
const MODEL3D_STATS_EVENT = 'asset-preview:model3d-stats';

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'envMap',
  'lightMap',
  'specularMap',
] as const;

function collectModel3DStats(
  root: THREE.Object3D,
  source: string,
  fileName: string | undefined,
  format: string
): Model3DInspectionStats {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let meshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    meshCount += 1;
    const geometry = obj.geometry;
    const position = geometry?.attributes?.position;
    const vertices = position?.count ?? 0;
    vertexCount += vertices;
    triangleCount += geometry?.index ? Math.floor(geometry.index.count / 3) : Math.floor(vertices / 3);

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of mats) {
      if (!material) continue;
      materials.add(material);
      const record = material as unknown as Record<string, unknown>;
      for (const key of MATERIAL_TEXTURE_KEYS) {
        const tex = record[key];
        if (tex instanceof THREE.Texture) textures.add(tex);
      }
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  return {
    source,
    fileName,
    format,
    meshCount,
    materialCount: materials.size,
    textureCount: textures.size,
    vertexCount,
    triangleCount,
    dimensions: {
      width: size.x,
      height: size.y,
      depth: size.z,
    },
  };
}

function publishModel3DStats(stats: Model3DInspectionStats): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Model3DInspectionStats>(MODEL3D_STATS_EVENT, { detail: stats }));
}

function publishWorkflowModelPbrEdit(detail: WorkflowModelPbrEditPersistEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WorkflowModelPbrEditPersistEventDetail>(WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT, { detail }));
}

function nowMs(): number {
  return Date.now();
}

type MaterialSlotInfo = {
  id: string;
  label: string;
  index: number;
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  meshCount: number;
  colorHex: string;
};

const PBR_SLOT_LABELS: Record<WorkflowModelPbrSlot, string> = {
  baseColor: 'Base Color',
  normal: 'Normal',
  ao: 'AO',
  roughness: 'Roughness',
  metallic: 'Metallic',
  emissive: 'Emissive',
  alpha: 'Alpha',
  height: 'Height',
};

const CHANNEL_OPTIONS: Array<{ value: WorkflowModelPbrChannel; label: string }> = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'R' },
  { value: 'g', label: 'G' },
  { value: 'b', label: 'B' },
  { value: 'a', label: 'A' },
];

const PBR_SLOT_PARAM_RANGE: Record<WorkflowModelPbrSlot, { min: number; max: number; step: number; fallback: number }> = {
  baseColor: { min: 0, max: 2, step: 0.01, fallback: 0.5 },
  normal: { min: 0, max: 5, step: 0.5, fallback: 1 },
  ao: { min: 0, max: 3, step: 0.01, fallback: 1 },
  roughness: { min: 0, max: 1, step: 0.01, fallback: 1 },
  metallic: { min: 0, max: 1, step: 0.01, fallback: 0 },
  emissive: { min: 0, max: 3, step: 0.01, fallback: 0 },
  alpha: { min: 0, max: 1, step: 0.01, fallback: 1 },
  height: { min: 0, max: 0.1, step: 0.001, fallback: 0 },
};

function canAdjustSlotParam(slot: WorkflowModelPbrSlot, hasTexture: boolean): boolean {
  return !hasTexture || slot === 'normal';
}

type ViewCubeDirection = readonly [number, number, number];

const VIEW_CUBE_FACES: Array<{ label: string; title: string; className: string; direction: ViewCubeDirection }> = [
  { label: '正', title: '正视图', className: 'workflow-model-view-cube-face--front', direction: [1, 0, 0] },
  { label: '后', title: '后视图', className: 'workflow-model-view-cube-face--back', direction: [-1, 0, 0] },
  { label: '顶', title: '顶视图', className: 'workflow-model-view-cube-face--top', direction: [0, 1, 0] },
  { label: '底', title: '底视图', className: 'workflow-model-view-cube-face--bottom', direction: [0, -1, 0] },
  { label: '左', title: '左视图', className: 'workflow-model-view-cube-face--left', direction: [0, 0, -1] },
  { label: '右', title: '右视图', className: 'workflow-model-view-cube-face--right', direction: [0, 0, 1] },
];

const VIEW_CUBE_CORNERS: Array<{ id: string; direction: ViewCubeDirection; className: string }> = [
  { id: 'front-top-right', direction: [1, 1, 1], className: 'workflow-model-view-cube-corner--ftr' },
  { id: 'front-top-left', direction: [1, 1, -1], className: 'workflow-model-view-cube-corner--ftl' },
  { id: 'front-bottom-right', direction: [1, -1, 1], className: 'workflow-model-view-cube-corner--fbr' },
  { id: 'front-bottom-left', direction: [1, -1, -1], className: 'workflow-model-view-cube-corner--fbl' },
  { id: 'back-top-right', direction: [-1, 1, 1], className: 'workflow-model-view-cube-corner--btr' },
  { id: 'back-top-left', direction: [-1, 1, -1], className: 'workflow-model-view-cube-corner--btl' },
  { id: 'back-bottom-right', direction: [-1, -1, 1], className: 'workflow-model-view-cube-corner--bbr' },
  { id: 'back-bottom-left', direction: [-1, -1, -1], className: 'workflow-model-view-cube-corner--bbl' },
];

function materialColorHex(material: THREE.Material): string {
  const color = (material as unknown as { color?: THREE.Color }).color;
  if (color instanceof THREE.Color) return `#${color.getHexString()}`;
  return '#7f8794';
}

type PbrEditableMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

function materialSupportsPbr(material: THREE.Material): material is PbrEditableMaterial {
  return material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial;
}

function clampSlotParam(slot: WorkflowModelPbrSlot, value: number): number {
  const range = PBR_SLOT_PARAM_RANGE[slot];
  if (!Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

function snapSlotParam(slot: WorkflowModelPbrSlot, value: number): number {
  const range = PBR_SLOT_PARAM_RANGE[slot];
  const clamped = clampSlotParam(slot, value);
  if (!range.step) return clamped;
  const steps = Math.round((clamped - range.min) / range.step);
  return clampSlotParam(slot, range.min + steps * range.step);
}

function valueFromSliderPointer(slot: WorkflowModelPbrSlot, element: HTMLElement, clientY: number): number {
  const range = PBR_SLOT_PARAM_RANGE[slot];
  const rect = element.getBoundingClientRect();
  const ratio = rect.height > 0 ? 1 - (clientY - rect.top) / rect.height : 0;
  return snapSlotParam(slot, range.min + Math.min(1, Math.max(0, ratio)) * (range.max - range.min));
}

function materialBaseColor(material: PbrEditableMaterial): THREE.Color {
  const stored = material.userData.workflowPbrBaseColor;
  if (stored instanceof THREE.Color) return stored;
  const color = material.color.clone();
  material.userData.workflowPbrBaseColor = color;
  return color;
}

function materialBaseEmissive(material: PbrEditableMaterial): THREE.Color {
  const stored = material.userData.workflowPbrBaseEmissive;
  if (stored instanceof THREE.Color) return stored;
  const color = material.emissive.getHex() === 0 ? new THREE.Color(0xffffff) : material.emissive.clone();
  material.userData.workflowPbrBaseEmissive = color;
  return color;
}

function copyMaterialTexture(
  source: THREE.Material,
  target: THREE.MeshStandardMaterial,
  sourceKey: string,
  targetKey = sourceKey
): void {
  const texture = (source as unknown as Record<string, unknown>)[sourceKey];
  if (texture instanceof THREE.Texture) {
    (target as unknown as Record<string, THREE.Texture>)[targetKey] = texture;
  }
}

function toPbrEditableMaterial(source: THREE.Material): PbrEditableMaterial {
  if (materialSupportsPbr(source)) return source;

  const record = source as unknown as Record<string, unknown>;
  const material = new THREE.MeshStandardMaterial({
    name: source.name,
    color: record.color instanceof THREE.Color ? record.color.clone() : new THREE.Color(0xffffff),
    opacity: typeof record.opacity === 'number' ? record.opacity : 1,
    transparent: Boolean(record.transparent),
    side: source.side,
    alphaTest: typeof record.alphaTest === 'number' ? record.alphaTest : 0,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    blending: source.blending,
    wireframe: Boolean(record.wireframe),
    roughness: 0.72,
    metalness: 0.02,
  });
  material.userData.workflowPbrBaseColor = material.color.clone();
  material.userData.workflowPbrBaseEmissive = material.emissive.getHex() === 0 ? new THREE.Color(0xffffff) : material.emissive.clone();
  copyMaterialTexture(source, material, 'map');
  copyMaterialTexture(source, material, 'normalMap');
  copyMaterialTexture(source, material, 'aoMap');
  copyMaterialTexture(source, material, 'alphaMap');
  copyMaterialTexture(source, material, 'emissiveMap');
  copyMaterialTexture(source, material, 'bumpMap');
  copyMaterialTexture(source, material, 'displacementMap');
  if (record.emissive instanceof THREE.Color) material.emissive.copy(record.emissive);
  if (typeof record.emissiveIntensity === 'number') material.emissiveIntensity = record.emissiveIntensity;
  if (material.alphaMap) material.transparent = true;
  material.needsUpdate = true;
  return material;
}

function ensureObjectUsesPbrMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((mat) => toPbrEditableMaterial(mat));
    } else if (obj.material) {
      obj.material = toPbrEditableMaterial(obj.material);
    }
  });
}

function collectMaterialSlots(root: THREE.Object3D): MaterialSlotInfo[] {
  const byMaterial = new Map<PbrEditableMaterial, MaterialSlotInfo>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of mats) {
      if (!material || !materialSupportsPbr(material)) continue;
      let slot = byMaterial.get(material);
      if (!slot) {
        const index = byMaterial.size;
        slot = {
          id: `mat-${index}`,
          index,
          label: material.name?.trim() || `Material ${index + 1}`,
          material,
          meshCount: 0,
          colorHex: materialColorHex(material),
        };
        byMaterial.set(material, slot);
      }
      slot.meshCount += 1;
    }
  });
  return Array.from(byMaterial.values());
}

function ensureAoUv2(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geo = obj.geometry;
    if (!geo?.attributes?.uv || geo.attributes.uv2) return;
    geo.setAttribute('uv2', geo.attributes.uv.clone());
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read texture'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode texture'));
    img.src = src;
  });
}

async function prepareTextureDataUrl(edit: WorkflowModelPbrTextureEdit, slot: WorkflowModelPbrSlot): Promise<string> {
  const channel = slot === 'normal' ? 'rgb' : edit.channel;
  const flipNormalR = slot === 'normal' && edit.normalFlipR === true;
  const flipNormalG = slot === 'normal' && edit.normalFlipG === true;
  if (channel === 'rgb' && !flipNormalR && !flipNormalG) return edit.dataUrl;
  const img = await loadImageElement(edit.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
  canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) return edit.dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (channel === 'rgb') {
    for (let i = 0; i < image.data.length; i += 4) {
      if (flipNormalR) image.data[i] = 255 - image.data[i];
      if (flipNormalG) image.data[i + 1] = 255 - image.data[i + 1];
    }
  } else {
    const channelIndex = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3;
    for (let i = 0; i < image.data.length; i += 4) {
      const v = image.data[i + channelIndex];
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function createTextureFromEdit(edit: WorkflowModelPbrTextureEdit, slot: WorkflowModelPbrSlot): Promise<THREE.Texture> {
  const src = await prepareTextureDataUrl(edit, slot);
  const texture = await new THREE.TextureLoader().loadAsync(src);
  texture.name = edit.fileName;
  texture.colorSpace = edit.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.userData.workflowPbrGenerated = true;
  texture.needsUpdate = true;
  return texture;
}

function disposeWorkflowTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture?.userData.workflowPbrGenerated) return;
  texture.dispose();
}

function replaceWorkflowTexture(
  material: PbrEditableMaterial,
  key: keyof THREE.MeshStandardMaterial,
  texture: THREE.Texture | null
): void {
  const current = material[key];
  if (current instanceof THREE.Texture && current !== texture) disposeWorkflowTexture(current);
  (material as unknown as Record<string, THREE.Texture | null>)[key as string] = texture;
}

function applyPbrSlotParamToMaterial(
  material: PbrEditableMaterial,
  slot: WorkflowModelPbrSlot,
  rawValue: number | undefined
): void {
  if (rawValue == null) return;
  const value = clampSlotParam(slot, rawValue);
  if (slot === 'baseColor') material.color.copy(materialBaseColor(material)).multiplyScalar(value);
  if (slot === 'normal') material.normalScale.set(value, value);
  if (slot === 'ao') material.aoMapIntensity = value;
  if (slot === 'roughness') material.roughness = value;
  if (slot === 'metallic') material.metalness = value;
  if (slot === 'emissive') {
    material.emissive.copy(materialBaseEmissive(material));
    material.emissiveIntensity = value;
  }
  if (slot === 'alpha') {
    material.opacity = value;
    material.transparent = value < 0.999 || Boolean(material.alphaMap);
  }
  if (slot === 'height') material.displacementScale = value;
  material.needsUpdate = true;
}

async function applyPbrSlotToMaterial(
  material: PbrEditableMaterial,
  slot: WorkflowModelPbrSlot,
  edit: WorkflowModelPbrTextureEdit | undefined
): Promise<void> {
  const texture = edit?.enabled ? await createTextureFromEdit(edit, slot) : null;
  if (slot === 'baseColor') {
    replaceWorkflowTexture(material, 'map', texture);
    if (texture && !material.userData.workflowPbrBaseColor) material.userData.workflowPbrBaseColor = material.color.clone();
  }
  if (slot === 'normal') {
    replaceWorkflowTexture(material, 'normalMap', texture);
    if (texture) {
      const value = PBR_SLOT_PARAM_RANGE.normal.fallback;
      material.normalScale.set(value, value);
    }
  }
  if (slot === 'ao') {
    replaceWorkflowTexture(material, 'aoMap', texture);
    if (texture) material.aoMapIntensity = Math.max(material.aoMapIntensity ?? 1, 1);
  }
  if (slot === 'roughness') {
    replaceWorkflowTexture(material, 'roughnessMap', texture);
    if (texture) material.roughness = 1;
  }
  if (slot === 'metallic') {
    replaceWorkflowTexture(material, 'metalnessMap', texture);
    if (texture) material.metalness = 1;
  }
  if (slot === 'emissive') {
    replaceWorkflowTexture(material, 'emissiveMap', texture);
    if (texture) {
      material.emissive.set(0xffffff);
      material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 1, 1);
    }
  }
  if (slot === 'alpha') {
    replaceWorkflowTexture(material, 'alphaMap', texture);
    material.transparent = Boolean(texture);
    material.alphaTest = texture ? 0.01 : 0;
  }
  if (slot === 'height') {
    replaceWorkflowTexture(material, 'displacementMap', texture);
    material.displacementScale = texture ? 0.035 : 0;
  }
  material.needsUpdate = true;
}

async function applyMaterialEditToSlot(slot: MaterialSlotInfo, edit: WorkflowModelPbrMaterialEdit | undefined): Promise<void> {
  if (!edit) return;
  for (const pbrSlot of WORKFLOW_MODEL_PBR_SLOTS) {
    const textureEdit = edit.slots[pbrSlot];
    await applyPbrSlotToMaterial(slot.material, pbrSlot, textureEdit);
    if (!textureEdit?.enabled || pbrSlot === 'normal') applyPbrSlotParamToMaterial(slot.material, pbrSlot, edit.params?.[pbrSlot]);
  }
}

const ImageModel3DViewer: React.FC<LazyImagePreviewViewerProps> = ({
  modelSrc,
  model3dAssetId,
  model3dVariantId,
  model3dModelKey,
  model3dPbrEditDoc,
  modelFileName,
  model3dDisplayMode = 'material',
  model3dResetViewNonce = 0,
  model3dShowGrid = true,
  model3dBackfaceCulling = true,
  className,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewCubeRef = useRef<HTMLDivElement>(null);
  const applyDisplayModeRef = useRef<((mode: NonNullable<LazyImagePreviewViewerProps['model3dDisplayMode']>) => void) | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const setModelViewDirectionRef = useRef<((direction: ViewCubeDirection) => void) | null>(null);
  const setGridVisibleRef = useRef<((visible: boolean) => void) | null>(null);
  const setBackfaceCullingRef = useRef<((enabled: boolean) => void) | null>(null);
  const displayModeRef = useRef<NonNullable<LazyImagePreviewViewerProps['model3dDisplayMode']>>('material');
  const showGridRef = useRef(model3dShowGrid);
  const backfaceCullingRef = useRef(model3dBackfaceCulling);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [message, setMessage] = useState<string>('');
  const [materialSlots, setMaterialSlots] = useState<MaterialSlotInfo[]>([]);
  const [activeMaterialId, setActiveMaterialId] = useState<string>('');
  const [pbrDoc, setPbrDoc] = useState<WorkflowModelPbrEditDoc | null>(null);
  const [draftSlotParams, setDraftSlotParams] = useState<Record<string, number>>({});
  const [, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const pbrDocRef = useRef<WorkflowModelPbrEditDoc | null>(null);
  const materialSlotsRef = useRef<MaterialSlotInfo[]>([]);
  const pbrStorageKey = useMemo(
    () => workflowModelPbrEditKey(model3dAssetId, model3dVariantId, model3dModelKey || modelSrc || modelFileName),
    [model3dAssetId, model3dModelKey, model3dVariantId, modelFileName, modelSrc]
  );
  const persistedPbrDoc = useMemo(
    () => normalizeWorkflowModelPbrEditDoc(model3dPbrEditDoc),
    [model3dPbrEditDoc]
  );
  const persistedPbrDocRef = useRef<WorkflowModelPbrEditDoc | null>(persistedPbrDoc);
  const publishModelPbrEdit = useCallback(
    (doc: WorkflowModelPbrEditDoc) => {
      const assetId = String(model3dAssetId || doc.assetId || '').trim();
      if (!assetId || assetId === 'unknown_asset') return;
      publishWorkflowModelPbrEdit({
        assetId,
        variantId: model3dVariantId || doc.variantId,
        modelKey: model3dModelKey || modelSrc || modelFileName || doc.modelKey,
        doc,
      });
    },
    [model3dAssetId, model3dModelKey, model3dVariantId, modelFileName, modelSrc]
  );

  useEffect(() => {
    pbrDocRef.current = pbrDoc;
  }, [pbrDoc]);

  useEffect(() => {
    persistedPbrDocRef.current = persistedPbrDoc;
  }, [persistedPbrDoc]);

  useEffect(() => {
    materialSlotsRef.current = materialSlots;
  }, [materialSlots]);

  useEffect(() => {
    displayModeRef.current = model3dDisplayMode;
    applyDisplayModeRef.current?.(model3dDisplayMode);
  }, [model3dDisplayMode]);

  useEffect(() => {
    if (model3dResetViewNonce <= 0) return;
    resetCameraRef.current?.();
  }, [model3dResetViewNonce]);

  useEffect(() => {
    showGridRef.current = model3dShowGrid;
    setGridVisibleRef.current?.(model3dShowGrid);
  }, [model3dShowGrid]);

  useEffect(() => {
    backfaceCullingRef.current = model3dBackfaceCulling;
    setBackfaceCullingRef.current?.(model3dBackfaceCulling);
  }, [model3dBackfaceCulling]);

  useEffect(() => {
    const root = rootRef.current;
    const mount = mountRef.current;
    if (!root || !mount) return;
    const src = (modelSrc || '').trim();
    setMaterialSlots([]);
    setActiveMaterialId('');
    setPbrDoc(null);
    setDraftSlotParams({});
    setSaveState('idle');
    if (!src) {
      setStatus('unsupported');
      setMessage('当前资产没有可预览的 3D 模型链接。');
      return;
    }

    const format = inferModelFormat(src, modelFileName);
    if (format === 'unknown') {
      setStatus('unsupported');
      setMessage('无法识别模型格式。本地文件请保留扩展名（.glb / .gltf / .fbx / .obj）。');
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let loadedRoot: THREE.Object3D | null = null;
    let groundMesh: THREE.Mesh | null = null;
    let stage: Awaited<ReturnType<typeof createWorkflowModelViewerStageAsync>> | null = null;
    const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const clayMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.78,
      metalness: 0.02,
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      wireframe: true,
      transparent: true,
      opacity: 0.96,
    });
    const normalMaterial = new THREE.MeshNormalMaterial();
    const abortEnv = new AbortController();

    const width = Math.max(1, mount.clientWidth || root.clientWidth);
    const height = Math.max(1, mount.clientHeight || root.clientHeight || width * 0.56);
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
    camera.position.set(0, 0.6, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    configureWorkflowModelSoftShadows(renderer);

    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.background = 'transparent';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', '3D model viewport');

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 0.25;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null,
    };

    const onMouseDown = () => {
      renderer.domElement.focus({ preventScroll: true });
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onMouseUp = () => {
      renderer.domElement.style.cursor = 'grab';
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('mouseleave', onMouseUp);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== 'KeyF') return;
      if (!loadedRoot) return;
      e.preventDefault();
      e.stopPropagation();
      frameCameraToObject(camera, controls, loadedRoot, {
        defaultView: '+x',
        preserveViewDirection: true,
      });
    };
    renderer.domElement.addEventListener('keydown', onKeyDown);

    const onGlLost = (e: Event) => {
      try {
        e.preventDefault();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      setStatus('error');
      setMessage(
        'WebGL 上下文已丢失（常见于系统「另存为」对话框弹出时 GPU 被抢占）。请关闭弹窗后重新打开大图预览，或刷新页面。'
      );
    };
    renderer.domElement.addEventListener('webglcontextlost', onGlLost);

    setStatus('loading');
    setMessage('');

    const restoreOriginalMaterials = () => {
      if (!loadedRoot) return;
      loadedRoot.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const original = originalMaterials.get(obj);
        if (original) obj.material = original;
      });
    };

    const applyBackfaceCullingToMaterial = (material: THREE.Material | THREE.Material[]) => {
      const side = backfaceCullingRef.current ? THREE.FrontSide : THREE.DoubleSide;
      const mats = Array.isArray(material) ? material : [material];
      for (const mat of mats) {
        mat.side = side;
        mat.needsUpdate = true;
      }
    };

    const applyBackfaceCulling = () => {
      if (!loadedRoot) return;
      loadedRoot.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        applyBackfaceCullingToMaterial(obj.material);
      });
    };

    applyDisplayModeRef.current = (mode: NonNullable<LazyImagePreviewViewerProps['model3dDisplayMode']>) => {
      if (!loadedRoot) return;
      restoreOriginalMaterials();
      const useGround = mode !== 'wire' && mode !== 'normal';
      if (groundMesh) groundMesh.visible = useGround && showGridRef.current;
      if (mode !== 'material') {
        loadedRoot.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          if (!originalMaterials.has(obj)) originalMaterials.set(obj, obj.material);
          if (mode === 'clay') obj.material = clayMaterial;
          if (mode === 'wire') obj.material = wireMaterial;
          if (mode === 'normal') obj.material = normalMaterial;
        });
      }
      applyBackfaceCulling();
    };

    resetCameraRef.current = () => {
      if (!loadedRoot) return;
      frameCameraToObject(camera, controls, loadedRoot, {
        defaultView: '+x',
        preserveViewDirection: true,
      });
    };

    setModelViewDirectionRef.current = (direction: ViewCubeDirection) => {
      if (!loadedRoot) return;
      frameCameraToObject(camera, controls, loadedRoot, {
        viewDirection: new THREE.Vector3(direction[0], direction[1], direction[2]),
        fitPadding: 1.12,
      });
    };

    const syncViewCube = () => {
      const cube = viewCubeRef.current;
      if (!cube) return;
      const offset = camera.position.clone().sub(controls.target);
      if (offset.lengthSq() <= 1e-8) return;
      offset.normalize();
      const yaw = Math.atan2(offset.z, offset.x);
      const pitch = Math.asin(THREE.MathUtils.clamp(offset.y, -1, 1));
      const cubeYaw = yaw - Math.PI / 2;
      cube.style.transform = `rotateX(${-pitch}rad) rotateY(${cubeYaw}rad)`;
      cube.style.setProperty('--view-cube-corner-tilt', `${pitch}rad`);
      cube.style.setProperty('--view-cube-corner-turn', `${-cubeYaw}rad`);
    };

    setGridVisibleRef.current = (visible: boolean) => {
      if (groundMesh) groundMesh.visible = visible && displayModeRef.current !== 'wire' && displayModeRef.current !== 'normal';
    };

    setBackfaceCullingRef.current = () => {
      applyBackfaceCulling();
    };

    const onLoadError = () => {
      if (cancelled) return;
      setStatus('error');
      setMessage('3D 模型加载失败（链接、跨域或文件损坏）。含贴图的 OBJ 需同目录 .mtl 时可能不完整。');
    };

    const finishLoad = (object: THREE.Object3D) => {
      if (cancelled || !stage) return;
      loadedRoot = object;
      ensureObjectUsesPbrMaterials(object);
      enhanceLoadedModelMaterials(object);
      object.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) {
          originalMaterials.set(m, m.material);
          m.castShadow = true;
          m.receiveShadow = true;
          applyBackfaceCullingToMaterial(m.material);
        }
      });
      ensureAoUv2(object);
      const slots = collectMaterialSlots(object);
      const assetSavedDoc = persistedPbrDocRef.current;
      const savedDoc = assetSavedDoc || readWorkflowModelPbrEditDoc(pbrStorageKey);
      setMaterialSlots(slots);
      setActiveMaterialId((current) => current || slots[0]?.id || '');
      setPbrDoc(savedDoc);
      pbrDocRef.current = savedDoc;
      materialSlotsRef.current = slots;
      scene.add(object);
      frameCameraToObject(camera, controls, object, { defaultView: '+x' });
      const box = new THREE.Box3().setFromObject(object);
      aimWorkflowModelLightsAtBox(stage.keyLight, stage.fillLight, stage.rimLight, stage.bounceFill, box);
      groundMesh = createStudioGroundMesh(box);
      if (groundMesh) {
        groundMesh.visible = showGridRef.current && displayModeRef.current !== 'wire' && displayModeRef.current !== 'normal';
        scene.add(groundMesh);
      }
      applyDisplayModeRef.current?.(displayModeRef.current);
      publishModel3DStats(collectModel3DStats(object, src, modelFileName, format));
      if (savedDoc) {
        void Promise.all(slots.map((slot) => applyMaterialEditToSlot(slot, savedDoc.materials[slot.id]))).then(() => {
          publishModel3DStats(collectModel3DStats(object, src, modelFileName, format));
        });
        if (!assetSavedDoc && model3dAssetId) publishModelPbrEdit(savedDoc);
      }
      setStatus('ready');
    };

    void (async () => {
      try {
        stage = await createWorkflowModelViewerStageAsync(scene, renderer, null, { signal: abortEnv.signal });
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        if (!cancelled) {
          setStatus('error');
          setMessage('3D 环境（HDR）加载失败，请刷新重试。');
        }
        return;
      }
      if (cancelled) {
        stage?.dispose();
        stage = null;
        return;
      }
      if (format === 'gltf') {
        new GLTFLoader().load(src, (gltf) => finishLoad(gltf.scene), undefined, onLoadError);
      } else if (format === 'fbx') {
        new FBXLoader().load(src, (group) => finishLoad(group), undefined, onLoadError);
      } else {
        new OBJLoader().load(src, (group) => finishLoad(group), undefined, onLoadError);
      }
    })();

    const ro = new ResizeObserver(() => {
      if (cancelled || !mount) return;
      const w = Math.max(1, mount.clientWidth || root.clientWidth);
      const h = Math.max(1, mount.clientHeight || root.clientHeight || 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(root);

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);
      try {
        const gl = renderer.getContext() as WebGLRenderingContext | null;
        if (gl?.isContextLost?.()) return;
        controls.update();
        syncViewCube();
        renderer.render(scene, camera);
      } catch {
        /* 上下文丢失后 render 可能抛错，避免拖垮 React */
      }
    };
    tick();

    return () => {
      cancelled = true;
      abortEnv.abort();
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('webglcontextlost', onGlLost);
      applyDisplayModeRef.current = null;
      resetCameraRef.current = null;
      setModelViewDirectionRef.current = null;
      setGridVisibleRef.current = null;
      setBackfaceCullingRef.current = null;
      restoreOriginalMaterials();
      if (loadedRoot) {
        scene.remove(loadedRoot);
        disposeObjectHierarchy(loadedRoot);
      }
      if (groundMesh) {
        scene.remove(groundMesh);
        groundMesh.geometry.dispose();
        (groundMesh.material as THREE.Material).dispose();
        groundMesh = null;
      }
      clayMaterial.dispose();
      wireMaterial.dispose();
      normalMaterial.dispose();
      stage?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [modelSrc, modelFileName, model3dAssetId, pbrStorageKey, publishModelPbrEdit]);

  const activeMaterial = materialSlots.find((slot) => slot.id === activeMaterialId) || materialSlots[0] || null;
  const activeEdit = activeMaterial ? pbrDoc?.materials[activeMaterial.id] : undefined;
  const editedMaterialIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, edit] of Object.entries((pbrDoc?.materials || {}) as WorkflowModelPbrEditDoc['materials'])) {
      if (
        WORKFLOW_MODEL_PBR_SLOTS.some((slot) => Boolean(edit.slots[slot]?.enabled)) ||
        Object.keys(edit.params || {}).length > 0
      ) {
        ids.add(id);
      }
    }
    return ids;
  }, [pbrDoc]);

  const commitPbrDoc = (next: WorkflowModelPbrEditDoc) => {
    setSaveState('saving');
    try {
      writeWorkflowModelPbrEditDoc(pbrStorageKey, next);
      pbrDocRef.current = next;
      setPbrDoc(next);
      publishModelPbrEdit(next);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const buildNextDoc = (
    material: MaterialSlotInfo,
    updater: (edit: WorkflowModelPbrMaterialEdit) => WorkflowModelPbrMaterialEdit
  ): WorkflowModelPbrEditDoc => {
    const current = pbrDocRef.current || {
      version: 1 as const,
      assetId: model3dAssetId || 'unknown_asset',
      variantId: model3dVariantId,
      modelKey: model3dModelKey || modelSrc || modelFileName || 'unknown_model',
      updatedAt: nowMs(),
      materials: {},
    };
    const prevMaterial = current.materials[material.id] || { materialName: material.label, slots: {} };
    return {
      ...current,
      assetId: model3dAssetId || current.assetId || 'unknown_asset',
      variantId: model3dVariantId || current.variantId,
      modelKey: model3dModelKey || modelSrc || modelFileName || current.modelKey,
      updatedAt: nowMs(),
      materials: {
        ...current.materials,
        [material.id]: updater(prevMaterial),
      },
    };
  };

  const updateTextureSlot = async (
    material: MaterialSlotInfo,
    slot: WorkflowModelPbrSlot,
    edit: WorkflowModelPbrTextureEdit | undefined
  ) => {
    const next = buildNextDoc(material, (prev) => ({
      ...prev,
      materialName: material.label,
      slots: {
        ...prev.slots,
        [slot]: edit,
      },
    }));
    commitPbrDoc(next);
    await applyPbrSlotToMaterial(material.material, slot, edit);
    if (!edit?.enabled || slot === 'normal') applyPbrSlotParamToMaterial(material.material, slot, next.materials[material.id]?.params?.[slot]);
  };

  const handleTextureFile = async (targetSlot: WorkflowModelPbrSlot, file: File) => {
    const material = activeMaterial;
    if (!material) return;
    try {
      setSaveState('saving');
      const dataUrl = await readFileAsDataUrl(file);
      const inferred = inferWorkflowPbrSlotsFromFileName(file.name);
      const slotsToApply = inferred.length > 1 ? inferred : [targetSlot];
      let nextDoc = pbrDocRef.current || buildNextDoc(material, (prev) => prev);
      const materialEdit = nextDoc.materials[material.id] || { materialName: material.label, slots: {} };
      const nextSlots = { ...materialEdit.slots };
      const now = nowMs();
      for (const slot of slotsToApply) {
        nextSlots[slot] = {
          dataUrl,
          fileName: file.name || 'texture',
          mimeType: file.type || undefined,
          channel: defaultWorkflowPbrChannel(slot),
          colorSpace: defaultWorkflowPbrColorSpace(slot),
          enabled: true,
          updatedAt: now,
        };
      }
      nextDoc = {
        ...nextDoc,
        assetId: model3dAssetId || nextDoc.assetId || 'unknown_asset',
        variantId: model3dVariantId || nextDoc.variantId,
        modelKey: model3dModelKey || modelSrc || modelFileName || nextDoc.modelKey,
        updatedAt: now,
        materials: {
          ...nextDoc.materials,
          [material.id]: {
            materialName: material.label,
            slots: nextSlots,
            params: materialEdit.params,
          },
        },
      };
      commitPbrDoc(nextDoc);
      for (const slot of slotsToApply) {
        await applyPbrSlotToMaterial(material.material, slot, nextSlots[slot]);
        if (slot === 'normal') applyPbrSlotParamToMaterial(material.material, slot, materialEdit.params?.[slot]);
      }
    } catch {
      setSaveState('error');
    }
  };

  const handleSlotFieldChange = async (
    slot: WorkflowModelPbrSlot,
    patch: Partial<Pick<WorkflowModelPbrTextureEdit, 'channel' | 'normalFlipR' | 'normalFlipG'>>
  ) => {
    const material = activeMaterial;
    const current = activeEdit?.slots[slot];
    if (!material || !current) return;
    const nextEdit = { ...current, ...patch, updatedAt: nowMs() };
    await updateTextureSlot(material, slot, nextEdit);
  };

  const clearSlot = async (slot: WorkflowModelPbrSlot) => {
    const material = activeMaterial;
    if (!material) return;
    await updateTextureSlot(material, slot, undefined);
  };

  const updateSlotParam = (slot: WorkflowModelPbrSlot, value: number) => {
    const material = activeMaterial;
    if (!material) return;
    const textureEdit = activeEdit?.slots[slot];
    if (textureEdit?.enabled && slot !== 'normal') return;
    const nextValue = clampSlotParam(slot, value);
    applyPbrSlotParamToMaterial(material.material, slot, nextValue);
    const next = buildNextDoc(material, (prev) => ({
      ...prev,
      materialName: material.label,
      params: {
        ...(prev.params || {}),
        [slot]: nextValue,
      },
    }));
    commitPbrDoc(next);
    setDraftSlotParams((prev) => {
      const key = `${material.id}:${slot}`;
      if (!(key in prev)) return prev;
      const nextDrafts = { ...prev };
      delete nextDrafts[key];
      return nextDrafts;
    });
  };

  const handleViewCubePick = useCallback((direction: ViewCubeDirection) => {
    setModelViewDirectionRef.current?.(direction);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`relative h-full w-full min-h-0 overflow-hidden bg-transparent ${className ?? ''}`}
    >
      <div ref={mountRef} className="absolute inset-0 z-0" aria-hidden />
      {status === 'ready' ? (
        <div
          className="workflow-model-view-cube-host pointer-events-auto absolute bottom-5 left-5 z-[4]"
          data-image-preview-no-wheel
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="workflow-model-view-cube-scene" aria-label="固定视角切换">
            <div ref={viewCubeRef} className="workflow-model-view-cube">
              {VIEW_CUBE_FACES.map((face) => (
                <button
                  key={face.label}
                  type="button"
                  className={`workflow-model-view-cube-face ${face.className}`}
                  title={face.title}
                  aria-label={face.title}
                  onClick={() => handleViewCubePick(face.direction)}
                >
                  {face.label}
                </button>
              ))}
              {VIEW_CUBE_CORNERS.map((corner) => (
                <button
                  key={corner.id}
                  type="button"
                  className={`workflow-model-view-cube-corner ${corner.className}`}
                  title="斜角视图"
                  aria-label="斜角视图"
                  onClick={() => handleViewCubePick(corner.direction)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {status === 'ready' && materialSlots.length > 0 ? (
        <div
          className="pointer-events-auto absolute right-8 top-1/2 z-[4] flex max-h-[calc(100vh-5rem)] -translate-y-1/2 overflow-hidden rounded-xl border border-white/10 bg-[#0d0e12]/92 text-gray-200 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl"
          data-image-preview-no-wheel
          data-image-preview-scroll
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="w-[9.5rem] p-2">
            <div className="space-y-1.5">
              {WORKFLOW_MODEL_PBR_SLOTS.map((slot) => {
                const edit = activeEdit?.slots[slot];
                const hasTexture = Boolean(edit?.enabled && edit.dataUrl);
                const paramAdjustable = canAdjustSlotParam(slot, hasTexture);
                const paramRange = PBR_SLOT_PARAM_RANGE[slot];
                const paramKey = `${activeMaterial?.id || 'none'}:${slot}`;
                const committedParamValue = clampSlotParam(
                  slot,
                  activeEdit?.params?.[slot] ?? paramRange.fallback
                );
                const paramValue = clampSlotParam(
                  slot,
                  draftSlotParams[paramKey] ?? committedParamValue
                );
                const paramPercent =
                  paramRange.max > paramRange.min
                    ? ((paramValue - paramRange.min) / (paramRange.max - paramRange.min)) * 100
                    : 0;
                return (
                  <div
                    key={slot}
                    className="flex h-[4.5rem] items-stretch gap-1 rounded-md border border-white/10 bg-white/[0.035] p-1.5"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const file = (Array.from(event.dataTransfer.files || []) as File[]).find((f) => f.type.startsWith('image/'));
                      if (file) void handleTextureFile(slot, file);
                    }}
                  >
                    <div className={`${slot === 'normal' ? 'grid-rows-2' : 'grid-rows-5'} grid h-full w-6 shrink-0 gap-px`}>
                      {slot === 'normal'
                        ? ([
                            { key: 'normalFlipR' as const, label: 'R', active: edit?.normalFlipR === true },
                            { key: 'normalFlipG' as const, label: 'G', active: edit?.normalFlipG === true },
                          ]).map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              disabled={!hasTexture}
                              title={`Flip normal ${option.label}`}
                              aria-pressed={option.active}
                              onClick={() => void handleSlotFieldChange(slot, { [option.key]: !option.active })}
                              className={`rounded-sm text-[8px] font-black leading-none ring-1 transition-colors ${
                                option.active
                                  ? 'bg-white text-[#0d0e12] ring-white/80'
                                  : 'bg-white/[0.04] text-gray-500 ring-white/10 hover:bg-white/[0.08] hover:text-gray-200'
                              } disabled:cursor-not-allowed disabled:opacity-30`}
                            >
                              {option.label}
                            </button>
                          ))
                        : CHANNEL_OPTIONS.map((option) => {
                            const active = (edit?.channel || defaultWorkflowPbrChannel(slot)) === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                disabled={!hasTexture}
                                title={option.label}
                                aria-pressed={active}
                                onClick={() => void handleSlotFieldChange(slot, { channel: option.value })}
                                className={`rounded-sm text-[6px] font-black leading-none ring-1 transition-colors ${
                                  active
                                    ? 'bg-white text-[#0d0e12] ring-white/80'
                                    : 'bg-white/[0.04] text-gray-500 ring-white/10 hover:bg-white/[0.08] hover:text-gray-200'
                                } disabled:cursor-not-allowed disabled:opacity-30`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                    </div>
                    <div className="flex min-w-0 flex-1 items-stretch gap-1">
                      <label className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/30 text-[10px] font-black text-white hover:bg-white/[0.06]">
                        {hasTexture ? (
                          <img src={edit!.dataUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                        ) : null}
                        <span className={`relative z-[1] max-w-[4.9rem] truncate rounded bg-black/45 px-1.5 py-0.5 text-center ${hasTexture ? 'text-white' : 'text-gray-400'}`}>
                          {PBR_SLOT_LABELS[slot]}
                        </span>
                        {!hasTexture ? <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[14px] text-gray-500">+</span> : null}
                        {hasTexture ? (
                          <button
                            type="button"
                            className="absolute right-1 top-1 z-[2] rounded bg-black/55 px-1 py-0.5 text-[8px] font-bold text-gray-300 ring-1 ring-white/10 hover:bg-black/75 hover:text-white"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void clearSlot(slot);
                            }}
                          >
                            x
                          </button>
                        ) : null}
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (file) void handleTextureFile(slot, file);
                          }}
                        />
                      </label>
                      <div
                        className={`workflow-pbr-param-slider-shell relative h-full w-4 shrink-0 ${paramAdjustable ? '' : 'opacity-35'}`}
                        role="slider"
                        tabIndex={paramAdjustable ? 0 : -1}
                        aria-disabled={!paramAdjustable}
                        aria-label={`${PBR_SLOT_LABELS[slot]} parameter`}
                        aria-valuemin={paramRange.min}
                        aria-valuemax={paramRange.max}
                        aria-valuenow={paramValue}
                        title={`${PBR_SLOT_LABELS[slot]} ${paramValue.toFixed(slot === 'height' ? 3 : 2)}`}
                        onPointerDown={(event) => {
                          if (!paramAdjustable) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          const nextValue = valueFromSliderPointer(slot, event.currentTarget, event.clientY);
                          setDraftSlotParams((prev) => ({ ...prev, [paramKey]: nextValue }));
                        }}
                        onPointerMove={(event) => {
                          if (!paramAdjustable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                          event.preventDefault();
                          const nextValue = valueFromSliderPointer(slot, event.currentTarget, event.clientY);
                          setDraftSlotParams((prev) => ({ ...prev, [paramKey]: nextValue }));
                        }}
                        onPointerUp={(event) => {
                          if (!paramAdjustable) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const nextValue = valueFromSliderPointer(slot, event.currentTarget, event.clientY);
                          setDraftSlotParams((prev) => ({ ...prev, [paramKey]: nextValue }));
                          updateSlotParam(slot, nextValue);
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                        }}
                        onPointerCancel={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                        }}
                      >
                        <span className="workflow-pbr-param-slider-track" aria-hidden />
                        <span
                          className="workflow-pbr-param-slider-thumb"
                          style={{ bottom: `${Math.min(100, Math.max(0, paramPercent))}%` }}
                          aria-hidden
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto border-l border-white/10 bg-white/[0.025] p-2">
            {materialSlots.map((slot) => {
              const active = slot.id === activeMaterial?.id;
              const edited = editedMaterialIds.has(slot.id);
              return (
                <button
                  key={slot.id}
                  type="button"
                  title={`${slot.label} · ${slot.meshCount} mesh`}
                  aria-label={slot.label}
                  aria-pressed={active}
                  onClick={() => setActiveMaterialId(slot.id)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-transform ${
                    active ? 'scale-105 ring-2 ring-blue-300/80' : 'ring-1 ring-white/12 hover:scale-105 hover:ring-white/30'
                  }`}
                >
                  <span
                    className="h-7 w-7 rounded-full shadow-[inset_-7px_-7px_12px_rgba(0,0,0,0.45),inset_5px_5px_8px_rgba(255,255,255,0.18)]"
                    style={{ background: `radial-gradient(circle at 32% 26%, #ffffffaa 0, ${slot.colorHex} 34%, #16171c 100%)` }}
                    aria-hidden
                  />
                  {edited ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0d0e12]" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {status === 'loading' ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center text-[10px] text-gray-500 pointer-events-none">
          3D 环境与模型加载中…
        </div>
      ) : null}
      {status === 'error' || status === 'unsupported' ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center text-[10px] text-amber-200/90 px-4 text-center pointer-events-none">
          {message}
        </div>
      ) : null}
    </div>
  );
};

export default ImageModel3DViewer;
