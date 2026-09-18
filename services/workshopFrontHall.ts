import { parentRel, toPosixRel } from './workshopFileTree';
import { workshopCanvasKindSet, type WorkshopCanvasKindId } from './workshopCanvasNav';

/** L0 listing row in the current folder (grid). */
export type WorkshopFrontHallListingItem = {
  root: string;
  rel: string;
  name: string;
  kind?: string;
};

export type WorkshopFrontHallLayoutPose = {
  x: number;
  y: number;
  z?: number;
  width?: number;
  height?: number;
};

export type WorkshopFrontHallLayoutMap = Record<string, WorkshopFrontHallLayoutPose>;

export type WorkshopFrontHallToken = {
  id: string;
  fileRel: string;
  nodeId: string;
};

export type WorkshopFrontHallGraphNode = {
  id: string;
  folderRel: string;
};

export type WorkshopFrontHallEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type WorkshopFrontHallBoardState = {
  root: string;
  /** Folder rels that still have a frame, including emptied ones. */
  frames: string[];
  nodes: WorkshopFrontHallGraphNode[];
  tokens: WorkshopFrontHallToken[];
};

export type WorkshopFrontHallTreeEntry = {
  rel: string;
  kind: string;
};

function addFrameAndAncestors(frames: Set<string>, folderRel: string): void {
  let cur = toPosixRel(folderRel);
  while (cur) {
    frames.add(cur);
    cur = parentRel(cur);
  }
}

export function buildBoardStateFromTree(
  root: string,
  entries: WorkshopFrontHallTreeEntry[],
): WorkshopFrontHallBoardState {
  const rootNorm = listingRoot(root);
  const frames = new Set<string>(['']);
  const nodes: WorkshopFrontHallGraphNode[] = [];
  const tokens: WorkshopFrontHallToken[] = [];
  for (const entry of entries || []) {
    const rel = toPosixRel(entry.rel);
    const kind = String(entry.kind || '').trim() || 'file';
    if (kind === 'dir') {
      addFrameAndAncestors(frames, rel);
      continue;
    }
    if (!rel) continue;
    const folderRel = parentRel(rel);
    addFrameAndAncestors(frames, folderRel);
    const id = workshopFrontHallEntryId(rootNorm, rel);
    nodes.push({ id, folderRel });
    tokens.push({
      id: `tok:${id}`,
      fileRel: rel,
      nodeId: id,
    });
  }
  return {
    root: rootNorm,
    frames: [...frames],
    nodes,
    tokens,
  };
}

export type WorkshopFrontHallGridProjection = {
  ids: string[];
};

export type WorkshopFrontHallBoardNode = {
  id: string;
  folderRel: string;
  pose: WorkshopFrontHallLayoutPose | null;
};

export type WorkshopFrontHallBoardProjection = {
  ids: string[];
  frames: string[];
  nodes: WorkshopFrontHallBoardNode[];
};

export type WorkshopKindPluginRegistration = {
  kind: string;
  extensions: string[];
  hydrate: string;
  card: string;
  focus: string;
  previewable: string[];
  ownsFileBytes?: boolean;
};

function listingRoot(root: string): string {
  return String(root || '').trim();
}

function basenameRel(rel: string): string {
  const posix = toPosixRel(rel);
  const i = posix.lastIndexOf('/');
  return i < 0 ? posix : posix.slice(i + 1);
}

export function workshopFrontHallEntryId(root: string, rel: string): string {
  return `${listingRoot(root)}::${toPosixRel(rel)}`;
}

export function workshopFrontHallFrameId(root: string, folderRel: string): string {
  return `${listingRoot(root)}::frame::${toPosixRel(folderRel)}`;
}

export function workshopFrontHallCameraFrameRel(loc: { root?: string; rel?: string } | null | undefined): string {
  return toPosixRel(loc?.rel);
}

export function workshopFrontHallCameraFrameId(
  root: string,
  loc: { root?: string; rel?: string } | null | undefined,
): string {
  return workshopFrontHallFrameId(root, workshopFrontHallCameraFrameRel(loc));
}

export function workshopFrontHallLayoutKey(root: string, rel: string): string {
  return workshopFrontHallEntryId(root, rel);
}

export function boardEntriesToTreeInput(
  entries: Array<{ rel?: string; kind?: string; assetKind?: string }>,
): WorkshopFrontHallTreeEntry[] {
  return (entries || []).map((entry) => {
    const rel = toPosixRel(entry.rel);
    const kind = String(entry.kind || '').trim();
    if (kind === 'dir' || kind === 'folder') return { rel, kind: 'dir' };
    return { rel, kind: String(entry.assetKind || kind || 'file') };
  });
}

