#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function validateCodexAuthEnv(env) {
  const base64 = String(env.CODEX_SHARED_AUTH_JSON_BASE64 || '').trim();
  const json = String(env.CODEX_SHARED_AUTH_JSON || '').trim();
  if (!base64 && !json) throw new Error('Missing CODEX_SHARED_AUTH_JSON_BASE64 or CODEX_SHARED_AUTH_JSON');
  let value = base64 ? Buffer.from(base64, 'base64').toString('utf8') : json;
  value = JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex auth JSON must be an object');
  }
  return {
    mode: base64 ? 'base64' : 'json',
    topLevelKeys: Object.keys(value).sort(),
  };
}

function buildRenderEnvVars(env) {
  const out = [];
  const base64 = String(env.CODEX_SHARED_AUTH_JSON_BASE64 || '').trim();
  const json = String(env.CODEX_SHARED_AUTH_JSON || '').trim();
  const updatedAt = String(env.CODEX_SHARED_AUTH_UPDATED_AT || '').trim();
  if (base64) out.push({ key: 'CODEX_SHARED_AUTH_JSON_BASE64', value: base64 });
  if (!base64 && json) out.push({ key: 'CODEX_SHARED_AUTH_JSON', value: json });
  if (updatedAt) out.push({ key: 'CODEX_SHARED_AUTH_UPDATED_AT', value: updatedAt });
  return out;
}

function renderRequest(apiBase, apiKey, method, requestPath, body = null) {
  return new Promise((resolve) => {
    const url = new URL(requestPath, apiBase);
    const client = url.protocol === 'https:' ? https : http;
    const data = body == null ? '' : JSON.stringify(body);
    const req = client.request(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text,
          json,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ ok: false, status: 0, text: error.message, json: null }));
    if (data) req.write(data);
    req.end();
  });
}

function serviceFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.service && typeof item.service === 'object') return item.service;
  return item;
}

function findServiceByNamePayload(payload, serviceName) {
  const wanted = String(serviceName || '').trim();
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload && payload.services)
      ? payload.services
      : Array.isArray(payload && payload.data)
        ? payload.data
        : [];
  for (const item of list) {
    const service = serviceFromItem(item);
    if (!service || typeof service !== 'object') continue;
    if (String(service.name || '').trim() === wanted) return service;
  }
  return null;
}

function deployFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.deploy && typeof payload.deploy === 'object') return payload.deploy;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return deployFromPayload(payload.data);
  return payload;
}

function deployStatus(payload) {
  const deploy = deployFromPayload(payload);
  return String(deploy.status || deploy.deployStatus || deploy.state || '').trim().toLowerCase();
}

function deployIdFromPayload(payload) {
  const deploy = deployFromPayload(payload);
  return String(deploy.id || deploy.deployId || '').trim();
}

function isDeployReadyStatus(status) {
  return status === 'live' || status === 'succeeded' || status === 'success';
}

function isDeployFailedStatus(status) {
  return status === 'failed' ||
    status === 'build_failed' ||
    status === 'update_failed' ||
    status === 'canceled' ||
    status === 'cancelled';
}

