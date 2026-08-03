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

function countPbrSlotCandidates(doc: WorkflowModelPbrEditDoc): number {
  let n = 0;
  for (const mat of Object.values(doc.materials || {})) {
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      n += mat.slotCandidates?.[slot]?.length || 0;
    }
  }
  return n;
}

function candidateDedupeKey(c: WorkflowModelPbrSlotCandidate): string {
  return clean(c.assetId) || clean(c.id) || clean(c.dataUrl);
}

/**
 * Merge slotCandidates from `secondary` into `primary` (primary wins on id conflicts).
 * Used when host asset doc and localStorage diverge after admin navigation / remount.
 */
export function mergeWorkflowModelPbrEditDocsPreferringPrimary(
  primary: WorkflowModelPbrEditDoc,
  secondary: WorkflowModelPbrEditDoc | null | undefined
): WorkflowModelPbrEditDoc {
  const sec = normalizeWorkflowModelPbrEditDoc(secondary);
  if (!sec) return primary;
  let touched = false;
  const materials: WorkflowModelPbrEditDoc['materials'] = { ...primary.materials };
  for (const [matId, secMat] of Object.entries(sec.materials || {})) {
    const priMat = materials[matId] || {
      materialName: secMat.materialName,
      slots: {},
    };
    const nextCandidates: NonNullable<WorkflowModelPbrMaterialEdit['slotCandidates']> = {
      ...(priMat.slotCandidates || {}),
    };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const secList = secMat.slotCandidates?.[slot];
      if (!secList?.length) continue;
      const priList = nextCandidates[slot] || [];
      const seen = new Set(priList.map(candidateDedupeKey).filter(Boolean));
      const extras = secList.filter((c) => {
        const key = candidateDedupeKey(c);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (extras.length === 0) continue;
      nextCandidates[slot] = appendWorkflowPbrSlotCandidates(priList, extras);
      touched = true;
    }
    const nextSlots = { ...(priMat.slots || {}) };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      if (nextSlots[slot] || !secMat.slots?.[slot]) continue;
      nextSlots[slot] = secMat.slots[slot];
      touched = true;
    }
    const nextActive = { ...(priMat.activeCandidateIds || {}) };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      if (clean(nextActive[slot]) || !clean(secMat.activeCandidateIds?.[slot])) continue;
      nextActive[slot] = secMat.activeCandidateIds![slot]!;
      touched = true;
    }
    materials[matId] = {
      ...priMat,
      materialName: priMat.materialName || secMat.materialName,
      slots: nextSlots,
      params: priMat.params || secMat.params,
      slotCandidates: Object.keys(nextCandidates).length ? nextCandidates : priMat.slotCandidates,
      activeCandidateIds: Object.keys(nextActive).length ? nextActive : priMat.activeCandidateIds,
    };
  }
  if (!touched) return primary;
  return {
    ...primary,
    materials,
    updatedAt: Math.max(primary.updatedAt || 0, sec.updatedAt || 0, Date.now()),
  };
}

/**
 * Prefer the newer host/localStorage PBR doc, then union slotCandidates from the other side
 * so admin remount cannot drop generated texture previews.
 */
