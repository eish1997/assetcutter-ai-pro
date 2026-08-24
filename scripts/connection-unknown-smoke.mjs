import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const base = String(process.env.COMPANION_BASE_URL || 'http://127.0.0.1:18765').replace(/\/$/, '');
const id = String(process.env.CONNECTION_UNKNOWN_SMOKE_ID || 'codex-smoke-unknown-app').trim();
const keep = process.argv.includes('--keep') || process.env.CONNECTION_UNKNOWN_SMOKE_KEEP === '1';

function localAppData() {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
}

function readPairingToken() {
  const explicit = String(process.env.COMPANION_SHARED_TOKEN || '').trim();
  if (explicit) return explicit;
  const path = join(localAppData(), 'AssetCutterCompanion', 'sandbox', 'desktop-shell', 'pairing-config.json');
  if (!existsSync(path)) return '';
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    for (const key of ['sharedToken', 'token', 'password', 'secret']) {
      const value = String(cfg?.[key] || '').trim();
      if (value) return value;
    }
  } catch {
    return '';
  }
  return '';
}

const token = readPairingToken();

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function deleteDraft() {
  try {
    await api(`/v1/capability-packages/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // The smoke draft may not exist yet.
  }
}

async function main() {
  console.log(`[connection-unknown-smoke] base=${base}`);
  if (!token) {
    console.log('[connection-unknown-smoke] no pairing token found; trying open dev mode request.');
  }
  await api('/v1/health');
  await deleteDraft();

  const created = await api('/v1/capability-packages/drafts', {
    method: 'POST',
    body: JSON.stringify({
      id,
      type: 'software_connection',
      name: 'Codex Smoke Unknown App',
      appName: 'Codex Smoke Unknown App',
      createdBy: 'connection-unknown-smoke',
      manifest: {
        droppedFrom: 'connection_page',
        inputPath: 'C:/Smoke/CodexSmokeApp.exe',
        executablePath: 'C:/Smoke/CodexSmokeApp.exe',
        exeName: 'CodexSmokeApp.exe',
      },
    }),
  });
  assert(created.ok === true, 'draft creation did not return ok=true');

  const context = await api(`/v1/capability-packages/${encodeURIComponent(id)}/context`);
  const drafts = await api('/v1/capability-packages/drafts');
  const card = (Array.isArray(drafts.drafts) ? drafts.drafts : []).find((item) => item?.id === id);
  const strategyDraft = context.strategyDraft || {};
  const candidateStrategies = Array.isArray(strategyDraft.candidateStrategies) ? strategyDraft.candidateStrategies : [];

  assert(context.ok === true, 'context did not return ok=true');
  assert(context.connectionState?.maturity === 'exploring' || context.connectionState?.maturity === 'strategy_draft', 'unknown app did not enter exploring/strategy_draft state');
  assert(Boolean(context.connectionState?.facts), 'connectionState.facts missing');
  assert(Boolean(context.strategyDraft), 'structured strategyDraft missing from context');
  assert(candidateStrategies.length > 0, 'strategyDraft.candidateStrategies is empty');
  assert(Boolean(card?.connectionState), 'draft list card connectionState missing');

  console.log(JSON.stringify({
    ok: true,
    id,
    maturity: context.connectionState.maturity,
    hasFacts: Boolean(context.connectionState.facts),
    candidateCount: candidateStrategies.length,
    recommendedStrategy: strategyDraft.recommendedNextStrategy?.id || null,
    cardMaturity: card.connectionState.maturity,
  }, null, 2));

  if (!keep) {
    await deleteDraft();
    console.log('[connection-unknown-smoke] temporary draft deleted');
  } else {
    console.log('[connection-unknown-smoke] temporary draft kept because --keep was set');
  }
}

main().catch(async (error) => {
  if (!keep) await deleteDraft();
  console.error(`[connection-unknown-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