export function boardNodesFromAcAssetDoc(
  root: string,
  packageRel: string,
  doc: { files?: Record<string, { name?: string }> } | null | undefined,
): WorkshopFrontHallGraphNode[] {
  const folderRel = parentRel(packageRel);
  const files = doc && doc.files && typeof doc.files === 'object' ? doc.files : {};
  const nodes: WorkshopFrontHallGraphNode[] = [];
  const seen = new Set<string>();
  for (const rec of Object.values(files)) {
    const name = String(rec?.name || '').trim();
    if (!name) continue;
    const rel = moveRelIntoFolder(name, toPosixRel(packageRel));
    const id = workshopFrontHallEntryId(root, rel);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, folderRel });
  }
  return nodes;
}

export function mergeBoardPackageNodes(
  state: WorkshopFrontHallBoardState,
  extraNodes: WorkshopFrontHallGraphNode[],
): WorkshopFrontHallBoardState {
  const have = new Set(state.nodes.map((node) => node.id));
  const nodes = state.nodes.slice();
  for (const node of extraNodes || []) {
    if (!node?.id || have.has(node.id)) continue;
    have.add(node.id);
    nodes.push({ id: node.id, folderRel: toPosixRel(node.folderRel) });
  }
  return { ...state, nodes };
}

export function workshopFrontHallListingIds(listing: WorkshopFrontHallListingItem[]): string[] {
  return listing.map((item) => workshopFrontHallEntryId(item.root, item.rel));
}

export function moveRelIntoFolder(fileRel: string, folderRel: string): string {
  const name = basenameRel(fileRel);
  const folder = toPosixRel(folderRel);
  return folder ? `${folder}/${name}` : name;
}

export function tokenFileFolderRel(fileRel: string): string {
  return parentRel(fileRel);
}

export function projectFrontHallGrid(listing: WorkshopFrontHallListingItem[]): WorkshopFrontHallGridProjection {
  return { ids: workshopFrontHallListingIds(listing) };
}

export function filterListingByKinds(
  listing: WorkshopFrontHallListingItem[],
  kinds: Iterable<string>,
): WorkshopFrontHallListingItem[] {
  const allow = new Set([...kinds].map((k) => String(k)));
  return listing.filter((item) => allow.has(String(item.kind || 'file')));
}

export function frontHallListingKind(rel: string): WorkshopCanvasKindId {
  const lower = toPosixRel(rel).toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg|exr|hdr)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video';
  if (/\.(txt|md|json|csv|html)$/.test(lower)) return 'text';
  if (/\.(glb|gltf|obj|fbx|usd|usda|usdc)$/.test(lower)) return 'model3d';
  return 'file';
}

export type FrontHallViewFilter = {
  kinds?: Iterable<string> | null;
  nameQuery?: string;
};

export function frontHallNodeMatchesViewFilter(
  input: { fileRel?: string; title?: string; kind?: string },
  filter?: FrontHallViewFilter | null,
): boolean {
  if (!filter) return true;
  const rel = toPosixRel(input.fileRel || '');
  const kind = (input.kind as WorkshopCanvasKindId | undefined) || frontHallListingKind(rel);
  if (filter.kinds != null) {
    const kinds = workshopCanvasKindSet(filter.kinds);
    if (!kinds.has(kind)) return false;
  }
  const q = String(filter.nameQuery || '').trim().toLowerCase();
  if (!q) return true;
  const name = basenameRel(rel).toLowerCase();
  const title = String(input.title || '').toLowerCase();
  return name.includes(q) || title.includes(q);
}

export function workshopFrontHallPreviewUrlIsUsable(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^(data:|blob:|ac-workshop:)/i.test(raw)) return true;
  return workshopFrontHallMetaUrlIsPersistable(raw);
}

export function projectFrontHallBoard(
  state: WorkshopFrontHallBoardState,
  layout?: WorkshopFrontHallLayoutMap | null,
): WorkshopFrontHallBoardProjection {
  const map = layout && typeof layout === 'object' ? layout : null;
  const frames = [...new Set(state.frames.map((rel) => toPosixRel(rel)))];
  const nodes = state.nodes.map((node) => {
    const id = String(node.id || '').trim();
    const folderRel = toPosixRel(node.folderRel);
    const pose = map?.[id] ?? null;
    return { id, folderRel, pose };
  });
  return { ids: nodes.map((node) => node.id), frames, nodes };
}

