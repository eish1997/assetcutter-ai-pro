'use strict';

/** @param {{ ok?: boolean; roots?: Array<{ root?: string }> } | null | undefined} hostState */
function workshopFolderSourceOfTruthFromState(hostState) {
  const st = hostState && typeof hostState === 'object' ? hostState : {};
  if (st.ok === false) return false;
  const roots = Array.isArray(st.roots) ? st.roots : [];
  return roots.length > 0;
}

/** Folder mode: workbench only needs finger / command.failed, not card projection. */
function filterWorkbenchDocumentEvents(events, folderSource) {
  const list = Array.isArray(events) ? events : [];
  if (!folderSource) return list;
  return list.filter((e) => e && (e.type === 'finger.changed' || e.type === 'command.failed'));
}

function parseCommandCompartment(command) {
  const payload = command && command.payload && typeof command.payload === 'object' ? command.payload : {};
  const raw = String(payload.compartment || 'workshop').trim();
  if (raw === 'workflow' || raw === 'tools' || raw === 'room') return raw;
  return 'workshop';
}

/** Skip web→store workshop card writes when disk folder is the workshop source of truth. */
function shouldSkipWorkshopAssetCommand(command, folderSource) {
  if (!folderSource || !command || typeof command !== 'object') return false;
  const type = String(command.type || '');
  if (type === 'upsert_asset') return parseCommandCompartment(command) === 'workshop';
  if (type === 'remove_asset') return true;
  if (type === 'ingest_image') return true;
  return false;
}

function readDocumentSnapshotForFolderSource(snap) {
  const finger = (snap && snap.finger) || {};
  const compartments = snap && snap.compartments && typeof snap.compartments === 'object' ? snap.compartments : {};
  const workflowIds = Array.isArray(compartments.workflow && compartments.workflow.assetIds)
    ? compartments.workflow.assetIds.slice()
    : [];
  const toolsIds = Array.isArray(compartments.tools && compartments.tools.assetIds)
    ? compartments.tools.assetIds.slice()
    : [];
  const rooms = compartments.rooms && typeof compartments.rooms === 'object' ? compartments.rooms : {};
  return {
    ok: true,
    projectId: '',
    finger,
    assetIds: [],
    assets: {},
    workshopFolderSource: true,
    compartments: {
      workshop: { assetIds: [], folderSource: true },
      workflow: { assetIds: workflowIds },
      tools: { assetIds: toolsIds },
      rooms,
    },
  };
}

/** @param {string} compartment */
function compartmentAssetIdsFromSnapshot(snap, compartment) {
  const c = snap && snap.compartments && typeof snap.compartments === 'object' ? snap.compartments : {};
  if (compartment === 'workflow') {
    return Array.isArray(c.workflow && c.workflow.assetIds) ? c.workflow.assetIds.slice() : [];
  }
  if (compartment === 'tools') {
    return Array.isArray(c.tools && c.tools.assetIds) ? c.tools.assetIds.slice() : [];
  }
  if (compartment === 'workshop') {
    if (snap && snap.workshopFolderSource) return [];
    return Array.isArray(c.workshop && c.workshop.assetIds) ? c.workshop.assetIds.slice() : [];
  }
  return [];
}

module.exports = {
  workshopFolderSourceOfTruthFromState,
  filterWorkbenchDocumentEvents,
  shouldSkipWorkshopAssetCommand,
  readDocumentSnapshotForFolderSource,
  compartmentAssetIdsFromSnapshot,
};
