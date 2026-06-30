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

module.exports = { fetchWithPartition, classifyAgentHttpStatus };
