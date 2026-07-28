import { readLocalJson, writeLocalJson } from './clientPersist';

export type WorkflowModelPbrSlot =
  | 'baseColor'
  | 'normal'
  | 'ao'
  | 'roughness'
  | 'metallic'
  | 'emissive'
  | 'alpha'
  | 'height';

export type WorkflowModelPbrChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';
export type WorkflowModelPbrColorSpace = 'srgb' | 'linear';

export type WorkflowModelPbrTextureEdit = {
  /** 正式贴图资产 id（新路径必填；旧数据可仅有 dataUrl） */
  assetId?: string;
  /** 旧数据或瞬时预览；有 assetId 后可省略 */
  dataUrl?: string;
  fileName: string;
  mimeType?: string;
  channel: WorkflowModelPbrChannel;
  colorSpace: WorkflowModelPbrColorSpace;
  /**
   * embedded = 从当前 GLB 材质导出；user = 上传/生成。
   * 加载时仅 user 贴图回写到网格，避免版本切换把别的模型 atlas 涂上去。
   */
  source?: 'embedded' | 'user';
  normalFlipR?: boolean;
  normalFlipG?: boolean;
  enabled: boolean;
  updatedAt: number;
};

export type WorkflowModelPbrSlotCandidateSource = 'generate' | 'upload';

/** 贴图槽候选预览（生成/上传累加；点选后写入 slots） */
export type WorkflowModelPbrSlotCandidate = {
  /** UI 列表键；新路径与 assetId 相同 */
  id: string;
  /** 正式贴图资产 id */
  assetId?: string;
  /** 旧数据或瞬时预览；有 assetId 后可省略 */
  dataUrl?: string;
  fileName: string;
  mimeType?: string;
  source: WorkflowModelPbrSlotCandidateSource;
  presetId?: string;
  createdAt: number;
};

export type WorkflowModelPbrSlotParams = Partial<Record<WorkflowModelPbrSlot, number>>;

export type WorkflowModelPbrTextureRewriteTarget = {
  assetId: string;
  sourceTextureSrc: string;
  /** 正式贴图资产 id（升格后优先用此匹配写回） */
  sourceTextureAssetId?: string;
  slots: WorkflowModelPbrSlot[];
  materialIds?: string[];
  textureLabel?: string;
};

export type WorkflowModelPbrTextureLineage = WorkflowModelPbrTextureRewriteTarget & {
  id: string;
  resultTextureSrc: string;
  actionType: string;
  createdAt: number;
};

export type WorkflowModelPbrMaterialEdit = {
  materialName?: string;
  slots: Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrTextureEdit>>;
  params?: WorkflowModelPbrSlotParams;
  /** 各贴图槽的候选列表（会话/项目持久化，软顶见 MAX_PBR_SLOT_CANDIDATES） */
  slotCandidates?: Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrSlotCandidate[]>>;
  /** 当前应用到 slots 的候选 id（仅高亮；删候选时可不改槽位图） */
  activeCandidateIds?: Partial<Record<WorkflowModelPbrSlot, string>>;
};

/** 单槽候选累加软顶，防止列表无限膨胀 */
export const MAX_PBR_SLOT_CANDIDATES = 64;
/** 单次生成数量上限 */
export const MAX_PBR_SLOT_GENERATE_COUNT = 16;

export type WorkflowModelPbrEditDoc = {
  version: 1;
  assetId: string;
  variantId?: string;
  modelKey: string;
  updatedAt: number;
  materials: Record<string, WorkflowModelPbrMaterialEdit>;
};

export type WorkflowModelPbrEditPersistEventDetail = {
  assetId: string;
  variantId?: string;
  modelKey: string;
  doc: WorkflowModelPbrEditDoc;
};

export const WORKFLOW_MODEL_PBR_SLOTS: WorkflowModelPbrSlot[] = [
  'baseColor',
  'normal',
  'ao',
  'roughness',
  'metallic',
  'emissive',
  'alpha',
  'height',
];

