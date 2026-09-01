'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function connectionStateFor(pkg) {
  if (pkg && pkg.connectionState && typeof pkg.connectionState === 'object') return pkg.connectionState;
  return {};
}

const KNOWN_HOST_LABELS = {
  maya: 'Maya',
  blender: 'Blender',
  photoshop: 'Photoshop',
  unreal: 'Unreal',
};

function guessHostId(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  if (/\bmaya\b/.test(n) || n === 'maya') return 'maya';
  if (/\bblender\b/.test(n)) return 'blender';
  if (/\bphotoshop\b/.test(n) || n === 'ps') return 'photoshop';
  if (/\bunreal\b/.test(n) || /\bue\s*[45]\b/.test(n)) return 'unreal';
  return '';
}

function inferKnownHostHint(input) {
  const body = input && typeof input === 'object' ? input : {};
  const hostId = guessHostId(body.hostId) || guessHostId(body.name) || guessHostId(body.replayId) || guessHostId(body.title);
  if (!hostId) return null;
  const rawName = String(body.name || body.title || '').trim();
  const name = rawName && guessHostId(rawName) === hostId ? (KNOWN_HOST_LABELS[hostId] || rawName) : KNOWN_HOST_LABELS[hostId] || hostId;
  return { hostId, name };
}

function samePlace(pkg, name, hostId) {
  const id = String(pkg && pkg.id || '').trim().toLowerCase();
  const label = String(pkg && (pkg.name || pkg.title) || '').trim().toLowerCase();
  const wanted = String(name || '').trim().toLowerCase();
  if (hostId && id === String(hostId).toLowerCase()) return true;
  return Boolean(wanted) && (id === wanted || label === wanted);
}

function summarizeDraft(pkg) {
  if (!pkg || typeof pkg !== 'object') return null;
  const state = connectionStateFor(pkg);
  return {
    id: String(pkg.id || '').trim(),
    name: String(pkg.name || pkg.title || pkg.id || '').trim(),
    type: String(pkg.type || '').trim(),
    maturity: String(state.maturity || pkg.maturity || '').trim(),
    label: String(state.label || '').trim(),
    blockedReason: String(state.blockedReason || '').trim(),
    nextAction: String(state.nextAction || '').trim(),
  };
}

function createConnectionPackageBridge(deps = {}) {
  const request =
    typeof deps.companionApiRequest === 'function'
      ? deps.companionApiRequest
      : async () => ({ ok: false, error: 'companion_unavailable' });

  async function fetchSoftwareConnectionDrafts() {
    const r = await request('GET', '/v1/capability-packages/drafts', null, { timeoutMs: 8000 });
    const drafts = r && r.ok && r.json && Array.isArray(r.json.drafts) ? r.json.drafts : [];
    return drafts.filter((d) => d && String(d.type || '') === 'software_connection');
  }

  async function listDrafts() {
    const drafts = await fetchSoftwareConnectionDrafts();
    return { ok: true, drafts: drafts.map(summarizeDraft).filter(Boolean) };
  }

  async function probeDraft(draftId) {
    const id = String(draftId || '').trim();
    if (!id) return { ok: false, error: 'missing_draft_id' };
    const r = await request('POST', `/v1/capability-packages/${encodeURIComponent(id)}/probe`, null, {
      timeoutMs: 60000,
    });
    const body = (r && r.json) || {};
    if (!r || !r.ok) {
      return {
        ok: false,
        error: String(body.error || body.message || (r && r.text) || 'probe_failed'),
        draftId: id,
      };
    }
    return { ok: true, draftId: id, result: body };
  }

  async function createDraft(input) {
    const body = input && typeof input === 'object' ? input : {};
    const name = String(body.name || body.appName || '').trim();
    if (!name) return { ok: false, error: 'place_name_required' };
    const hostId = String(body.hostId || guessHostId(name)).trim();
    const existing = await fetchSoftwareConnectionDrafts();
    const found = existing.find((pkg) => samePlace(pkg, name, hostId));
    if (found) {
      return { ok: true, already: true, draft: summarizeDraft(found) };
    }
    const r = await request(
      'POST',
      '/v1/capability-packages/drafts',
      {
        type: 'software_connection',
        name,
        appName: name,
        description: String(body.description || `地图地点：${name}`).trim(),
        tags: ['本机软件', '管家创建'],
        templateHint: hostId ? 'conversation_known_host' : 'conversation_unknown_host',
        createdBy: 'dsh',
        manifest: hostId ? { hostId } : {},
      },
      { timeoutMs: 15000 },
    );
    const json = r && r.json && typeof r.json === 'object' ? r.json : {};
    if (!r || !r.ok || !json.ok || !json.draft) {
      return {
        ok: false,
        error: String(json.error || json.message || (r && r.text) || 'create_failed'),
      };
    }
    return { ok: true, already: false, draft: summarizeDraft(json.draft) };
  }

  async function discoverRunning() {
    const drafts = await fetchSoftwareConnectionDrafts();
    const candidates = drafts.filter((pkg) =>
      asArray(connectionStateFor(pkg).availableActions).includes('discover_running'),
    );
    if (!candidates.length) {
      return { ok: true, discovered: 0, failed: 0, message: 'no_discover_candidates' };
    }
    let discovered = 0;
    let failed = 0;
    const results = [];
    for (const pkg of candidates) {
      const id = String(pkg.id || '').trim();
      const r = await request(
        'POST',
        `/v1/capability-packages/${encodeURIComponent(id)}/lifecycle`,
        { action: 'discover_running' },
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      if (r && r.ok) {
        discovered += 1;
        results.push({ id, ok: true, message: body.message || '' });
      } else {
        failed += 1;
        results.push({
          id,
          ok: false,
          error: String(body.error || body.message || (r && r.text) || 'discover_failed'),
        });
      }
    }
    return { ok: true, discovered, failed, results };
  }

  return {
    listDrafts,
    createDraft,
    probeDraft,
    discoverRunning,
  };
}

module.exports = {
  createConnectionPackageBridge,
  summarizeDraft,
  guessHostId,
  inferKnownHostHint,
  KNOWN_HOST_LABELS,
};