export function pickPreferredWorkflowModelPbrEditDoc(
  a: WorkflowModelPbrEditDoc | null | undefined,
  b: WorkflowModelPbrEditDoc | null | undefined
): WorkflowModelPbrEditDoc | null {
  const na = normalizeWorkflowModelPbrEditDoc(a);
  const nb = normalizeWorkflowModelPbrEditDoc(b);
  if (!na) return nb;
  if (!nb) return na;
  const ca = countPbrSlotCandidates(na);
  const cb = countPbrSlotCandidates(nb);
  // Richer candidate set wins when clocks are close (stale host after SPA remount).
  let primary = na;
  let secondary = nb;
  if (ca !== cb) {
    const richer = ca > cb ? na : nb;
    const poorer = richer === na ? nb : na;
    const richerTs = richer.updatedAt || 0;
    const poorerTs = poorer.updatedAt || 0;
    if (richerTs + 60_000 >= poorerTs) {
      primary = richer;
      secondary = poorer;
    } else {
      primary = poorerTs >= richerTs ? poorer : richer;
      secondary = primary === poorer ? richer : poorer;
    }
  } else if ((nb.updatedAt || 0) > (na.updatedAt || 0)) {
    primary = nb;
    secondary = na;
  }
  return mergeWorkflowModelPbrEditDocsPreferringPrimary(primary, secondary);
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
 * Persist/sync: drop nested atlas dataUrls once the formal texture asset can be
 * reloaded (companion / object key). Never strip dataUrl-only seeds (pre-promote).
 */
export function stripInlineDataUrlsFromPbrEditDoc(
  doc: WorkflowModelPbrEditDoc | null | undefined,
  options?: {
    dropAllDataUrls?: boolean;
    /** Only strip when assetId is in this set (has companion/object/http original). */
    resolvableAssetIds?: ReadonlySet<string>;
  }
): WorkflowModelPbrEditDoc | null {
  const normalized = normalizeWorkflowModelPbrEditDoc(doc);
  if (!normalized) return doc ? { ...doc } : null;
  const dropAll = Boolean(options?.dropAllDataUrls);
  const resolvable = options?.resolvableAssetIds;
  let touched = false;
  const materials: WorkflowModelPbrEditDoc['materials'] = {};
  for (const [matId, mat] of Object.entries(normalized.materials || {})) {
    const nextSlots: WorkflowModelPbrMaterialEdit['slots'] = { ...(mat.slots || {}) };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = nextSlots[slot];
      if (!edit?.dataUrl) continue;
      const aid = clean(edit.assetId);
      const shouldDrop =
        dropAll ||
        (Boolean(aid) && (!resolvable || resolvable.has(aid)));
      if (!shouldDrop) continue;
      const { dataUrl: _d, ...rest } = edit;
      nextSlots[slot] = rest;
      touched = true;
    }
    const nextCands: NonNullable<WorkflowModelPbrMaterialEdit['slotCandidates']> = {
      ...(mat.slotCandidates || {}),
    };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const list = nextCands[slot];
      if (!list?.length) continue;
      nextCands[slot] = list.map((c) => {
        if (!c.dataUrl) return c;
        const aid = clean(c.assetId);
        const shouldDrop =
          dropAll ||
          (Boolean(aid) && (!resolvable || resolvable.has(aid)));
        if (!shouldDrop) return c;
        const { dataUrl: _d, ...rest } = c;
        touched = true;
        return rest;
      });
    }
    materials[matId] = {
      ...mat,
      slots: nextSlots,
      slotCandidates: Object.keys(nextCands).length ? nextCands : mat.slotCandidates,
    };
  }
  if (!touched) return normalized;
  return { ...normalized, materials, updatedAt: Date.now() };
}

export function stripInlineDataUrlsFromAssetPbrFields<
  T extends WorkflowAssetPbrHost,
>(
  asset: T,
  options?: {
    dropAllDataUrls?: boolean;
    resolvableAssetIds?: ReadonlySet<string>;
  }
): T {
  let next: T = asset;
  if (asset.modelPbrEdits) {
    const stripped = stripInlineDataUrlsFromPbrEditDoc(asset.modelPbrEdits, options);
    if (stripped && stripped !== asset.modelPbrEdits) {
      next = { ...next, modelPbrEdits: stripped };
    }
  }
  if (asset.stepModelPbrEdits && typeof asset.stepModelPbrEdits === 'object') {
    let stepTouched = false;
    const steps: NonNullable<WorkflowAssetPbrHost['stepModelPbrEdits']> = {
      ...asset.stepModelPbrEdits,
    };
    for (const [k, doc] of Object.entries(steps)) {
      const stripped = stripInlineDataUrlsFromPbrEditDoc(doc, options);
      if (stripped && stripped !== doc) {
        steps[k] = stripped;
        stepTouched = true;
      }
    }
    if (stepTouched) next = { ...next, stepModelPbrEdits: steps };
  }
  return next;
}

