'use strict';

const { pickHostForSend } = require('./workspace-finger-hosts.cjs');

function uniqueAssetIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    const t = String(id || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const WORKSPACE_COMPARTMENT_IDS = ['workshop', 'workflow', 'tools', 'room'];

function emptyWorkspaceCompartments() {
  return {
    workshop: { assetIds: [] },
    workflow: { assetIds: [] },
    tools: { assetIds: [] },
    rooms: {},
  };
}

function parseWorkspaceCompartmentId(value) {
  return WORKSPACE_COMPARTMENT_IDS.includes(value) ? value : 'workshop';
}

function assetBelongsToCompartment(asset, compartment, roomId) {
  const c = parseWorkspaceCompartmentId(asset && asset.compartment);
  if (c !== compartment) return false;
  if (c === 'room') return String((asset && asset.roomId) || '') === String(roomId || '');
  return true;
}

function workspaceEventsForCompartment(events, compartment, roomId) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event || typeof event !== 'object') return false;
    if (event.type === 'finger.changed' || event.type === 'command.failed') return true;
    if (event.type === 'asset.removed') return true;
    if (event.type === 'asset.upsert') return assetBelongsToCompartment(event.payload, compartment, roomId);
    return true;
  });
}

function placeAssetInCompartments(next, id, asset) {
  const c = parseWorkspaceCompartmentId(asset && asset.compartment);
  if (c === 'room') {
    const roomId = String((asset && asset.roomId) || '').trim();
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

function rebuildWorkspaceCompartments(assets, fallbackWorkshopIds) {
  const next = emptyWorkspaceCompartments();
  const map = assets && typeof assets === 'object' ? assets : {};
  const workshopFromAssets = [];
  for (const id of Object.keys(map)) {
    const c = parseWorkspaceCompartmentId(map[id] && map[id].compartment);
    const roomId = String((map[id] && map[id].roomId) || '').trim();
    if (c === 'workshop' || (c === 'room' && !roomId)) {
      workshopFromAssets.push(id);
      continue;
    }
    placeAssetInCompartments(next, id, map[id]);
  }
  const stillWorkshop = (id) => {
    const t = String(id || '').trim();
    if (!t) return false;
    const asset = map[t];
    if (!asset) return true;
    const c = parseWorkspaceCompartmentId(asset.compartment);
    if (c === 'room') return !String(asset.roomId || '').trim();
    return c === 'workshop';
  };
  next.workshop.assetIds = uniqueAssetIds([
    ...(Array.isArray(fallbackWorkshopIds) ? fallbackWorkshopIds.filter(stillWorkshop) : []),
    ...workshopFromAssets,
  ]);
  next.workflow.assetIds = uniqueAssetIds(next.workflow.assetIds);
  next.tools.assetIds = uniqueAssetIds(next.tools.assetIds);
  for (const roomId of Object.keys(next.rooms)) {
    next.rooms[roomId] = { assetIds: uniqueAssetIds(next.rooms[roomId].assetIds) };
  }
  return next;
}

function emptyFinger() {
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

function omitInlineBinary(value) {
  const s = String(value || '').trim();
  if (!s || /^(data:|blob:)/i.test(s)) return undefined;
  return s;
}

function omitInlineBinaryRecord(record) {
  if (!record || typeof record !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    const k = String(key || '').trim();
    const v = omitInlineBinary(value);
    if (!k || !v) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeWorkspaceAssetPatch(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const id = String(payload.id || '').trim();
  if (!id) return null;
  const resultOrder = Array.isArray(payload.resultOrder)
    ? payload.resultOrder.map((k) => String(k || '').trim()).filter(Boolean)
    : undefined;
  const patch = { id };
  if (payload.assetKind != null && String(payload.assetKind).trim()) patch.assetKind = String(payload.assetKind).trim();
  if (payload.displayKey != null && String(payload.displayKey).trim()) patch.displayKey = String(payload.displayKey).trim();
  if (payload.textBody != null) patch.textBody = String(payload.textBody);
  if (payload.textTitle != null && String(payload.textTitle).trim()) patch.textTitle = String(payload.textTitle).trim();
  if (payload.textResults && typeof payload.textResults === 'object') {
    const textResults = {};
    for (const [key, value] of Object.entries(payload.textResults)) {
      const k = String(key || '').trim();
      if (!k) continue;
      textResults[k] = String(value ?? '');
    }
    if (Object.keys(textResults).length) patch.textResults = textResults;
  }
  const originalCompanionKey = omitInlineBinary(payload.originalCompanionKey);
  if (originalCompanionKey) patch.originalCompanionKey = originalCompanionKey;
  const originalObjectKey = omitInlineBinary(payload.originalObjectKey);
  if (originalObjectKey) patch.originalObjectKey = originalObjectKey;
  const resultsCompanionKeys = omitInlineBinaryRecord(payload.resultsCompanionKeys);
  if (resultsCompanionKeys) patch.resultsCompanionKeys = resultsCompanionKeys;
  if (resultOrder && resultOrder.length) patch.resultOrder = resultOrder;
  const compartment = parseWorkspaceCompartmentId(payload.compartment);
  const roomId = String(payload.roomId || '').trim();
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

function cloneAssets(assets) {
  const src = assets && typeof assets === 'object' ? assets : {};
  const out = {};
  for (const id of Object.keys(src)) {
    const patch = sanitizeWorkspaceAssetPatch(src[id]);
    if (patch) out[patch.id] = patch;
  }
  return out;
}

function cloneSnapshot(snapshot) {
  const finger = snapshot && snapshot.finger ? snapshot.finger : emptyFinger();
  const assets = cloneAssets(snapshot && snapshot.assets);
  const compartments = rebuildWorkspaceCompartments(assets, snapshot && snapshot.assetIds);
  return {
    projectId: String((snapshot && snapshot.projectId) || ''),
    finger: {
      ...emptyFinger(),
      ...finger,
      connectedHosts: Array.isArray(finger.connectedHosts) ? finger.connectedHosts.slice() : [],
    },
    assets,
    compartments,
    assetIds: compartments.workshop.assetIds,
  };
}

function reduceWorkspaceEvents(events, initial) {
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
      const assets = { ...snap.assets, [payload.id]: { ...(snap.assets[payload.id] || {}), ...payload, id: payload.id } };
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

function fingerPatchAfterRemovingAsset(finger, assetId) {
  const id = String(assetId || '').trim();
  if (!id || !finger) return null;
  const patch = {};
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

function clampFingerToAssetIds(finger, assetIds) {
  const ids = new Set(uniqueAssetIds(assetIds));
  const next = {
    ...emptyFinger(),
    ...(finger || {}),
    connectedHosts: Array.isArray(finger && finger.connectedHosts) ? finger.connectedHosts.slice() : [],
  };
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

function workspaceCommandToEvents(snapshot, command) {
  const base = cloneSnapshot(snapshot);
  if (!command || command.type === 'noop') return [];
  if (command.type === 'set_finger') {
    const patch = command.finger && typeof command.finger === 'object' ? { ...command.finger } : {};
    delete patch.connectedHosts;
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
    const events = [{ type: 'asset.removed', assetId: id }];
    const fingerPatch = fingerPatchAfterRemovingAsset(base.finger, id);
    if (fingerPatch) events.push({ type: 'finger.changed', finger: fingerPatch });
    return events;
  }
  if (command.type === 'append_text_result') {
    const text = String(command.text || '');
    const target = String(command.assetId || base.finger.selectedAssetId || '').trim();
    const id = target || `text-${base.assetIds.length + 1}`;
    const events = [
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
    if (!target) events.push({ type: 'finger.changed', finger: { selectedAssetId: id } });
    return events;
  }
  if (command.type === 'ingest_image') {
    const id = String(command.assetId || '').trim() || `image-${base.assetIds.length + 1}`;
    return [
      {
        type: 'asset.upsert',
        payload: {
          id,
          assetKind: 'image',
          displayKey: 'original',
          originalCompanionKey: String(command.companionKey || '').trim() || undefined,
        },
      },
      { type: 'finger.changed', finger: { selectedAssetId: id, selectedDisplayKey: 'original' } },
    ];
  }
  if (command.type === 'generate_on_current') {
    const id = String(base.finger.selectedAssetId || '').trim();
    if (!id) return [{ type: 'command.failed', commandType: 'generate_on_current', error: 'no_selected_asset' }];
    if (command.ok === false || command.error) {
      return [{ type: 'command.failed', commandType: 'generate_on_current', error: String(command.error || 'generate_failed') }];
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
          resultsCompanionKeys: command.companionKey ? { [resultKey]: String(command.companionKey) } : undefined,
          resultOrder: [resultKey],
        },
      },
      { type: 'finger.changed', finger: { selectedAssetId: id, selectedDisplayKey: resultKey } },
    ];
  }
  if (command.type === 'send_to_current_host') {
    const picked = pickHostForSend(base.finger, command.hostId);
    if (!picked.ok) return [{ type: 'command.failed', commandType: 'send_to_current_host', error: picked.error }];
    return [];
  }
  return [];
}

function createWorkspaceDocumentStore(opts = {}) {
  let snapshot = cloneSnapshot(opts.initial);
  const events = [];
  const listeners = [];

  function dispatch(command) {
    const nextEvents = workspaceCommandToEvents(snapshot, command);
    return applyEvents(nextEvents);
  }

  function applyEvents(nextEvents) {
    const list = Array.isArray(nextEvents) ? nextEvents : [];
    events.push(...list);
    snapshot = reduceWorkspaceEvents(list, snapshot);
    for (const fn of listeners) {
      try {
        fn(list, snapshot);
      } catch {
        /* ignore subscriber errors */
      }
    }
    return snapshot;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function hydrate(payload) {
    const patches = payload && Array.isArray(payload.assets) ? payload.assets : [];
    const assets = {};
    const ids = [];
    for (const item of patches) {
      const patch = sanitizeWorkspaceAssetPatch(item);
      if (!patch) continue;
      assets[patch.id] = patch;
      ids.push(patch.id);
    }
    const assetIds = uniqueAssetIds(ids);
    const compartments = rebuildWorkspaceCompartments(assets, assetIds);
    snapshot = {
      ...cloneSnapshot(snapshot),
      projectId: String((payload && payload.projectId) || snapshot.projectId || ''),
      assetIds: compartments.workshop.assetIds,
      assets,
      compartments,
      finger: clampFingerToAssetIds(snapshot.finger, compartments.workshop.assetIds),
    };
    return cloneSnapshot(snapshot);
  }

  return {
    dispatch,
    applyEvents,
    hydrate,
    subscribe,
    getSnapshot: () => cloneSnapshot(snapshot),
    getEvents: () => events.slice(),
  };
}

module.exports = {
  createWorkspaceDocumentStore,
  reduceWorkspaceEvents,
  workspaceCommandToEvents,
  pickHostForSend,
  sanitizeWorkspaceAssetPatch,
  cloneSnapshot,
  emptyWorkspaceCompartments,
  parseWorkspaceCompartmentId,
  workspaceEventsForCompartment,
  rebuildWorkspaceCompartments,
};
