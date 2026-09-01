export type WorkspaceSurface = 'canvas' | 'presets' | 'connections' | 'tools' | 'workflow' | 'settings' | 'other';

export type WorkspaceOpenSurface = 'canvas' | 'workflow' | 'connections' | 'tools' | 'settings';

export type WorkspaceConnectedHost = {
  id: string;
  title: string;
  sendTitle?: string;
  localVersionId?: string;
  softwareVersionLabel?: string;
  ready: boolean;
  canAcceptCurrentCard: boolean;
  canAcceptCurrentFile?: boolean;
  maturity?: string;
  blockedReason?: string;
  isDefault?: boolean;
};

export type WorkspaceFinger = {
  selectedAssetId: string | null;
  selectedRoot: string | null;
  selectedRelPath: string | null;
  selectedFileId: string | null;
  selectedDisplayKey: string | null;
  previewOpen: boolean;
  previewAssetId: string | null;
  surface: WorkspaceSurface;
  connectedHosts: WorkspaceConnectedHost[];
};

export const WORKSPACE_COMPARTMENT_IDS = ['workshop', 'workflow', 'tools', 'room'] as const;
export type WorkspaceCompartmentId = (typeof WORKSPACE_COMPARTMENT_IDS)[number];

export type WorkspaceCompartmentBucket = {
  assetIds: string[];
};

export type WorkspaceCompartments = {
  workshop: WorkspaceCompartmentBucket;
  workflow: WorkspaceCompartmentBucket;
  tools: WorkspaceCompartmentBucket;
  rooms: Record<string, WorkspaceCompartmentBucket>;
};

export type WorkspaceSnapshot = {
  projectId: string;
  finger: WorkspaceFinger;
  assetIds: string[];
  assets: Record<string, WorkspaceAssetPatch>;
  compartments: WorkspaceCompartments;
};

export type WorkspaceAssetPatch = {
  id: string;
  assetKind?: string;
  displayKey?: string;
  textBody?: string;
  textTitle?: string;
  textResults?: Record<string, string>;
  originalCompanionKey?: string;
  originalObjectKey?: string;
  resultsCompanionKeys?: Record<string, string>;
  resultOrder?: string[];
  compartment?: WorkspaceCompartmentId;
  roomId?: string;
};

export type WorkspaceEvent =
  | { type: 'finger.changed'; finger: Partial<WorkspaceFinger> }
  | { type: 'asset.upsert'; payload: WorkspaceAssetPatch }
  | { type: 'asset.removed'; assetId: string }
  | { type: 'command.failed'; commandType: string; error: string };

export type WorkspaceCommand =
  | { type: 'noop' }
  | { type: 'set_finger'; finger: Partial<WorkspaceFinger> }
  | { type: 'upsert_asset'; payload: WorkspaceAssetPatch }
  | { type: 'remove_asset'; assetId: string }
  | { type: 'append_text_result'; assetId?: string | null; text: string }
  | { type: 'ingest_image'; assetId?: string | null; companionKey?: string; imageDataUrl?: string; name?: string }
  | {
      type: 'generate_on_current';
      resultKey?: string;
      companionKey?: string;
      error?: string;
      ok?: boolean;
    }
  | { type: 'send_to_current_host'; hostId?: string }
  | { type: 'open_surface'; surface: WorkspaceOpenSurface };

export function emptyWorkspaceFinger(): WorkspaceFinger {
  return {
    selectedAssetId: null,
    selectedRoot: null,
    selectedRelPath: null,
    selectedFileId: null,
    selectedDisplayKey: null,
    previewOpen: false,
    previewAssetId: null,
    surface: 'canvas',
    connectedHosts: [],
  };
}

export function emptyWorkspaceCompartments(): WorkspaceCompartments {
  return {
    workshop: { assetIds: [] },
    workflow: { assetIds: [] },
    tools: { assetIds: [] },
    rooms: {},
  };
}

export function parseWorkspaceCompartmentId(value: unknown): WorkspaceCompartmentId {
  return WORKSPACE_COMPARTMENT_IDS.includes(value as WorkspaceCompartmentId)
    ? (value as WorkspaceCompartmentId)
    : 'workshop';
}

