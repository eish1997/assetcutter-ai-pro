#!/usr/bin/env node
/**
 * R4.3: Guard AI Gateway public job contract + block new provider-specific
 * artifact URL assembly in workbench main restore/execution facades.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();

/** Main-path facades that must consume job.artifacts, not assemble URLs by provider. */
const SCAN_FILES = [
  'services/aiJobArtifacts.ts',
  'services/aiGatewayImageExecution.ts',
  'services/aiGatewayVideoExecution.ts',
  'services/generation/runUnifiedGeneration.ts',
];

/**
 * Forbid patterns like: if (provider === '302ai') … url =
 * Allowlisted files may keep domain-specific download/CORS helpers outside this list.
 */
const FORBIDDEN_PROVIDER_URL_RE =
  /if\s*\(\s*(?:params\.)?provider\s*===\s*['"][^'"]+['"]\s*\)[\s\S]{0,160}\b(?:url|href|src)\s*=/i;

function fail(message) {
  console.error(`[check-ai-gateway-job-contract] FAIL: ${message}`);
  process.exit(1);
}

async function assertContractExports() {
  const mod = await import(pathToFileURL(path.join(repoRoot, 'server/ai-gateway/job-public-contract.js')).href);
  const CONTRACT_FIELDS = mod.AI_GATEWAY_PUBLIC_JOB_CONTRACT_FIELDS;
  const SUPPORTED_MODALITIES = mod.AI_GATEWAY_SUPPORTED_MODALITIES;
  if (!Array.isArray(CONTRACT_FIELDS) || CONTRACT_FIELDS.length < 8) {
    fail('AI_GATEWAY_PUBLIC_JOB_CONTRACT_FIELDS missing or too short');
  }
  for (const required of ['id', 'status', 'routeDecision', 'gatewayFailure', 'observability']) {
    if (!CONTRACT_FIELDS.includes(required)) {
      fail(`public job contract missing required field: ${required}`);
    }
  }
  if (!Array.isArray(SUPPORTED_MODALITIES) || !SUPPORTED_MODALITIES.includes('image')) {
    fail('AI_GATEWAY_SUPPORTED_MODALITIES must include image');
  }
  if (SUPPORTED_MODALITIES.includes('music')) {
    fail('AI_GATEWAY_SUPPORTED_MODALITIES must not advertise music (worker removed)');
  }
  return { CONTRACT_FIELDS, SUPPORTED_MODALITIES };
}

function scanProviderUrlAssembly() {
  const hits = [];
  for (const rel of SCAN_FILES) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      fail(`expected scan file missing: ${rel}`);
    }
    const text = fs.readFileSync(abs, 'utf8');
    if (FORBIDDEN_PROVIDER_URL_RE.test(text)) {
      hits.push(rel);
    }
  }
  if (hits.length) {
    fail(
      `provider-specific artifact URL assembly in main path:\n  - ${hits.join('\n  - ')}\n` +
        'Prefer job.artifacts[] / extractRestorableAiJobArtifacts.'
    );
  }
}

async function main() {
  const { CONTRACT_FIELDS, SUPPORTED_MODALITIES } = await assertContractExports();
  scanProviderUrlAssembly();
  console.log(
    `[check-ai-gateway-job-contract] ok fields=${CONTRACT_FIELDS.length} modalities=${SUPPORTED_MODALITIES.join(',')}`
  );
}

main().catch((err) => {
  console.error('[check-ai-gateway-job-contract]', err instanceof Error ? err.message : err);
  process.exit(1);
});