const STORAGE_KEY = 'ac_workflow_model_pbr_edits_v1';
export const WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT = 'asset-preview:model3d-pbr-edit-persist';

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTextureEdit(value: unknown): WorkflowModelPbrTextureEdit | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const dataUrl = clean(rec.dataUrl);
  const assetId = clean(rec.assetId);
  if (!dataUrl && !assetId) return null;
  const channel = clean(rec.channel);
  const colorSpace = clean(rec.colorSpace);
  return {
    ...(assetId ? { assetId } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    fileName: clean(rec.fileName) || 'texture',
    mimeType: clean(rec.mimeType) || undefined,
    channel: channel === 'rgb' || channel === 'r' || channel === 'g' || channel === 'b' || channel === 'a' ? channel : 'rgb',
    colorSpace: colorSpace === 'srgb' ? 'srgb' : 'linear',
    source: rec.source === 'user' || rec.source === 'embedded' ? rec.source : assetId ? 'user' : undefined,
    normalFlipR: rec.normalFlipR === true || undefined,
    normalFlipG: rec.normalFlipG === true || undefined,
    enabled: rec.enabled !== false,
    updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : Date.now(),
  };
}

function normalizeSlotParams(value: unknown): WorkflowModelPbrSlotParams | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const params: WorkflowModelPbrSlotParams = {};
  for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
    const v = Number(raw[slot]);
    if (Number.isFinite(v)) params[slot] = v;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function normalizeSlotCandidate(value: unknown): WorkflowModelPbrSlotCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const dataUrl = clean(rec.dataUrl);
  const assetId = clean(rec.assetId);
  const id = clean(rec.id) || assetId;
  if (!id || (!dataUrl && !assetId)) return null;
  const source = clean(rec.source);
  return {
    id,
    ...(assetId ? { assetId } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    fileName: clean(rec.fileName) || 'texture',
    mimeType: clean(rec.mimeType) || undefined,
    source: source === 'generate' ? 'generate' : 'upload',
    presetId: clean(rec.presetId) || undefined,
    createdAt: Number.isFinite(rec.createdAt) ? Number(rec.createdAt) : Date.now(),
  };
}

function normalizeSlotCandidates(
  value: unknown
): Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrSlotCandidate[]>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: Partial<Record<WorkflowModelPbrSlot, WorkflowModelPbrSlotCandidate[]>> = {};
  let any = false;
  for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
    const list = raw[slot];
    if (!Array.isArray(list)) continue;
    const normalized = list
      .map((item) => normalizeSlotCandidate(item))
      .filter((item): item is WorkflowModelPbrSlotCandidate => Boolean(item))
      .slice(-MAX_PBR_SLOT_CANDIDATES);
    if (normalized.length > 0) {
      out[slot] = normalized;
      any = true;
    }
  }
  return any ? out : undefined;
}

function normalizeActiveCandidateIds(
  value: unknown
): Partial<Record<WorkflowModelPbrSlot, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: Partial<Record<WorkflowModelPbrSlot, string>> = {};
  let any = false;
  for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
    const id = clean(raw[slot]);
    if (!id) continue;
    out[slot] = id;
    any = true;
  }
  return any ? out : undefined;
}

export function appendWorkflowPbrSlotCandidates(
  existing: WorkflowModelPbrSlotCandidate[] | undefined,
  additions: WorkflowModelPbrSlotCandidate[]
): WorkflowModelPbrSlotCandidate[] {
  return [...(existing || []), ...additions].slice(-MAX_PBR_SLOT_CANDIDATES);
}