export function assetBelongsToCompartment(
  asset: { compartment?: string; roomId?: string } | null | undefined,
  compartment: WorkspaceCompartmentId,
  roomId?: string | null,
): boolean {
  const c = parseWorkspaceCompartmentId(asset?.compartment);
  if (c !== compartment) return false;
  if (c === 'room') return String(asset?.roomId || '') === String(roomId || '');
  return true;
}

export function workspaceEventsForCompartment(
  events: WorkspaceEvent[],
  compartment: WorkspaceCompartmentId,
  roomId?: string | null,
): WorkspaceEvent[] {
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event || typeof event !== 'object') return false;
    if (event.type === 'finger.changed' || event.type === 'command.failed') return true;
    if (event.type === 'asset.removed') return true;
    if (event.type === 'asset.upsert') return assetBelongsToCompartment(event.payload, compartment, roomId);
    return true;
  });
}

function placeAssetInCompartments(next: WorkspaceCompartments, id: string, asset: WorkspaceAssetPatch | undefined) {
  const c = parseWorkspaceCompartmentId(asset?.compartment);
  if (c === 'room') {
    const roomId = String(asset?.roomId || '').trim();
    if (!roomId) {
      next.workshop.assetIds.push(id);
      return;
    }
    if (!next.rooms[roomId]) next.rooms[roomId] = { assetIds: [] };
    next.rooms[roomId].assetIds.push(id);
    return;
  }
  next[c].assetIds.push(id);
}

export function rebuildWorkspaceCompartments(
  assets: Record<string, WorkspaceAssetPatch> | null | undefined,
  fallbackWorkshopIds: string[] = [],
): WorkspaceCompartments {
  const next = emptyWorkspaceCompartments();
  const map = assets && typeof assets === 'object' ? assets : {};
  const workshopFromAssets: string[] = [];
  for (const id of Object.keys(map)) {
    const c = parseWorkspaceCompartmentId(map[id]?.compartment);
    const roomId = String(map[id]?.roomId || '').trim();
    if (c === 'workshop' || (c === 'room' && !roomId)) {
      workshopFromAssets.push(id);
      continue;
    }
    placeAssetInCompartments(next, id, map[id]);
  }
  const stillWorkshop = (id: string) => {
    const t = String(id || '').trim();
    if (!t) return false;
    const asset = map[t];
    if (!asset) return true;
    const c = parseWorkspaceCompartmentId(asset.compartment);
    if (c === 'room') return !String(asset.roomId || '').trim();
    return c === 'workshop';
  };
  next.workshop.assetIds = uniqueAssetIds([
    ...fallbackWorkshopIds.filter(stillWorkshop),
    ...workshopFromAssets,
  ]);
  next.workflow.assetIds = uniqueAssetIds(next.workflow.assetIds);
  next.tools.assetIds = uniqueAssetIds(next.tools.assetIds);
  for (const roomId of Object.keys(next.rooms)) {
    next.rooms[roomId] = { assetIds: uniqueAssetIds(next.rooms[roomId].assetIds) };
  }
  return next;
}

export function emptyWorkspaceSnapshot(projectId = ''): WorkspaceSnapshot {
  return {
    projectId,
    finger: emptyWorkspaceFinger(),
    assetIds: [],
    assets: {},
    compartments: emptyWorkspaceCompartments(),
  };
}

function omitInlineBinary(value: unknown): string | undefined {
  const s = String(value || '').trim();
  if (!s || /^(data:|blob:)/i.test(s)) return undefined;
  return s;
}

