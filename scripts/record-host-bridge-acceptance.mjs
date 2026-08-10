import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function usage() {
  console.log(`Usage:
  npm run host-bridges:acceptance:record -- <host-id> --ok --message "real software probe passed"
  npm run host-bridges:acceptance:record -- <host-id> --fail --message "why it failed"

Examples:
  npm run host-bridges:acceptance:record -- maya --ok --message "Maya 2025 command port connected after restart"
  npm run host-bridges:acceptance:record -- photoshop --ok --message "Photoshop 2025 heartbeat connected after running JSX"
`);
}

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

function parseArgs(argv) {
  const args = [...argv];
  const hostId = args.shift();
  if (!hostId || hostId.startsWith('-')) return null;
  let ok = null;
  let message = '';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--ok') ok = true;
    else if (arg === '--fail') ok = false;
    else if (arg === '--message') {
      message = String(args[i + 1] || '');
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (ok === null) throw new Error('expected --ok or --fail');
  if (!message.trim()) throw new Error('expected --message with real acceptance evidence');
  return { hostId, ok, message };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  usage();
  process.exit(1);
}

const baseUrl = process.env.ASSETCUTTER_COMPANION_URL || 'http://127.0.0.1:18765';
const token = process.env.ASSETCUTTER_COMPANION_TOKEN || readPairingToken();
const res = await fetch(`${baseUrl}/v1/bridges/${encodeURIComponent(parsed.hostId)}/acceptance`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    ok: parsed.ok,
    message: parsed.message,
  }),
});

if (!res.ok) {
  throw new Error(`/v1/bridges/${parsed.hostId}/acceptance returned HTTP ${res.status}`);
}

const payload = await res.json();
console.log(JSON.stringify(payload.acceptance || payload, null, 2));
