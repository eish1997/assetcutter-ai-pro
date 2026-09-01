'use strict';

const DEFAULT_MAX = 30;

function summarizeArgs(args) {
  if (args == null) return {};
  if (typeof args !== 'object') return { value: String(args).slice(0, 200) };
  try {
    const json = JSON.stringify(args);
    if (json.length <= 800) return JSON.parse(json);
    return { truncated: true };
  } catch {
    return {};
  }
}

function createReplayTraceRing(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const max = Number.isFinite(Number(o.max)) && Number(o.max) > 0 ? Math.floor(Number(o.max)) : DEFAULT_MAX;
  const items = [];

  function append(entry) {
    const row = entry && typeof entry === 'object' ? entry : {};
    const tool = String(row.tool || '').trim();
    if (!tool) return items.length;
    items.push({
      at: row.at ? String(row.at) : new Date().toISOString(),
      tool,
      args: summarizeArgs(row.args),
    });
    while (items.length > max) items.shift();
    return items.length;
  }

  function list() {
    return items.slice();
  }

  return { append, list, max };
}

module.exports = {
  createReplayTraceRing,
  summarizeArgs,
  DEFAULT_MAX,
};
