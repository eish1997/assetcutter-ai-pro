#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readArg(name, fallback = '') {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function defaultCodexAuthPath() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(home, 'auth.json');
}

function repoRoot() {
  return process.cwd();
}

function shellQuoteSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const input = path.resolve(readArg('--input', defaultCodexAuthPath()));
  const out = path.resolve(readArg('--out', path.join(repoRoot(), '.env.codex-shared-auth.local')));
  const printSecret = hasFlag('--print-secret');
  const printPowershell = hasFlag('--print-powershell');

  if (!fs.existsSync(input)) {
    throw new Error(`Codex auth file not found: ${input}`);
  }
  const raw = fs.readFileSync(input, 'utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Codex auth file is not valid JSON: ${error && error.message ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Codex auth file must be a JSON object');
  }
  const normalized = JSON.stringify(parsed);
  const base64 = Buffer.from(normalized, 'utf8').toString('base64');
  const updatedAt = new Date().toISOString();
  const body = [
    '# Generated locally. Do not commit.',
    '# Paste these into the Render auth-api service environment.',
    `CODEX_SHARED_AUTH_JSON_BASE64=${base64}`,
    `CODEX_SHARED_AUTH_UPDATED_AT=${updatedAt}`,
    '',
  ].join('\n');

  fs.writeFileSync(out, body, { encoding: 'utf8', mode: 0o600 });
  console.log('Codex shared auth env exported');
  console.log(`input: ${input}`);
  console.log(`output: ${out}`);
  console.log(`CODEX_SHARED_AUTH_JSON_BASE64 length: ${base64.length}`);
  console.log(`CODEX_SHARED_AUTH_UPDATED_AT: ${updatedAt}`);
  if (printPowershell) {
    console.log('');
    console.log('PowerShell for current terminal only:');
    console.log(`$env:CODEX_SHARED_AUTH_JSON_BASE64=${shellQuoteSingle(base64)}`);
    console.log(`$env:CODEX_SHARED_AUTH_UPDATED_AT=${shellQuoteSingle(updatedAt)}`);
  } else if (!printSecret) {
    console.log('Secret value was written to the output file, not printed.');
  }
  if (printSecret) {
    console.log('');
    console.log(`CODEX_SHARED_AUTH_JSON_BASE64=${base64}`);
    console.log(`CODEX_SHARED_AUTH_UPDATED_AT=${updatedAt}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