export function gridIdsMatchListing(listing: WorkshopFrontHallListingItem[]): boolean {
  const ids = projectFrontHallGrid(listing).ids;
  return ids.length === listing.length && new Set(ids).size === listing.length;
}

export function boardContainsFrames(state: WorkshopFrontHallBoardState, folderRels: string[]): boolean {
  const have = new Set(projectFrontHallBoard(state).frames);
  return folderRels.every((rel) => have.has(toPosixRel(rel)));
}

export function tokensOnNode(state: WorkshopFrontHallBoardState, nodeId: string): WorkshopFrontHallToken[] {
  return state.tokens.filter((token) => token.nodeId === nodeId);
}

export function fingerTarget(selectedNodeId: string | null | undefined): string | null {
  const id = String(selectedNodeId || '').trim();
  return id || null;
}

export function fingerLocalRels(state: WorkshopFrontHallBoardState, selectedNodeId: string | null): string[] {
  const id = fingerTarget(selectedNodeId);
  if (!id) return [];
  return tokensOnNode(state, id).map((token) => toPosixRel(token.fileRel));
}

export function f3AddToken(
  state: WorkshopFrontHallBoardState,
  nodeId: string,
  tokenId: string,
  fileRel: string,
): WorkshopFrontHallBoardState {
  const node = state.nodes.find((row) => row.id === nodeId);
  const folderRel = node ? toPosixRel(node.folderRel) : '';
  const nextRel = moveRelIntoFolder(fileRel, folderRel);
  return {
    ...state,
    tokens: [...state.tokens, { id: tokenId, fileRel: nextRel, nodeId }],
  };
}

export function f3RemoveToken(state: WorkshopFrontHallBoardState, tokenId: string): WorkshopFrontHallBoardState {
  return {
    ...state,
    nodes: state.nodes.slice(),
    tokens: state.tokens.filter((token) => token.id !== tokenId),
  };
}

export function dragTokenToNode(
  state: WorkshopFrontHallBoardState,
  tokenId: string,
  targetNodeId: string,
): WorkshopFrontHallBoardState {
  const target = state.nodes.find((row) => row.id === targetNodeId);
  if (!target) return state;
  const folderRel = toPosixRel(target.folderRel);
  return {
    ...state,
    tokens: state.tokens.map((token) => {
      if (token.id !== tokenId) return token;
      return {
        ...token,
        nodeId: targetNodeId,
        fileRel: moveRelIntoFolder(token.fileRel, folderRel),
      };
    }),
  };
}

export function listingFromTokens(
  root: string,
  currentFolderRel: string,
  tokens: WorkshopFrontHallToken[],
): WorkshopFrontHallListingItem[] {
  const folder = toPosixRel(currentFolderRel);
  return tokens
    .filter((token) => tokenFileFolderRel(token.fileRel) === folder)
    .map((token) => ({
      root,
      rel: toPosixRel(token.fileRel),
      name: basenameRel(token.fileRel),
    }));
}

export function nodesNeedingHydrate(allNodeIds: string[], visibleNodeIds: Iterable<string>): string[] {
  const visible = new Set([...visibleNodeIds]);
  return allNodeIds.filter((id) => visible.has(id));
}

export function workshopFrontHallMetaUrlIsPersistable(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^(data:|blob:|ac-workshop:)/i.test(raw)) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.replace(/^\[|\]$/g, '');
      if (/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) return false;
      return true;
    } catch {
      return false;
    }
  }
  if (raw.startsWith('//')) return false;
  return true;
}

export function workshopKindPluginIsPaintOnly(reg: WorkshopKindPluginRegistration): boolean {
  if (!reg || typeof reg !== 'object') return false;
  if (reg.ownsFileBytes === true) return false;
  const kind = String(reg.kind || '').trim();
  const hydrate = String(reg.hydrate || '').trim();
  const card = String(reg.card || '').trim();
  const focus = String(reg.focus || '').trim();
  if (!kind || !hydrate || !card || !focus) return false;
  if (!Array.isArray(reg.extensions) || !Array.isArray(reg.previewable)) return false;
  return true;
}

export function assertWorkshopKindPluginPaintOnly(reg: WorkshopKindPluginRegistration): void {
  if (!workshopKindPluginIsPaintOnly(reg)) {
    throw new Error('workshop kind plugin may only declare how to paint; it cannot own file bytes');
  }
}
