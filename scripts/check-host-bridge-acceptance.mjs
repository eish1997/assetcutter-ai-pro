import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function pairingConfigPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return '';
  const sandbox = join(localAppData, 'AssetCutterCompanion', 'sandbox', 'desktop-shell', 'pairing-config.json');
  if (existsSync(sandbox)) return sandbox;
  const stable = join(localAppData, 'AssetCutterCompanion', 'desktop-shell', 'pairing-config.json');
  if (existsSync(stable)) return stable;
  return '';
}

function readPairingToken() {
  const p = pairingConfigPath();
  if (!p) throw new Error('pairing config not found; start the local companion first');
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  if (!parsed?.sharedToken) throw new Error('pairing config does not include sharedToken');
  return String(parsed.sharedToken);
}

const baseUrl = process.env.ASSETCUTTER_COMPANION_URL || 'http://127.0.0.1:18765';
const token = process.env.ASSETCUTTER_COMPANION_TOKEN || readPairingToken();
const res = await fetch(`${baseUrl}/v1/bridges`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  throw new Error(`/v1/bridges returned HTTP ${res.status}`);
}

const payload = await res.json();
const bridges = Array.isArray(payload.bridges) ? payload.bridges : [];
const summary = payload.acceptanceSummary;
const planned = bridges.filter((bridge) => bridge.status === 'planned' || bridge.installMode === 'planned');
const ready = bridges.filter((bridge) => bridge.status === 'ready');
const oneClick = bridges.filter((bridge) => bridge.installMode === 'one_click');

console.log(`Host bridges: ${bridges.length}`);
console.log(`Ready: ${ready.length}`);
console.log(`One-click: ${oneClick.length}`);
console.log(`Planned: ${planned.length}`);

if (!summary) {
  console.error('Missing acceptanceSummary from /v1/bridges.');
  process.exit(1);
}

console.log(`Acceptance groups: ${summary.acceptedGroups}/${summary.requiredGroups}`);
for (const group of summary.groups || []) {
  const state = group.ok ? 'OK' : 'MISSING';
  const accepted = Array.isArray(group.acceptedHosts) && group.acceptedHosts.length ? group.acceptedHosts.join(', ') : '-';
  console.log(`- ${state} ${group.id}: ${accepted}`);
}

if (bridges.length !== 62 || ready.length !== 62 || oneClick.length !== 62 || planned.length !== 0) {
  console.error('Host bridge runtime catalog gate failed.');
  process.exit(1);
}

if (!summary.ok) {
  console.error('Host bridge real-software acceptance gate failed.');
  process.exit(1);
}

console.log('Host bridge acceptance gate passed.');