function omitInlineBinaryRecord(record: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const k = String(key || '').trim();
    const v = omitInlineBinary(value);
    if (!k || !v) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeWorkspaceAssetPatch(payload: unknown): WorkspaceAssetPatch | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const resultOrder = Array.isArray(raw.resultOrder)
    ? raw.resultOrder.map((k) => String(k || '').trim()).filter(Boolean)
    : undefined;
  const patch: WorkspaceAssetPatch = { id };
  if (raw.assetKind != null && String(raw.assetKind).trim()) patch.assetKind = String(raw.assetKind).trim();
  if (raw.displayKey != null && String(raw.displayKey).trim()) patch.displayKey = String(raw.displayKey).trim();
  if (raw.textBody != null) patch.textBody = String(raw.textBody);
  if (raw.textTitle != null && String(raw.textTitle).trim()) patch.textTitle = String(raw.textTitle).trim();
  if (raw.textResults && typeof raw.textResults === 'object') {
    const textResults: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.textResults as Record<string, unknown>)) {
      const k = String(key || '').trim();
      if (!k) continue;
      textResults[k] = String(value ?? '');
    }
    if (Object.keys(textResults).length) patch.textResults = textResults;
  }
  const originalCompanionKey = omitInlineBinary(raw.originalCompanionKey);
  if (originalCompanionKey) patch.originalCompanionKey = originalCompanionKey;
  const originalObjectKey = omitInlineBinary(raw.originalObjectKey);
  if (originalObjectKey) patch.originalObjectKey = originalObjectKey;
  const resultsCompanionKeys = omitInlineBinaryRecord(raw.resultsCompanionKeys as Record<string, string>);
  if (resultsCompanionKeys) patch.resultsCompanionKeys = resultsCompanionKeys;
  if (resultOrder?.length) patch.resultOrder = resultOrder;
  const compartment = parseWorkspaceCompartmentId(raw.compartment);
  const roomId = String(raw.roomId || '').trim();
  if (compartment === 'room') {
    if (roomId) {
      patch.compartment = 'room';
      patch.roomId = roomId;
    }
  } else if (compartment !== 'workshop') {
    patch.compartment = compartment;
  }
  return patch;
}

function cloneAssets(assets: Record<string, WorkspaceAssetPatch> | null | undefined): Record<string, WorkspaceAssetPatch> {
  const src = assets && typeof assets === 'object' ? assets : {};
  const out: Record<string, WorkspaceAssetPatch> = {};
  for (const id of Object.keys(src)) {
    const patch = sanitizeWorkspaceAssetPatch(src[id]);
    if (patch) out[patch.id] = patch;
  }
  return out;
}

export function omitConnectedHostsFromFinger(finger: Partial<WorkspaceFinger> | null | undefined): Partial<WorkspaceFinger> {
  const next = finger && typeof finger === 'object' ? { ...finger } : {};
  delete next.connectedHosts;
  return next;
}

export function canvasFingerKey(finger: Partial<WorkspaceFinger> | null | undefined): string {
  const f = finger || {};
  return [
    f.selectedAssetId || '',
    f.selectedRoot || '',
    f.selectedRelPath || '',
    f.selectedFileId || '',
    f.selectedDisplayKey || '',
    f.previewOpen ? '1' : '0',
    f.previewAssetId || '',
    f.surface || 'canvas',
  ].join('|');
}