/** Remove texture assetId refs from a PBR doc (after user deletes texture cards). */
export function detachPbrTextureAssetIdsFromDoc(
  doc: WorkflowModelPbrEditDoc | null | undefined,
  removeIds: ReadonlySet<string>
): WorkflowModelPbrEditDoc | null {
  const normalized = normalizeWorkflowModelPbrEditDoc(doc);
  if (!normalized || !removeIds.size) return normalized;
  let touched = false;
  const materials: WorkflowModelPbrEditDoc['materials'] = {};
  for (const [matId, mat] of Object.entries(normalized.materials || {})) {
    const nextSlots: WorkflowModelPbrMaterialEdit['slots'] = { ...(mat.slots || {}) };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = nextSlots[slot];
      if (!edit) continue;
      const aid = clean(edit.assetId);
      if (!aid || !removeIds.has(aid)) continue;
      const { assetId: _a, dataUrl, ...rest } = edit;
      const kept = clean(dataUrl);
      if (kept) {
        nextSlots[slot] = { ...rest, dataUrl: kept };
      } else {
        delete nextSlots[slot];
      }
      touched = true;
    }
    const nextCands: NonNullable<WorkflowModelPbrMaterialEdit['slotCandidates']> = {
      ...(mat.slotCandidates || {}),
    };
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const list = nextCands[slot];
      if (!list?.length) continue;
      const filtered = list
        .map((c) => {
          const aid = clean(c.assetId);
          if (!aid || !removeIds.has(aid)) return c;
          const { assetId: _a, dataUrl, ...rest } = c;
          const kept = clean(dataUrl);
          touched = true;
          if (kept) return { ...rest, id: rest.id || aid, dataUrl: kept };
          return null;
        })
        .filter(Boolean) as WorkflowModelPbrSlotCandidate[];
      nextCands[slot] = filtered;
    }
    let nextActive = mat.activeCandidateIds;
    if (nextActive) {
      const activeNext = { ...nextActive };
      let activeTouched = false;
      for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
        const cur = clean(activeNext[slot]);
        if (cur && removeIds.has(cur)) {
          delete activeNext[slot];
          activeTouched = true;
          touched = true;
        }
      }
      nextActive = activeTouched ? activeNext : nextActive;
    }
    materials[matId] = {
      ...mat,
      slots: nextSlots,
      slotCandidates: Object.keys(nextCands).length ? nextCands : mat.slotCandidates,
      activeCandidateIds: nextActive,
    };
  }
  if (!touched) return normalized;
  return { ...normalized, materials, updatedAt: Date.now() };
}

