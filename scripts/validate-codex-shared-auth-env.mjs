#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback = '') {
  const argv = process.argv.slice(2);
  const prefix = `${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !String(argv[index + 1]).startsWith('--')) {
    return argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function parseEnvFile(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseCodexAuthJsonValue(value) {
  let raw = value;
  if (raw && typeof raw === 'object' && raw.authJsonBase64) {
    raw = Buffer.from(String(raw.authJsonBase64), 'base64').toString('utf8');
  } else if (raw && typeof raw === 'object' && raw.authJson != null) {
    raw = raw.authJson;
  }
  if (typeof raw === 'string') raw = JSON.parse(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Codex auth JSON must be an object');
  }
  return raw;
}

function validateSource(env) {
  const base64 = String(env.CODEX_SHARED_AUTH_JSON_BASE64 || '').trim();
  const json = String(env.CODEX_SHARED_AUTH_JSON || '').trim();
  if (!base64 && !json) {
    return { ok: false, error: 'Missing CODEX_SHARED_AUTH_JSON_BASE64 or CODEX_SHARED_AUTH_JSON' };
  }
  try {
    const value = base64 ? { authJsonBase64: base64 } : { authJson: json };
    const parsed = parseCodexAuthJsonValue(value);
    return {
      ok: true,
      mode: base64 ? 'base64' : 'json',
      topLevelKeys: Object.keys(parsed).sort(),
      updatedAt: String(env.CODEX_SHARED_AUTH_UPDATED_AT || '').trim() || null,
    };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

function main() {
  const json = hasFlag('--json');
  const envFile = readArg('--env-file', '');
  const source = envFile ? parseEnvFile(path.resolve(envFile)) : process.env;
  const result = validateSource(source);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('Codex shared auth env is valid');
    console.log(`mode: ${result.mode}`);
    console.log(`topLevelKeys: ${result.topLevelKeys.join(', ') || '(none)'}`);
    if (result.updatedAt) console.log(`updatedAt: ${result.updatedAt}`);
  } else {
    console.error(`Codex shared auth env is invalid: ${result.error}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
