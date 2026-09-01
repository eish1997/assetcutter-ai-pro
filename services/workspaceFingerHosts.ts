import type { WorkspaceConnectedHost } from './workspaceDocumentProtocol';

type LocalVersionLike = {
  id?: string;
  label?: string;
  softwareVersion?: string;
  status?: string;
};

export type WorkspaceConnectionDraftLike = {
  id?: string;
  name?: string;
  title?: string;
  type?: string;
  tags?: unknown;
  maturity?: string;
  manifest?: { currentLocalVersionId?: string; defaultLocalVersionId?: string };
  connectionState?: {
    maturity?: string;
    label?: string;
    blockedReason?: string;
    nextAction?: string;
  };
  connectionCardView?: {
    statusLabel?: string;
    name?: string;
    currentLocalVersion?: LocalVersionLike | null;
    localVersions?: LocalVersionLike[];
  };
};

let publishedConnectionDrafts: WorkspaceConnectionDraftLike[] = [];

export function publishWorkspaceConnectionDrafts(drafts: WorkspaceConnectionDraftLike[] | null | undefined) {
  publishedConnectionDrafts = Array.isArray(drafts) ? drafts.slice() : [];
}

export function readPublishedConnectionDrafts(): WorkspaceConnectionDraftLike[] {
  return publishedConnectionDrafts.slice();
}

function isConnectedDraft(draft: WorkspaceConnectionDraftLike | null | undefined): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const maturity = String(draft.connectionState?.maturity || draft.maturity || '').trim();
  if (maturity === 'connected') return true;
  const label = String(draft.connectionState?.label || draft.connectionCardView?.statusLabel || '').trim();
  if (label === '已连接' || label === '已开通') return true;
  const tags = Array.isArray(draft.tags) ? draft.tags.map((t) => String(t || '')) : [];
  return tags.includes('已连接');
}

function versionLabel(version: LocalVersionLike | null | undefined): string {
  return String(version?.softwareVersion || version?.label || '').trim();
}

function sendHostsForDraft(
  draft: WorkspaceConnectionDraftLike,
  base: Omit<WorkspaceConnectedHost, 'sendTitle' | 'localVersionId' | 'softwareVersionLabel'>,
): WorkspaceConnectedHost[] {
  const placeName = String(draft.connectionCardView?.name || draft.title || draft.name || draft.id || '').trim();
  const cardView = draft.connectionCardView;
  const localVersions = Array.isArray(cardView?.localVersions) ? cardView!.localVersions! : [];
  const current =
    cardView?.currentLocalVersion && typeof cardView.currentLocalVersion === 'object'
      ? cardView.currentLocalVersion
      : null;
  const currentId = String(
    draft.manifest?.currentLocalVersionId || draft.manifest?.defaultLocalVersionId || current?.id || '',
  ).trim();
  const currentVersion =
    (currentId ? localVersions.find((item) => String(item?.id || '') === currentId) : null) || current;
  const currentVersionText = versionLabel(currentVersion);
  if (currentVersionText) {
    return [
      {
        ...base,
        title: placeName,
        sendTitle: `${placeName} ${currentVersionText}`,
        localVersionId: String(currentVersion?.id || currentId || '').trim() || undefined,
        softwareVersionLabel: currentVersionText,
      },
    ];
  }
  const verified = localVersions.filter((item) => String(item?.status || '') === 'verified');
  if (verified.length > 1) {
    return verified.map((item) => {
      const label = versionLabel(item) || placeName;
      return {
        ...base,
        title: placeName,
        sendTitle: `${placeName} ${label}`,
        localVersionId: String(item?.id || '').trim() || undefined,
        softwareVersionLabel: label,
      };
    });
  }
  if (verified.length === 1) {
    const label = versionLabel(verified[0]);
    return [
      {
        ...base,
        title: placeName,
        sendTitle: label ? `${placeName} ${label}` : placeName,
        localVersionId: String(verified[0]?.id || '').trim() || undefined,
        softwareVersionLabel: label || undefined,
      },
    ];
  }
  return [{ ...base, title: placeName, sendTitle: placeName }];
}

export function connectedHostsFromDrafts(
  drafts: WorkspaceConnectionDraftLike[] | null | undefined,
  opts: { hasSelectedCard?: boolean; selectedRelPath?: string | null } = {},
): WorkspaceConnectedHost[] {
  const list = Array.isArray(drafts) ? drafts : [];
  const selectedRelPath = String(opts.selectedRelPath || '').trim();
  const hasSelectedCard = opts.hasSelectedCard !== false;
  const hasFile = Boolean(selectedRelPath);
  const canAccept = hasFile || hasSelectedCard;
  const out: WorkspaceConnectedHost[] = [];
  let index = 0;
  for (const draft of list.filter(isConnectedDraft)) {
    const state = draft.connectionState && typeof draft.connectionState === 'object' ? draft.connectionState : {};
    const base = {
      id: String(draft.id || '').trim(),
      title: String(draft.connectionCardView?.name || draft.title || draft.name || draft.id || '').trim(),
      ready: true,
      canAcceptCurrentCard: Boolean(canAccept && hasSelectedCard),
      canAcceptCurrentFile: Boolean(canAccept && (hasFile || hasSelectedCard)),
      maturity: String(state.maturity || draft.maturity || '').trim(),
      blockedReason: String(state.blockedReason || '').trim(),
      isDefault: index === 0,
    };
    if (!base.id) continue;
    const hosts = sendHostsForDraft(draft, base);
    out.push(...hosts);
    index += 1;
  }
  return out;
}
