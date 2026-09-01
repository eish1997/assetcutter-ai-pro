'use strict';

function hostCanAcceptForSend(host) {
  if (!host || !host.ready) return false;
  if (host.canAcceptCurrentFile === true) return true;
  if (host.canAcceptCurrentCard === true) return true;
  return false;
}

function versionLabel(version) {
  if (!version || typeof version !== 'object') return '';
  return String(version.softwareVersion || version.label || '').trim();
}

function sendHostsForDraft(draft, base) {
  const placeName = String(
    (draft.connectionCardView && draft.connectionCardView.name) || draft.title || draft.name || draft.id || '',
  ).trim();
  const cardView = draft.connectionCardView && typeof draft.connectionCardView === 'object' ? draft.connectionCardView : {};
  const localVersions = Array.isArray(cardView.localVersions) ? cardView.localVersions : [];
  const current =
    cardView.currentLocalVersion && typeof cardView.currentLocalVersion === 'object' ? cardView.currentLocalVersion : null;
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const currentId = String(manifest.currentLocalVersionId || manifest.defaultLocalVersionId || (current && current.id) || '').trim();
  const currentVersion =
    (currentId ? localVersions.find((item) => item && String(item.id || '') === currentId) : null) || current;
  const currentVersionText = versionLabel(currentVersion);
  if (currentVersionText) {
    return [
      {
        ...base,
        title: placeName,
        sendTitle: placeName + ' ' + currentVersionText,
        localVersionId: String((currentVersion && currentVersion.id) || currentId || '').trim() || undefined,
        softwareVersionLabel: currentVersionText,
      },
    ];
  }
  const verified = localVersions.filter((item) => item && String(item.status || '') === 'verified');
  if (verified.length > 1) {
    return verified.map((item) => {
      const label = versionLabel(item) || placeName;
      return {
        ...base,
        title: placeName,
        sendTitle: placeName + ' ' + label,
        localVersionId: String(item.id || '').trim() || undefined,
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
        sendTitle: label ? placeName + ' ' + label : placeName,
        localVersionId: String(verified[0].id || '').trim() || undefined,
        softwareVersionLabel: label || undefined,
      },
    ];
  }
  return [{ ...base, title: placeName, sendTitle: placeName }];
}

function connectedHostsFromDrafts(drafts, opts = {}) {
  const list = Array.isArray(drafts) ? drafts : [];
  const selectedRelPath = String(opts.selectedRelPath || '').trim();
  const hasSelectedCard = opts.hasSelectedCard !== false;
  const hasFile = Boolean(selectedRelPath);
  const canAccept = hasFile || hasSelectedCard;
  const connected = list.filter((draft) => {
    if (!draft || typeof draft !== 'object') return false;
    const maturity = String((draft.connectionState && draft.connectionState.maturity) || draft.maturity || '').trim();
    if (maturity === 'connected') return true;
    const label = String(
      (draft.connectionState && draft.connectionState.label) ||
        (draft.connectionCardView && draft.connectionCardView.statusLabel) ||
        '',
    ).trim();
    if (label === '已连接' || label === '已开通') return true;
    const tags = Array.isArray(draft.tags) ? draft.tags.map((t) => String(t || '')) : [];
    return tags.includes('已连接');
  });
  const out = [];
  let index = 0;
  for (const draft of connected) {
    const state = draft.connectionState && typeof draft.connectionState === 'object' ? draft.connectionState : {};
    const base = {
      id: String(draft.id || '').trim(),
      title: String(
        (draft.connectionCardView && draft.connectionCardView.name) ||
          draft.title ||
          draft.name ||
          draft.id ||
          '',
      ).trim(),
      ready: true,
      canAcceptCurrentCard: Boolean(canAccept && hasSelectedCard),
      canAcceptCurrentFile: Boolean(canAccept && (hasFile || hasSelectedCard)),
      maturity: String(state.maturity || draft.maturity || '').trim(),
      blockedReason: String(state.blockedReason || '').trim(),
      isDefault: index === 0,
    };
    if (!base.id) continue;
    out.push(...sendHostsForDraft(draft, base));
    index += 1;
  }
  return out;
}

function pickHostForSend(finger, hostId, localVersionId) {
  const hosts = finger && Array.isArray(finger.connectedHosts) ? finger.connectedHosts : [];
  const ready = hosts.filter((h) => h && h.ready);
  if (!ready.length) return { ok: false, error: 'no_ready_host' };
  const wanted = String(hostId || '').trim();
  const wantedVersion = String(localVersionId || '').trim();
  if (wanted) {
    const hits = ready.filter((h) => h.id === wanted);
    if (!hits.length) return { ok: false, error: 'no_ready_host' };
    const hit = wantedVersion
      ? hits.find((h) => String(h.localVersionId || '') === wantedVersion) || hits[0]
      : hits.length === 1
        ? hits[0]
        : hits.find((h) => h.isDefault) || hits[0];
    if (!hostCanAcceptForSend(hit)) return { ok: false, error: 'host_cannot_accept' };
    return { ok: true, host: hit };
  }
  const accepting = ready.filter((h) => hostCanAcceptForSend(h));
  if (!accepting.length) return { ok: false, error: 'host_cannot_accept' };
  if (accepting.length !== 1) return { ok: false, error: 'multi_ready_host' };
  return { ok: true, host: accepting[0] };
}

function sendHostErrorSuggestSurface(error) {
  if (error === 'no_ready_host' || error === 'multi_ready_host') return 'connections';
  return undefined;
}

module.exports = {
  connectedHostsFromDrafts,
  hostCanAcceptForSend,
  pickHostForSend,
  sendHostErrorSuggestSurface,
};