/** Keep multi-select when the primary id is unchanged; replace when dsh points at another card. */
export function nextSelectedAssetIdsFromFinger(
  currentIds: Iterable<string> | null | undefined,
  selectedAssetId: string | null | undefined,
): string[] {
  const current = Array.from(currentIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const id = selectedAssetId == null ? '' : String(selectedAssetId).trim();
  if (!id) return [];
  if (current[0] === id) return current;
  return [id];
}

export function workspaceFingerFromUi(args: {
  selectedAssetIds?: Iterable<string>;
  selectedRoot?: string | null;
  selectedRelPath?: string | null;
  selectedFileId?: string | null;
  assets?: Array<{ id?: string; displayKey?: string }>;
  lightboxAssetId?: string | null;
  surface?: WorkspaceSurface;
  connectedHosts?: WorkspaceConnectedHost[];
}): WorkspaceFinger {
  const ids = Array.from(args.selectedAssetIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const selectedAssetId = ids[0] || null;
  const assets = Array.isArray(args.assets) ? args.assets : [];
  const selected = selectedAssetId ? assets.find((a) => String(a?.id || '') === selectedAssetId) : undefined;
  const lb = String(args.lightboxAssetId || '').trim() || null;
  const selectedRelPath = String(args.selectedRelPath || '').trim() || null;
  const selectedRoot = String(args.selectedRoot || '').trim() || null;
  const selectedFileId = String(args.selectedFileId || '').trim() || null;
  return {
    selectedAssetId,
    selectedRoot,
    selectedRelPath,
    selectedFileId,
    selectedDisplayKey:
      selected?.displayKey != null && String(selected.displayKey).trim()
        ? String(selected.displayKey)
        : selectedRelPath
          ? 'original'
          : null,
    previewOpen: Boolean(lb),
    previewAssetId: lb,
    surface: args.surface || 'canvas',
    connectedHosts: Array.isArray(args.connectedHosts) ? args.connectedHosts : [],
  };
}

function uniqueAssetIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const t = String(id || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function cloneSnapshot(snapshot: WorkspaceSnapshot | null | undefined): WorkspaceSnapshot {
  const assets = cloneAssets(snapshot?.assets);
  const compartments = rebuildWorkspaceCompartments(assets, snapshot?.assetIds || []);
  return {
    projectId: String(snapshot?.projectId || ''),
    finger: snapshot?.finger
      ? { ...emptyWorkspaceFinger(), ...snapshot.finger, connectedHosts: [...(snapshot.finger.connectedHosts || [])] }
      : emptyWorkspaceFinger(),
    assets,
    compartments,
    assetIds: compartments.workshop.assetIds,
  };
}

export function reduceWorkspaceEvents(
  events: WorkspaceEvent[],
  initial?: WorkspaceSnapshot | null,
): WorkspaceSnapshot {
  let snap = cloneSnapshot(initial);
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'finger.changed') {
      const next = event.finger && typeof event.finger === 'object' ? event.finger : {};
      snap = {
        ...snap,
        finger: {
          ...snap.finger,
          ...next,
          connectedHosts: Array.isArray(next.connectedHosts) ? next.connectedHosts : snap.finger.connectedHosts,
        },
      };
      continue;
    }
    if (event.type === 'asset.upsert') {
      const payload = sanitizeWorkspaceAssetPatch(event.payload);
      if (!payload) continue;
      const assets = { ...snap.assets, [payload.id]: { ...snap.assets[payload.id], ...payload, id: payload.id } };
      const compartments = rebuildWorkspaceCompartments(assets, snap.assetIds);
      snap = {
        ...snap,
        assets,
        compartments,
        assetIds: compartments.workshop.assetIds,
      };
      continue;
    }
    if (event.type === 'asset.removed') {
      const id = String(event.assetId || '').trim();
      if (!id) continue;
      const assets = { ...snap.assets };
      delete assets[id];
      const remainingIds = snap.assetIds.filter((item) => item !== id);
      const compartments = rebuildWorkspaceCompartments(assets, remainingIds);
      snap = {
        ...snap,
        assets,
        compartments,
        assetIds: compartments.workshop.assetIds,
      };
    }
  }
  return snap;
}

export function workspaceCommandToEvents(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
): WorkspaceEvent[] {
  const base = cloneSnapshot(snapshot);
  if (!command || command.type === 'noop') return [];

  if (command.type === 'set_finger') {
    const patch = omitConnectedHostsFromFinger(command.finger);
    if (!Object.keys(patch).length) return [];
    return [{ type: 'finger.changed', finger: patch }];
  }

  if (command.type === 'upsert_asset') {
    const payload = sanitizeWorkspaceAssetPatch(command.payload);
    if (!payload) return [];
    return [{ type: 'asset.upsert', payload }];
  }

  if (command.type === 'remove_asset') {
    const id = String(command.assetId || '').trim();
    if (!id) return [];
    const events: WorkspaceEvent[] = [{ type: 'asset.removed', assetId: id }];
    const fingerPatch = fingerPatchAfterRemovingAsset(base.finger, id);
    if (fingerPatch) events.push({ type: 'finger.changed', finger: fingerPatch });
    return events;
  }

  if (command.type === 'append_text_result') {
    const text = String(command.text || '');
    const target = String(command.assetId || base.finger.selectedAssetId || '').trim();
    const id = target || `text-${base.assetIds.length + 1}`;
    const events: WorkspaceEvent[] = [
      {
        type: 'asset.upsert',
        payload: {
          id,
          assetKind: 'text',
          displayKey: target ? `append_${id}` : 'original',
          textBody: target ? undefined : text,
          textResults: target ? { [`append_${id}`]: text } : undefined,
        },
      },
    ];
    if (!target) {
      events.push({ type: 'finger.changed', finger: { selectedAssetId: id } });
    }
    return events;
  }

  if (command.type === 'ingest_image') {
    const id = String(command.assetId || '').trim() || `image-${base.assetIds.length + 1}`;
    const companionKey = String(command.companionKey || '').trim();
    return [
      {
        type: 'asset.upsert',
        payload: {
          id,
          assetKind: 'image',
          displayKey: 'original',
          textTitle: String(command.name || '').trim() || undefined,
          originalCompanionKey: companionKey || undefined,
        },
      },
      { type: 'finger.changed', finger: { selectedAssetId: id, selectedDisplayKey: 'original' } },
    ];
  }

  if (command.type === 'generate_on_current') {
    const id = String(base.finger.selectedAssetId || '').trim();
    if (!id) {
      return [{ type: 'command.failed', commandType: 'generate_on_current', error: 'no_selected_asset' }];
    }
    if (command.ok === false || command.error) {
      return [
        {
          type: 'command.failed',
          commandType: 'generate_on_current',
          error: String(command.error || 'generate_failed'),
        },
      ];
    }
    if (command.ok !== true && !String(command.resultKey || '').trim()) {
      return [{ type: 'command.failed', commandType: 'generate_on_current', error: 'generate_unwired' }];
    }
    const resultKey = String(command.resultKey || '').trim() || `gen_${id}`;
    return [
      {
        type: 'asset.upsert',
        payload: {
          id,
          displayKey: resultKey,
          resultsCompanionKeys: command.companionKey
            ? { [resultKey]: String(command.companionKey) }
            : undefined,
          resultOrder: [resultKey],
        },
      },
      { type: 'finger.changed', finger: { selectedAssetId: id, selectedDisplayKey: resultKey } },
    ];
  }

  if (command.type === 'send_to_current_host') {
    const picked = pickHostForSend(base.finger, command.hostId);
    if (!picked.ok) {
      return [{ type: 'command.failed', commandType: 'send_to_current_host', error: picked.error }];
    }
    return [];
  }

  if (command.type === 'open_surface') {
    return [];
  }

  return [];
}

export function applyWorkspaceCommand(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
): WorkspaceSnapshot {
  return reduceWorkspaceEvents(workspaceCommandToEvents(snapshot, command), snapshot);
}

export function hostCanAcceptForSend(host: WorkspaceConnectedHost | null | undefined): boolean {
  if (!host || !host.ready) return false;
  if (host.canAcceptCurrentFile === true) return true;
  if (host.canAcceptCurrentCard === true) return true;
  return false;
}

export function pickHostForSend(
  finger: WorkspaceFinger | null | undefined,
  hostId?: string,
): { ok: true; host: WorkspaceConnectedHost } | { ok: false; error: string } {
  const hosts = Array.isArray(finger?.connectedHosts) ? finger.connectedHosts : [];
  const ready = hosts.filter((h) => h && h.ready);
  if (!ready.length) return { ok: false, error: 'no_ready_host' };
  const wanted = String(hostId || '').trim();
  if (wanted) {
    const hit = ready.find((h) => h.id === wanted);
    if (!hit) return { ok: false, error: 'no_ready_host' };
    if (!hostCanAcceptForSend(hit)) return { ok: false, error: 'host_cannot_accept' };
    return { ok: true, host: hit };
  }
  const accepting = ready.filter((h) => hostCanAcceptForSend(h));
  if (!accepting.length) return { ok: false, error: 'host_cannot_accept' };
  if (accepting.length !== 1) return { ok: false, error: 'multi_ready_host' };
  return { ok: true, host: accepting[0] };
}

export function sendHostErrorSuggestSurface(error: string): WorkspaceOpenSurface | undefined {
  if (error === 'no_ready_host' || error === 'multi_ready_host') return 'connections';
  return undefined;
}

export function formatWorkspaceFingerForDsh(finger: WorkspaceFinger): string {
  const f = finger || emptyWorkspaceFinger();
  const hosts = Array.isArray(f.connectedHosts) ? f.connectedHosts : [];
  const hostLine = hosts.length
    ? hosts.map((h) => h.title || h.id).filter(Boolean).join(', ')
    : '未连接';
  const readyCount = hosts.filter((h) => h && h.ready).length;
  const pendingFile = f.selectedRelPath || f.selectedAssetId || '';
  return [
    `selectedAssetId=${f.selectedAssetId || ''}`,
    `selectedRoot=${f.selectedRoot || ''}`,
    `selectedRelPath=${f.selectedRelPath || ''}`,
    `selectedFileId=${f.selectedFileId || ''}`,
    `selectedDisplayKey=${f.selectedDisplayKey || ''}`,
    `previewOpen=${f.previewOpen ? '1' : '0'}`,
    `previewAssetId=${f.previewAssetId || ''}`,
    `surface=${f.surface || 'other'}`,
    `connectedHosts=${hostLine}`,
    `pendingFile=${pendingFile}`,
    `hostReadyCount=${readyCount}`,
  ].join('\n');
}

const DOCUMENT_INJECT_MAX_CARDS = 40;
const DOCUMENT_INJECT_TEXT = 80;

function previewInjectText(value: unknown): string {
  const t = String(value || '').replace(/\s+/g, ' ').trim();
  if (t.length <= DOCUMENT_INJECT_TEXT) return t;
  return `${t.slice(0, DOCUMENT_INJECT_TEXT)}…`;
}

export function clampFingerToAssetIds(finger: WorkspaceFinger, assetIds: string[]): WorkspaceFinger {
  const ids = new Set((assetIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const next = { ...emptyWorkspaceFinger(), ...finger, connectedHosts: [...(finger?.connectedHosts || [])] };
  if (next.selectedAssetId && !ids.has(next.selectedAssetId)) {
    next.selectedAssetId = null;
    next.selectedDisplayKey = null;
  }
  if (next.previewAssetId && !ids.has(next.previewAssetId)) {
    next.previewAssetId = null;
    next.previewOpen = false;
  }
  return next;
}

export function fingerPatchAfterRemovingAsset(
  finger: WorkspaceFinger | null | undefined,
  assetId: string,
): Partial<WorkspaceFinger> | null {
  const id = String(assetId || '').trim();
  if (!id || !finger) return null;
  const patch: Partial<WorkspaceFinger> = {};
  if (finger.selectedAssetId === id) {
    patch.selectedAssetId = null;
    patch.selectedDisplayKey = null;
  }
  if (finger.previewAssetId === id) {
    patch.previewOpen = false;
    patch.previewAssetId = null;
  }
  return Object.keys(patch).length ? patch : null;
}

export function formatWorkspaceDocumentForDsh(snapshot: WorkspaceSnapshot | null | undefined): string {
  const snap = snapshot || emptyWorkspaceSnapshot();
  const ids = snap.assetIds.length ? snap.assetIds : Object.keys(snap.assets || {});
  const shown = ids.slice(0, DOCUMENT_INJECT_MAX_CARDS);
  const extra = ids.length - shown.length;
  const compartments = snap.compartments || emptyWorkspaceCompartments();
  const roomCount = Object.keys(compartments.rooms || {}).length;
  const lines = [
    '这是本地壳正在编辑的同一份稿。读稿用 workspace_read_document，改稿用 workspace_dispatch。不要发明网页按钮工具。',
    `projectId=${snap.projectId || ''}`,
    formatWorkspaceFingerForDsh(snap.finger),
    `cardCount=${ids.length}`,
    `compartments=workshop:${compartments.workshop.assetIds.length} workflow:${compartments.workflow.assetIds.length} tools:${compartments.tools.assetIds.length} rooms:${roomCount}`,
  ];
  for (const id of shown) {
    const a = snap.assets?.[id] || { id };
    const text = a.textBody || (a.textResults ? Object.values(a.textResults)[0] : '') || '';
    const hasFile = Boolean(a.originalCompanionKey || (a.resultsCompanionKeys && Object.keys(a.resultsCompanionKeys).length));
    lines.push(
      `- id=${id} kind=${a.assetKind || ''} display=${a.displayKey || ''} title=${previewInjectText(a.textTitle || '')} text=${previewInjectText(text)} file=${hasFile ? '1' : '0'}`,
    );
  }
  if (extra > 0) lines.push(`…另有 ${extra} 张卡未列出`);
  return lines.join('\n');
}