export function createWorkflowPbrSlotCandidate(input: {
  assetId?: string;
  dataUrl?: string;
  fileName?: string;
  mimeType?: string;
  source: WorkflowModelPbrSlotCandidateSource;
  presetId?: string;
  createdAt?: number;
}): WorkflowModelPbrSlotCandidate {
  const assetId = clean(input.assetId);
  const dataUrl = clean(input.dataUrl);
  const id =
    assetId ||
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `pbr-cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  return {
    id,
    ...(assetId ? { assetId } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    fileName: clean(input.fileName) || 'texture',
    mimeType: clean(input.mimeType) || undefined,
    source: input.source,
    presetId: clean(input.presetId) || undefined,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function textureEditFromPbrCandidate(
  candidate: WorkflowModelPbrSlotCandidate,
  slot: WorkflowModelPbrSlot,
  prev?: WorkflowModelPbrTextureEdit
): WorkflowModelPbrTextureEdit {
  const assetId = clean(candidate.assetId);
  const dataUrl = clean(candidate.dataUrl);
  return {
    ...(assetId ? { assetId } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    fileName: candidate.fileName,
    mimeType: candidate.mimeType || prev?.mimeType,
    channel: prev?.channel || defaultWorkflowPbrChannel(slot),
    colorSpace: prev?.colorSpace || defaultWorkflowPbrColorSpace(slot),
    source: 'user',
    normalFlipR: prev?.normalFlipR,
    normalFlipG: prev?.normalFlipG,
    enabled: true,
    updatedAt: Date.now(),
  };
}

/** 解析槽位/候选预览 URL：优先正式资产，再回退内嵌 dataUrl */
export function resolvePbrTextureSrc(
  ref: { assetId?: string; dataUrl?: string } | null | undefined,
  resolveAssetSrc?: ((assetId: string) => string) | null
): string {
  const assetId = clean(ref?.assetId);
  if (assetId && resolveAssetSrc) {
    const fromAsset = clean(resolveAssetSrc(assetId));
    if (fromAsset) return fromAsset;
  }
  return clean(ref?.dataUrl);
}

/** 收集 doc 内所有正式贴图资产 id */
export function collectPbrTextureAssetIds(doc: WorkflowModelPbrEditDoc | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!doc?.materials) return out;
  for (const mat of Object.values(doc.materials)) {
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const editId = clean(mat.slots?.[slot]?.assetId);
      if (editId) out.add(editId);
      for (const cand of mat.slotCandidates?.[slot] || []) {
        const candId = clean(cand.assetId);
        if (candId) out.add(candId);
      }
    }
  }
  return out;
}

/** before 有、after 无 → 可级联删除的贴图资产 */
export function diffRemovedPbrTextureAssetIds(
  before: WorkflowModelPbrEditDoc | null | undefined,
  after: WorkflowModelPbrEditDoc | null | undefined
): string[] {
  const prev = collectPbrTextureAssetIds(before);
  const next = collectPbrTextureAssetIds(after);
  return [...prev].filter((id) => !next.has(id));
}

/**
 * 从候选 id 中筛出「当前资产列表里已无任何 modelPbrEdits / stepModelPbrEdits 引用」的贴图资产。
 * `excludeAssetId`：正在被替换/删除的宿主，不参与引用统计。
 * `extraReferencedIds`：快捷栏等外部仍占用的 id。
 */
export function filterUnreferencedPbrTextureAssetIds(
  candidateIds: Iterable<string>,
  assets: Array<WorkflowAssetPbrHost & { id: string }>,
  options?: { excludeAssetId?: string; extraReferencedIds?: Iterable<string> }
): string[] {
  const exclude = clean(options?.excludeAssetId);
  const still = new Set<string>();
  for (const id of options?.extraReferencedIds || []) {
    const t = clean(id);
    if (t) still.add(t);
  }
  for (const asset of assets) {
    if (exclude && asset.id === exclude) continue;
    for (const texId of collectAssetAllPbrTextureAssetIds(asset)) {
      still.add(texId);
    }
  }
  return [...new Set([...candidateIds].map(clean).filter(Boolean))].filter((id) => !still.has(id));
}

/** Minimal host shape for per-step PBR docs (avoids importing full WorkflowAsset). */
export type WorkflowAssetPbrHost = {
  modelPbrEdits?: WorkflowModelPbrEditDoc | null;
  stepModelPbrEdits?: Record<string, WorkflowModelPbrEditDoc> | null;
  displayKey?: string;
};

export function resolveStepModelPbrSlotKey(opts: {
  variantId?: string;
  displayKey?: string;
  modelKey?: string;
}): string {
  return clean(opts.variantId) || clean(opts.displayKey) || clean(opts.modelKey);
}

/**
 * Resolve PBR edits for one model version.
 * Never reuse another version's seeded atlas via the legacy single `modelPbrEdits` field.
 */
export function resolveWorkflowAssetPbrEditDoc(
  asset: WorkflowAssetPbrHost | null | undefined,
  opts?: { stepKey?: string; variantId?: string; modelKey?: string }
): WorkflowModelPbrEditDoc | null {
  if (!asset) return null;
  const stepKey = resolveStepModelPbrSlotKey({
    variantId: opts?.variantId,
    displayKey: opts?.stepKey || asset.displayKey,
    modelKey: opts?.modelKey,
  });
  const modelKey = clean(opts?.modelKey);

  if (stepKey) {
    const fromStep = normalizeWorkflowModelPbrEditDoc(asset.stepModelPbrEdits?.[stepKey]);
    if (fromStep) return fromStep;
    const legacy = normalizeWorkflowModelPbrEditDoc(asset.modelPbrEdits);
    if (!legacy) return null;
    // Explicit step requested but empty: only accept legacy when it clearly is this step.
    if (clean(legacy.variantId) === stepKey) return legacy;
    if (!clean(legacy.variantId) && modelKey && clean(legacy.modelKey) === modelKey) return legacy;
    return null;
  }

  if (modelKey && asset.stepModelPbrEdits) {
    for (const doc of Object.values(asset.stepModelPbrEdits)) {
      const normalized = normalizeWorkflowModelPbrEditDoc(doc);
      if (normalized && clean(normalized.modelKey) === modelKey) return normalized;
    }
  }

  const legacy = normalizeWorkflowModelPbrEditDoc(asset.modelPbrEdits);
  if (!legacy) return null;
  if (modelKey && clean(legacy.modelKey) === modelKey) return legacy;
  if (modelKey || stepKey) return null;
  return legacy;
}

/** Write PBR edits into `stepModelPbrEdits[stepKey]`; mirror to legacy `modelPbrEdits` for old readers. */
export function writeWorkflowAssetStepPbrEdit<T extends WorkflowAssetPbrHost>(
  asset: T,
  stepKey: string,
  doc: WorkflowModelPbrEditDoc
): T {
  const key = clean(stepKey);
  const nextSteps = { ...(asset.stepModelPbrEdits || {}) };
  if (key) nextSteps[key] = doc;
  return {
    ...asset,
    ...(key ? { stepModelPbrEdits: nextSteps } : {}),
    modelPbrEdits: doc,
  };
}

export function collectAssetAllPbrTextureAssetIds(asset: WorkflowAssetPbrHost | null | undefined): Set<string> {
  const out = collectPbrTextureAssetIds(asset?.modelPbrEdits);
  for (const doc of Object.values(asset?.stepModelPbrEdits || {})) {
    for (const id of collectPbrTextureAssetIds(doc)) out.add(id);
  }
  return out;
}

/** True when a persisted doc is safe to apply onto the currently loaded model. */
export function workflowPbrEditDocMatchesModel(
  doc: WorkflowModelPbrEditDoc | null | undefined,
  opts: { modelKey?: string; variantId?: string }
): boolean {
  if (!doc) return false;
  const modelKey = clean(opts.modelKey);
  const variantId = clean(opts.variantId);
  const docVariant = clean(doc.variantId);
  const docModel = clean(doc.modelKey);
  // When the viewer knows its version id, require an exact variant match (or legacy
  // doc with no variantId but the same modelKey). Never accept another step's doc.
  if (variantId) {
    if (docVariant === variantId) return true;
    if (!docVariant && modelKey && docModel === modelKey) return true;
    return false;
  }
  if (modelKey && docModel === modelKey) return true;
  return false;
}

/** 槽位 edit 是否对应当前 rewrite 源（assetId 优先，再比 dataUrl/展示 URL） */
export function pbrTextureEditMatchesRewriteSource(
  edit: WorkflowModelPbrTextureEdit | null | undefined,
  target: Pick<WorkflowModelPbrTextureRewriteTarget, 'sourceTextureSrc' | 'sourceTextureAssetId'>,
  resolveAssetSrc?: ((assetId: string) => string) | null
): boolean {
  if (!edit?.enabled) return false;
  const sourceAssetId = clean(target.sourceTextureAssetId);
  const editAssetId = clean(edit.assetId);
  if (sourceAssetId && editAssetId && sourceAssetId === editAssetId) return true;
  const sourceSrc = clean(target.sourceTextureSrc);
  if (!sourceSrc) return false;
  if (clean(edit.dataUrl) === sourceSrc) return true;
  if (editAssetId && resolveAssetSrc && clean(resolveAssetSrc(editAssetId)) === sourceSrc) return true;
  return false;
}

/** 仅有 dataUrl、尚无 assetId 的槽/候选（惰性升格用） */
export function listLegacyPbrTextureDataUrlRefs(doc: WorkflowModelPbrEditDoc | null | undefined): Array<{
  materialId: string;
  slot: WorkflowModelPbrSlot;
  kind: 'slot' | 'candidate';
  candidateId?: string;
  dataUrl: string;
  fileName: string;
  mimeType?: string;
  source: WorkflowModelPbrSlotCandidateSource;
}> {
  const out: Array<{
    materialId: string;
    slot: WorkflowModelPbrSlot;
    kind: 'slot' | 'candidate';
    candidateId?: string;
    dataUrl: string;
    fileName: string;
    mimeType?: string;
    source: WorkflowModelPbrSlotCandidateSource;
  }> = [];
  if (!doc?.materials) return out;
  for (const [materialId, mat] of Object.entries(doc.materials)) {
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = mat.slots?.[slot];
      const editData = clean(edit?.dataUrl);
      if (edit && editData && !clean(edit.assetId)) {
        out.push({
          materialId,
          slot,
          kind: 'slot',
          dataUrl: editData,
          fileName: edit.fileName || 'texture',
          mimeType: edit.mimeType,
          source: 'upload',
        });
      }
      for (const cand of mat.slotCandidates?.[slot] || []) {
        const candData = clean(cand.dataUrl);
        if (candData && !clean(cand.assetId)) {
          out.push({
            materialId,
            slot,
            kind: 'candidate',
            candidateId: cand.id,
            dataUrl: candData,
            fileName: cand.fileName || 'texture',
            mimeType: cand.mimeType,
            source: cand.source,
          });
        }
      }
    }
  }
  return out;
}

/** 将升格结果写回 doc（清 dataUrl，挂 assetId） */
export function applyPbrTextureAssetIdToDoc(
  doc: WorkflowModelPbrEditDoc,
  target: {
    materialId: string;
    slot: WorkflowModelPbrSlot;
    kind: 'slot' | 'candidate';
    candidateId?: string;
    assetId: string;
  }
): WorkflowModelPbrEditDoc {
  const assetId = clean(target.assetId);
  if (!assetId) return doc;
  const mat = doc.materials[target.materialId];
  if (!mat) return doc;
  const nextMat: WorkflowModelPbrMaterialEdit = { ...mat };
  if (target.kind === 'slot') {
    const edit = nextMat.slots?.[target.slot];
    if (edit) {
      const { dataUrl: _drop, ...rest } = edit;
      nextMat.slots = {
        ...nextMat.slots,
        [target.slot]: { ...rest, assetId },
      };
    }
  } else {
    const list = nextMat.slotCandidates?.[target.slot] || [];
    const candId = clean(target.candidateId);
    nextMat.slotCandidates = {
      ...(nextMat.slotCandidates || {}),
      [target.slot]: list.map((c) => {
        if (c.id !== candId) return c;
        const { dataUrl: _drop, ...rest } = c;
        return { ...rest, id: assetId, assetId };
      }),
    };
    if (nextMat.activeCandidateIds?.[target.slot] === candId) {
      nextMat.activeCandidateIds = {
        ...nextMat.activeCandidateIds,
        [target.slot]: assetId,
      };
    }
  }
  return {
    ...doc,
    updatedAt: Date.now(),
    materials: { ...doc.materials, [target.materialId]: nextMat },
  };
}

export function normalizeWorkflowModelPbrEditDoc(value: unknown): WorkflowModelPbrEditDoc | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const assetId = clean(rec.assetId);
  const modelKey = clean(rec.modelKey);
  if (!assetId || !modelKey) return null;
  const materials: WorkflowModelPbrEditDoc['materials'] = {};
  const rawMaterials = rec.materials && typeof rec.materials === 'object' ? rec.materials as Record<string, unknown> : {};
  for (const [materialId, rawMaterial] of Object.entries(rawMaterials)) {
    if (!rawMaterial || typeof rawMaterial !== 'object') continue;
    const rawMatRec = rawMaterial as Record<string, unknown>;
    const rawSlots = rawMatRec.slots && typeof rawMatRec.slots === 'object' ? rawMatRec.slots as Record<string, unknown> : {};
    const slots: WorkflowModelPbrMaterialEdit['slots'] = {};
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = normalizeTextureEdit(rawSlots[slot]);
      if (edit) slots[slot] = edit;
    }
    materials[materialId] = {
      materialName: clean(rawMatRec.materialName) || undefined,
      slots,
      params: normalizeSlotParams(rawMatRec.params),
      slotCandidates: normalizeSlotCandidates(rawMatRec.slotCandidates),
      activeCandidateIds: normalizeActiveCandidateIds(rawMatRec.activeCandidateIds),
    };
  }
  return {
    version: 1,
    assetId,
    variantId: clean(rec.variantId) || undefined,
    modelKey,
    updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : Date.now(),
    materials,
  };
}

function storageKeyFor(assetId: string, variantId: string | undefined, modelKey: string): string {
  const raw = `${assetId}__${variantId || 'variant'}__${modelKey}`;
  return raw.replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 240);
}

function readAllDocs(): Record<string, WorkflowModelPbrEditDoc> {
  return readLocalJson<Record<string, WorkflowModelPbrEditDoc>>(STORAGE_KEY, {}, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, WorkflowModelPbrEditDoc> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const doc = normalizeWorkflowModelPbrEditDoc(value);
      if (doc) out[key] = doc;
    }
    return out;
  });
}

/** User upload/generate maps that must be re-applied onto the mesh on reopen. */
export function pbrEditDocHasUserAuthoredTextures(doc: WorkflowModelPbrEditDoc | null | undefined): boolean {
  if (!doc?.materials) return false;
  for (const mat of Object.values(doc.materials)) {
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = mat.slots?.[slot];
      if (!edit?.enabled) continue;
      if (edit.source === 'user') return true;
      if (edit.source === 'embedded') continue;
      // Legacy: formal texture asset or generate/upload candidates imply user authorship.
      if (clean(edit.assetId)) return true;
      const cands = mat.slotCandidates?.[slot] || [];
      if (cands.some((c) => c.source === 'generate' || c.source === 'upload')) return true;
    }
    if (Object.keys(mat.params || {}).length > 0) return true;
  }
  return false;
}

export function workflowModelPbrEditKey(assetId: string | undefined, variantId: string | undefined, modelKey: string | undefined): string {
  return storageKeyFor(clean(assetId) || 'unknown_asset', clean(variantId) || undefined, clean(modelKey) || 'unknown_model');
}

export function readWorkflowModelPbrEditDoc(key: string): WorkflowModelPbrEditDoc | null {
  return readAllDocs()[key] || null;
}

export function writeWorkflowModelPbrEditDoc(key: string, doc: WorkflowModelPbrEditDoc): void {
  const all = readAllDocs();
  all[key] = normalizeWorkflowModelPbrEditDoc(doc) || doc;
  writeLocalJson(STORAGE_KEY, all);
}

export function defaultWorkflowPbrColorSpace(slot: WorkflowModelPbrSlot): WorkflowModelPbrColorSpace {
  return slot === 'baseColor' || slot === 'emissive' ? 'srgb' : 'linear';
}

export function defaultWorkflowPbrChannel(slot: WorkflowModelPbrSlot): WorkflowModelPbrChannel {
  if (slot === 'baseColor' || slot === 'normal' || slot === 'emissive') return 'rgb';
  if (slot === 'roughness') return 'g';
  if (slot === 'metallic') return 'b';
  if (slot === 'alpha') return 'a';
  return 'r';
}

export function inferWorkflowPbrSlotsFromFileName(fileName: string): WorkflowModelPbrSlot[] {
  const n = fileName.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\b(orm|occlusion roughness metallic|ao roughness metallic)\b/.test(n)) return ['ao', 'roughness', 'metallic'];
  if (/\b(normal|nrm)\b/.test(n)) return ['normal'];
  if (/\b(roughness|rough)\b/.test(n)) return ['roughness'];
  if (/\b(metallic|metalness|metal)\b/.test(n)) return ['metallic'];
  if (/\b(occlusion|ambient occlusion|ao)\b/.test(n)) return ['ao'];
  if (/\b(emissive|emission|emit)\b/.test(n)) return ['emissive'];
  if (/\b(alpha|opacity|transparent)\b/.test(n)) return ['alpha'];
  if (/\b(height|displacement|disp)\b/.test(n)) return ['height'];
  if (/\b(base color|basecolor|albedo|diffuse|color)\b/.test(n)) return ['baseColor'];
  return [];
}
