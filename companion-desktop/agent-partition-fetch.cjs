'use strict';

const { session } = require('electron');

/**
 * 使用 Electron partition session 发起 fetch（P1a：携带 BrowserView Cookie）。
 * @param {string} partition
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchWithPartition(partition, url, init) {
  const ses = session.fromPartition(String(partition || ''));
  if (typeof ses.fetch !== 'function') {
    throw new Error('session.fetch unavailable');
  }
  const res = await ses.fetch(url, init || {});
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    text,
  };
}

async function inspectPartitionSession(partition, url) {
  const out = {
    partition: String(partition || ''),
    origin: '',
    cookieCount: 0,
    cookieNames: [],
    hasLikelyAuthCookie: false,
    error: null,
  };
  try {
    out.origin = new URL(String(url || '')).origin;
  } catch {
    out.error = 'invalid_url';
    return out;
  }
  try {
    const ses = session.fromPartition(out.partition);
    const cookies = await ses.cookies.get({ url: out.origin });
    const names = Array.isArray(cookies)
      ? cookies.map((c) => String(c && c.name ? c.name : '')).filter(Boolean)
      : [];
    const authLike = /(^|[_-])(auth|session|token|jwt|access|refresh|sid)([_-]|$)|next-auth|supabase|sb-/i;
    out.cookieCount = names.length;
    out.cookieNames = names.slice(0, 20);
    out.hasLikelyAuthCookie = names.some((name) => authLike.test(name));
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/**
 * @param {number} status
 * @param {{ error?: string; code?: string } | null} [json]
 */
function classifyAgentHttpStatus(status, json) {
  if (status === 401) {
    return { error: 'AGENT_AUTH_REQUIRED', authRequired: true };
  }
  if (status === 403) {
    const hint = json && (json.error || json.code) ? String(json.error || json.code) : '';
    return { error: 'AGENT_FORBIDDEN', forbidden: true, detail: hint || 'forbidden' };
  }
  return {};
}

module.exports = { fetchWithPartition, inspectPartitionSession, classifyAgentHttpStatus };
