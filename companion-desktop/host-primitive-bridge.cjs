'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function createHostPrimitiveBridge(deps = {}) {
  const request =
    typeof deps.companionApiRequest === 'function'
      ? deps.companionApiRequest
      : async () => ({ ok: false, error: 'companion_unavailable' });

  async function listHostPrimitives(draftId) {
    const id = String(draftId || '').trim();
    if (!id) return { ok: false, error: 'missing_draft_id' };
    const r = await request('GET', `/v1/capability-packages/${encodeURIComponent(id)}/host-primitives`, null, {
      timeoutMs: 12000,
    });
    const body = (r && r.json) || {};
    if (!r || !r.ok) {
      return { ok: false, error: String(body.error || (r && r.text) || 'list_failed'), draftId: id };
    }
    return { ok: true, draftId: id, ...body };
  }

  async function probeHostPrimitive(draftId, primitiveId, opts = {}) {
    const id = String(draftId || '').trim();
    const primitive = String(primitiveId || '').trim();
    if (!id || !primitive) return { ok: false, error: 'missing_target' };
    const r = await request(
      'POST',
      `/v1/capability-packages/${encodeURIComponent(id)}/host-primitives/${encodeURIComponent(primitive)}/probe`,
      {
        localVersionId: opts.localVersionId,
        confirmed: opts.confirmed === true,
      },
      { timeoutMs: 60000 },
    );
    const body = (r && r.json) || {};
    if (!r || !r.ok) {
      return {
        ok: false,
        error: String(body.error || body.message || (r && r.text) || 'probe_failed'),
        draftId: id,
        primitiveId: primitive,
      };
    }
    return { ok: true, draftId: id, primitiveId: primitive, result: body };
  }

  async function invokeHostPrimitive(draftId, primitiveId, params, opts = {}) {
    const id = String(draftId || '').trim();
    const primitive = String(primitiveId || 'host.import_file').trim();
    if (!id) return { ok: false, error: 'missing_draft_id' };
    const r = await request(
      'POST',
      `/v1/capability-packages/${encodeURIComponent(id)}/host-primitives/invoke`,
      {
        primitiveId: primitive,
        params: params && typeof params === 'object' ? params : {},
        localVersionId: opts.localVersionId,
      },
      { timeoutMs: 120000 },
    );
    const body = (r && r.json) || {};
    if (!r || !r.ok) {
      return {
        ok: false,
        error: String(body.error || body.message || (r && r.text) || 'invoke_failed'),
        draftId: id,
        primitiveId: primitive,
      };
    }
    return { ok: true, draftId: id, primitiveId: primitive, result: body.result || body };
  }

  async function healthCheckHostPrimitives(body) {
    const payload = body && typeof body === 'object' ? body : {};
    if (payload.confirmed !== true) {
      return { ok: false, error: 'confirmation_required' };
    }
    const r = await request('POST', '/v1/host-primitives/health-check', payload, { timeoutMs: 120000 });
    const json = (r && r.json) || {};
    if (!r || !r.ok) {
      return { ok: false, error: String(json.error || json.message || (r && r.text) || 'health_check_failed') };
    }
    return { ok: true, ...json };
  }

  async function listHealthPending() {
    const r = await request('GET', '/v1/host-primitives/health-pending', null, { timeoutMs: 12000 });
    const body = (r && r.json) || {};
    if (!r || !r.ok) return { ok: false, error: 'health_pending_failed' };
    return { ok: true, pending: asArray(body.pending) };
  }

  return {
    listHostPrimitives,
    probeHostPrimitive,
    invokeHostPrimitive,
    healthCheckHostPrimitives,
    listHealthPending,
  };
}

module.exports = {
  createHostPrimitiveBridge,
};
