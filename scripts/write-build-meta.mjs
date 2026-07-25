#!/usr/bin/env node
/**
 * C11 — write web static /healthz (+ .json) before vite build.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIdentityFields } from '../shared/buildSha.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const payload = {
  ok: true,
  ...buildIdentityFields('web'),
  writtenAt: new Date().toISOString(),
};

fs.mkdirSync(PUBLIC, { recursive: true });
const body = `${JSON.stringify(payload, null, 2)}\n`;
fs.writeFileSync(path.join(PUBLIC, 'healthz.json'), body, 'utf8');
fs.writeFileSync(path.join(PUBLIC, 'healthz'), body, 'utf8');
console.log(`[write-build-meta] web buildSha=${payload.buildSha}`);