async function waitForRenderDeploy({ apiBase, apiKey, serviceId, deployId, timeoutMs, intervalMs }) {
  const startedAt = Date.now();
  let last = { ok: false, status: 0, deployStatus: 'unknown' };
  while (Date.now() - startedAt < timeoutMs) {
    const response = await renderRequest(
      apiBase,
      apiKey,
      'GET',
      `/v1/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
    );
    const status = response.ok ? deployStatus(response.json) : '';
    last = { ok: response.ok, status: response.status, deployStatus: status || 'unknown' };
    if (response.ok && isDeployReadyStatus(status)) return { ...last, ok: true };
    if (response.ok && isDeployFailedStatus(status)) return { ...last, ok: false };
    await delay(intervalMs);
  }
  return { ...last, ok: false, timedOut: true };
}

async function resolveServiceId({ apiBase, apiKey, serviceId, serviceName }) {
  if (serviceId) return serviceId;
  const name = String(serviceName || '').trim();
  if (!name) throw new Error('Missing Render service id or service name');
  const response = await renderRequest(apiBase, apiKey, 'GET', `/v1/services?name=${encodeURIComponent(name)}&limit=20`);
  if (!response.ok) throw new Error(`Render service lookup failed: HTTP ${response.status} ${response.text.slice(0, 300)}`);
  const service = findServiceByNamePayload(response.json, name);
  if (!service || !service.id) throw new Error(`Render service not found by name: ${name}`);
  return String(service.id);
}

async function main() {
  const apply = hasFlag('--apply');
  const deploy = hasFlag('--deploy');
  const waitDeploy = hasFlag('--wait-deploy');
  const json = hasFlag('--json');
  const envFile = path.resolve(readArg('--env-file', '.env.codex-shared-auth.local'));
  const apiBase = String(readArg('--api-base', process.env.RENDER_API_BASE || 'https://api.render.com')).replace(/\/+$/, '');
  const apiKey = readArg('--api-key', process.env.RENDER_API_KEY || '');
  const serviceIdArg = readArg('--service-id', process.env.RENDER_AUTH_API_SERVICE_ID || '');
  const serviceName = readArg('--service-name', process.env.RENDER_AUTH_API_SERVICE_NAME || 'assetcutter-auth-api');
  const deployWaitTimeoutMs = Math.max(1000, Number(readArg('--deploy-timeout-ms', '900000')) || 900000);
  const deployWaitIntervalMs = Math.max(1000, Number(readArg('--deploy-poll-ms', '10000')) || 10000);

  const env = parseEnvFile(envFile);
  const validation = validateCodexAuthEnv(env);
  const vars = buildRenderEnvVars(env);
  if (!vars.length) throw new Error('No Render env vars to apply');

  const summary = {
    ok: true,
    dryRun: !apply,
    deployRequested: deploy,
    waitDeploy,
    apiBase,
    envFile,
    serviceName: serviceIdArg ? '' : serviceName,
    serviceId: serviceIdArg || '',
    authMode: validation.mode,
    topLevelKeys: validation.topLevelKeys,
    envVarKeys: vars.map((item) => item.key),
    applied: [],
    deploy: null,
  };

  if (!apply) {
    if (json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log('Codex Render shared auth env apply');
      console.log('dryRun: true');
      console.log(`envFile: ${envFile}`);
      console.log(`service: ${serviceIdArg || serviceName}`);
      console.log(`authMode: ${validation.mode}`);
      console.log(`topLevelKeys: ${validation.topLevelKeys.join(', ') || '(none)'}`);
      console.log(`envVarKeys: ${summary.envVarKeys.join(', ')}`);
      console.log('No secret values printed. Pass --apply to update Render.');
    }
    return;
  }

  if (!apiKey) throw new Error('Missing RENDER_API_KEY or --api-key');
  const serviceId = await resolveServiceId({ apiBase, apiKey, serviceId: serviceIdArg, serviceName });
  summary.serviceId = serviceId;
  for (const item of vars) {
    const response = await renderRequest(
      apiBase,
      apiKey,
      'PUT',
      `/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(item.key)}`,
      { value: item.value },
    );
    summary.applied.push({ key: item.key, ok: response.ok, status: response.status });
    if (!response.ok) throw new Error(`Render env var update failed for ${item.key}: HTTP ${response.status} ${response.text.slice(0, 300)}`);
  }

  if (deploy) {
    const response = await renderRequest(
      apiBase,
      apiKey,
      'POST',
      `/v1/services/${encodeURIComponent(serviceId)}/deploys`,
      { clearCache: 'do_not_clear' },
    );
    const deployId = response.ok ? deployIdFromPayload(response.json) : '';
    summary.deploy = { ok: response.ok, status: response.status, id: deployId, deployStatus: deployStatus(response.json) || '' };
    if (!response.ok) throw new Error(`Render deploy trigger failed: HTTP ${response.status} ${response.text.slice(0, 300)}`);
    if (waitDeploy) {
      if (!deployId) throw new Error('Render deploy trigger response did not include a deploy id');
      const wait = await waitForRenderDeploy({
        apiBase,
        apiKey,
        serviceId,
        deployId,
        timeoutMs: deployWaitTimeoutMs,
        intervalMs: deployWaitIntervalMs,
      });
      summary.deploy.wait = wait;
      if (!wait.ok) {
        throw new Error(`Render deploy did not become live: ${wait.deployStatus || 'unknown'}${wait.timedOut ? ' (timeout)' : ''}`);
      }
    }
  }

  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log('Codex Render shared auth env apply');
    console.log('dryRun: false');
    console.log(`serviceId: ${serviceId}`);
    for (const item of summary.applied) console.log(`[${item.ok ? 'OK' : 'FAIL'}] ${item.key}: HTTP ${item.status}`);
    if (summary.deploy) console.log(`[${summary.deploy.ok ? 'OK' : 'FAIL'}] deploy: HTTP ${summary.deploy.status}`);
    if (summary.deploy && summary.deploy.wait) {
      console.log(`[${summary.deploy.wait.ok ? 'OK' : 'FAIL'}] deploy wait: ${summary.deploy.wait.deployStatus}`);
    }
    if (!summary.deploy) console.log('Env vars updated. Trigger a Render deploy before strict production verification.');
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