export function detachPbrTextureAssetIdsFromAssets<T extends WorkflowAssetPbrHost & { id: string }>(
  assets: T[],
  removeIds: ReadonlySet<string>
): T[] {
  if (!assets.length || !removeIds.size) return assets;
  let changed = false;
  const next = assets.map((asset) => {
    let patched: T = asset;
    if (asset.modelPbrEdits) {
      const doc = detachPbrTextureAssetIdsFromDoc(asset.modelPbrEdits, removeIds);
      if (doc && doc !== asset.modelPbrEdits) {
        patched = { ...patched, modelPbrEdits: doc };
        changed = true;
      }
    }
    if (asset.stepModelPbrEdits && typeof asset.stepModelPbrEdits === 'object') {
      let stepTouched = false;
      const steps = { ...asset.stepModelPbrEdits };
      for (const [k, doc] of Object.entries(steps)) {
        const scrubbed = detachPbrTextureAssetIdsFromDoc(doc, removeIds);
        if (scrubbed && scrubbed !== doc) {
          steps[k] = scrubbed;
          stepTouched = true;
        }
      }
      if (stepTouched) {
        patched = { ...patched, stepModelPbrEdits: steps };
        changed = true;
      }
    }
    return patched;
  });
  return changed ? next : assets;
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
  // Viewer knows its version: require exact variant match. Do NOT fall back to
  // modelKey alone — shared filenames / companion keys caused cross-version atlas paint.
  if (variantId) {
    return docVariant === variantId;
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

/** 升格来源：候选 generate/upload，或 GLB 嵌入贴图 embedded */
export type WorkflowModelPbrTexturePromoteSource = WorkflowModelPbrSlotCandidateSource | 'embedded';

/** 仅有 dataUrl、尚无 assetId 的槽/候选（惰性升格用） */
export function listLegacyPbrTextureDataUrlRefs(doc: WorkflowModelPbrEditDoc | null | undefined): Array<{
  materialId: string;
  slot: WorkflowModelPbrSlot;
  kind: 'slot' | 'candidate';
  candidateId?: string;
  dataUrl: string;
  fileName: string;
  mimeType?: string;
  source: WorkflowModelPbrTexturePromoteSource;
}> {
  const out: Array<{
    materialId: string;
    slot: WorkflowModelPbrSlot;
    kind: 'slot' | 'candidate';
    candidateId?: string;
    dataUrl: string;
    fileName: string;
    mimeType?: string;
    source: WorkflowModelPbrTexturePromoteSource;
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
          source: edit.source === 'embedded' ? 'embedded' : 'upload',
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
      if (!shouldApplyPbrTextureEditToMesh(edit)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Whether a slot edit should be painted onto the live mesh.
 * Embedded GLB extracts are panel-only — re-applying them via TextureLoader
 * flips/scrambling UV atlases and can paste another version's map onto the wrong mesh.
 */
export function shouldApplyPbrTextureEditToMesh(
  edit: WorkflowModelPbrTextureEdit | null | undefined
): boolean {
  if (!edit?.enabled) return false;
  if (edit.source === 'embedded') return false;
  if (edit.source === 'user') return true;
  // Legacy: formal asset / dataUrl without source tag (pre-source field).
  return Boolean(clean(edit.assetId) || clean(edit.dataUrl));
}

type WorkflowPbrTextureMetaEntry = {
  displayStepLabel?: string | null;
  source?: {
    capability?: string | null;
    paramsSnapshot?: unknown;
  } | null;
} | null | undefined;

function pbrParamsSnapshotLooksLikeTexture(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const snap = snapshot as Record<string, unknown>;
  if (clean(String(snap.pbrHostAssetId || ''))) return true;
  const src = clean(String(snap.pbrSource || ''));
  return src === 'upload' || src === 'generate' || src === 'embedded';
}

function collectPbrTextureDataUrlsFromDoc(doc: WorkflowModelPbrEditDoc | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!doc?.materials) return out;
  for (const mat of Object.values(doc.materials)) {
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const du = clean(mat.slots?.[slot]?.dataUrl);
      if (du) out.add(du);
      for (const cand of mat.slotCandidates?.[slot] || []) {
        const cdu = clean(cand.dataUrl);
        if (cdu) out.add(cdu);
      }
    }
  }
  return out;
}

/** Formal PBR texture assets: persist on disk but never enter the asset grid. */
export function isWorkflowPbrTextureAsset(asset: {
  pbrHostAssetId?: string | null;
  resultMeta?: Record<string, WorkflowPbrTextureMetaEntry> | null | undefined;
} | null | undefined): boolean {
  if (clean(asset?.pbrHostAssetId)) return true;
  const meta = asset?.resultMeta;
  if (!meta || typeof meta !== 'object') return false;
  for (const entry of Object.values(meta)) {
    if (String(entry?.source?.capability || '').trim() === 'pbr_texture') return true;
    if (String(entry?.displayStepLabel || '').trim() === 'PBR Texture') return true;
    if (pbrParamsSnapshotLooksLikeTexture(entry?.source?.paramsSnapshot)) return true;
  }
  return false;
}

/** Collect texture asset ids referenced by any host PBR docs (incl. localStorage cache). */
export function collectReferencedPbrTextureAssetIdsFromAssets(
  assets: Array<WorkflowAssetPbrHost & { id?: string }> | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const asset of assets || []) {
    for (const id of collectAssetAllPbrTextureAssetIds(asset)) out.add(id);
  }
  try {
    for (const doc of Object.values(readAllDocs())) {
      for (const id of collectPbrTextureAssetIds(doc)) out.add(id);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function collectAllPbrTextureDataUrls(
  assets: Array<WorkflowAssetPbrHost> | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const asset of assets || []) {
    for (const du of collectPbrTextureDataUrlsFromDoc(asset.modelPbrEdits)) out.add(du);
    for (const doc of Object.values(asset.stepModelPbrEdits || {})) {
      for (const du of collectPbrTextureDataUrlsFromDoc(doc)) out.add(du);
    }
  }
  try {
    for (const doc of Object.values(readAllDocs())) {
      for (const du of collectPbrTextureDataUrlsFromDoc(doc)) out.add(du);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Host + localStorage PBR docs' inline dataUrls (for grid hide when original was stripped). */
export function collectReferencedPbrTextureDataUrlsFromAssets(
  assets: Array<WorkflowAssetPbrHost> | null | undefined
): Set<string> {
  return collectAllPbrTextureDataUrls(assets);
}

/**
 * Heal after load/merge: force hiddenInGrid + capability + pbrHostAssetId for PBR textures
 * (by meta, host slot ref, localStorage doc, or matching embedded dataUrl).
 */
export function healWorkflowPbrTextureGridVisibility<
  T extends WorkflowAssetPbrHost & {
    id: string;
    original?: string;
    hiddenInGrid?: boolean;
    pbrHostAssetId?: string;
    resultMeta?: Record<string, WorkflowPbrTextureMetaEntry> | null;
  },
>(assets: T[]): T[] {
  if (!assets.length) return assets;
  const refs = collectReferencedPbrTextureAssetIdsFromAssets(assets);
  const dataUrls = collectAllPbrTextureDataUrls(assets);
  // Infer host for referenced tex ids from docs
  const hostByTex = new Map<string, string>();
  for (const asset of assets) {
    const hostId = clean(asset.id);
    if (!hostId) continue;
    for (const texId of collectAssetAllPbrTextureAssetIds(asset)) {
      if (!hostByTex.has(texId)) hostByTex.set(texId, hostId);
    }
  }
  try {
    for (const doc of Object.values(readAllDocs())) {
      const hostId = clean(doc.assetId);
      if (!hostId) continue;
      for (const texId of collectPbrTextureAssetIds(doc)) {
        if (!hostByTex.has(texId)) hostByTex.set(texId, hostId);
      }
    }
  } catch {
    /* ignore */
  }

  let changed = false;
  const next = assets.map((asset) => {
    const orig = clean(asset.original);
    const byRef = refs.has(asset.id);
    const byDataUrl = Boolean(orig && dataUrls.has(orig));
    const byMeta = isWorkflowPbrTextureAsset(asset);
    if (!byRef && !byDataUrl && !byMeta) return asset;

    let patched: T = asset;
    if (!patched.hiddenInGrid) {
      patched = { ...patched, hiddenInGrid: true };
      changed = true;
    }
    const inferredHost =
      clean(patched.pbrHostAssetId) ||
      hostByTex.get(asset.id) ||
      (() => {
        const meta = patched.resultMeta || {};
        for (const entry of Object.values(meta)) {
          const snap = entry?.source?.paramsSnapshot;
          if (snap && typeof snap === 'object') {
            const hid = clean(String((snap as Record<string, unknown>).pbrHostAssetId || ''));
            if (hid) return hid;
          }
        }
        return '';
      })();
    if (inferredHost && clean(patched.pbrHostAssetId) !== inferredHost) {
      patched = { ...patched, pbrHostAssetId: inferredHost };
      changed = true;
    }

    const meta = { ...(patched.resultMeta || {}) };
    const original =
      meta.original && typeof meta.original === 'object'
        ? { ...(meta.original as Record<string, unknown>) }
        : ({ executedAt: Date.now() } as Record<string, unknown>);
    const prevSource = original.source;
    const source =
      prevSource && typeof prevSource === 'object'
        ? { ...(prevSource as Record<string, unknown>) }
        : ({ source: 'local' } as Record<string, unknown>);
    const capability = String(source.capability || '').trim();
    const label = String(original.displayStepLabel || '').trim();
    let metaTouched = false;
    if (capability !== 'pbr_texture') {
      source.capability = 'pbr_texture';
      metaTouched = true;
    }
    if (label !== 'PBR Texture') {
      original.displayStepLabel = 'PBR Texture';
      metaTouched = true;
    }
    if (inferredHost) {
      const snap =
        source.paramsSnapshot && typeof source.paramsSnapshot === 'object'
          ? { ...(source.paramsSnapshot as Record<string, unknown>) }
          : {};
      if (clean(String(snap.pbrHostAssetId || '')) !== inferredHost) {
        snap.pbrHostAssetId = inferredHost;
        source.paramsSnapshot = snap;
        metaTouched = true;
      }
    }
    if (metaTouched || !meta.original) {
      original.source = source;
      if (typeof original.executedAt !== 'number') original.executedAt = Date.now();
      meta.original = original as WorkflowPbrTextureMetaEntry;
      patched = { ...patched, resultMeta: meta };
      changed = true;
    }
    return patched;
  });
  return changed ? next : assets;
}

/** Asset grid / lightbox / @mention: hide flagged, PBR-tagged, or PBR-referenced assets. */
export function isWorkflowAssetHiddenFromAssetGrid(
  asset: {
    id?: string;
    original?: string;
    hiddenInGrid?: boolean;
    pbrHostAssetId?: string | null;
    resultMeta?: Record<string, WorkflowPbrTextureMetaEntry> | null | undefined;
  } | null | undefined,
  options?: {
    referencedPbrTextureIds?: ReadonlySet<string>;
    pbrTextureDataUrls?: ReadonlySet<string>;
  }
): boolean {
  if (!asset) return true;
  if (asset.hiddenInGrid || isWorkflowPbrTextureAsset(asset)) return true;
  const id = clean(asset.id);
  if (id && options?.referencedPbrTextureIds?.has(id)) return true;
  const orig = clean(asset.original);
  if (orig && options?.pbrTextureDataUrls?.has(orig)) return true;
  return false;
}

export function shouldReseedEmbeddedPbrDocFromMesh(
  matchedDoc: WorkflowModelPbrEditDoc | null | undefined
): boolean {
  return !matchedDoc;
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
