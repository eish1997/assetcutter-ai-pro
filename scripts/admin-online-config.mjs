#!/usr/bin/env node

import { fetch } from 'undici';

const DEFAULT_AUTH = 'https://assetcutter-auth-api.onrender.com';
const DEFAULT_ORIGIN = 'https://assetcutter-web.onrender.com';

function usage() {
  console.log(`Admin online config helper

Read-only:
  npm run admin:online-config -- inspect
  npm run admin:online-config -- provider-keys
  npm run admin:online-config -- diagnostics --models gemini-3-flash-preview,gemini-3-pro-image --generation

Mutating commands require --apply:
  $env:PROVIDER_API_KEY='...'; npm run admin:online-config -- provider-key-upsert --provider google-agent-platform --label "Agent Platform primary" --apply
  npm run admin:online-config -- publish-add --models gemini-3-pro-image --apply
  npm run admin:online-config -- publish-remove --models gemini-3-pro-preview --apply
  npm run admin:online-config -- publish-set --models gemini-3-flash-preview,gemini-3-pro-image --apply
  npm run admin:online-config -- pause-provider --provider google-agent-platform --ttl 60 --reason "maintenance" --apply
  npm run admin:online-config -- resume-provider --provider google-agent-platform --apply
  npm run admin:online-config -- pause-model --model gemini-3-pro-image --ttl 60 --reason "maintenance" --apply
  npm run admin:online-config -- resume-model --model gemini-3-pro-image --apply

Required env:
  ADMIN_IDENTIFIER, ADMIN_PASSWORD

Optional env:
  AUTH_API_BASE, ADMIN_ORIGIN, PROVIDER_API_KEY, AGENT_PLATFORM_API_KEY
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      out._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function requireNonEmpty(value, name) {
  const s = String(value || '').trim();
  if (!s) throw new Error(`${name} is required`);
  return s;
}

function commaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function inferDiagnosticModality(canonicalModelId) {
  const id = String(canonicalModelId || '').trim().toLowerCase();
  if (!id) return null;
  if (id.includes('image') || id.includes('seedream') || id.startsWith('dall-e') || id.startsWith('gpt-image')) {
    return 'image';
  }
  if (id.startsWith('gemini-') || id.startsWith('gpt-') || id.startsWith('doubao-') || id.startsWith('o')) {
    return 'text';
  }
  return null;
}

function normalizeProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (
    id === 'google-agent-platform' ||
    id === 'agent-platform' ||
    id === 'gemini-agent-platform' ||
    id === 'vertex-proxy' ||
    id === 'vertex-gemini'
  ) {
    return 'vertex-site';
  }
  return id;
}

function cookieHeaderFromResponse(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return raw
    .map((value) => String(value).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function publicError(res, text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed.message || parsed.error || parsed.code || text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

class OnlineAdminClient {
  constructor({ authBase, origin, identifier, password }) {
    this.authBase = authBase.replace(/\/+$/, '');
    this.origin = origin;
    this.identifier = identifier;
    this.password = password;
    this.cookie = '';
  }

  async login() {
    const res = await fetch(`${this.authBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: this.origin },
      body: JSON.stringify({ identifier: this.identifier, password: this.password }),
    });
    const text = await res.text();
    this.cookie = cookieHeaderFromResponse(res);
    if (!res.ok || !this.cookie.includes('ac_session=')) {
      throw new Error(`Login failed: HTTP ${res.status} ${publicError(res, text)}`);
    }
    const me = await this.request('/api/auth/me');
    return { username: me?.user?.username || me?.username || this.identifier };
  }

  async request(path, init = {}) {
    const res = await fetch(`${this.authBase}${path}`, {
      ...init,
      headers: {
        Origin: this.origin,
        ...(init.headers || {}),
        Cookie: this.cookie,
      },
    });
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text || '{}');
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${publicError(res, text)}`);
    }
    return body;
  }

  get(path) {
    return this.request(path, { method: 'GET' });
  }

  post(path, body) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  put(path, body) {
    return this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
}

function compactInspection({ diagnostics, modelOps, opsControl }) {
  return {
    ok: true,
    stores: diagnostics.stores,
    paused: diagnostics.paused,
    publishedCanonicalModelAllowlist: modelOps.config?.publishedCanonicalModelAllowlist || null,
    opsControl: {
      disabledProviders: opsControl.config?.disabledProviders || [],
      disabledModels: opsControl.config?.disabledModels || [],
      modelOverrides: opsControl.config?.modelOverrides || [],
    },
  };
}

function compactDiagnostics(result) {
  return {
    ok: result.ok,
    layers: result.layers,
    summary: result.summary,
    results: (result.results || []).map((item) => ({
      canonicalModelId: item.canonicalModelId,
      routeStatus: item.route?.status || null,
      routeCode: item.route?.code || null,
      generationStatus: item.generation?.status || null,
      generationCode: item.generation?.code || null,
      generationJobId: item.generation?.jobId || null,
      generationJobStatus: item.generation?.jobStatus || null,
      message: item.generation?.message || item.route?.message || null,
    })),
  };
}

function assertApply(args, command) {
  if (args.apply === true) return;
  throw new Error(`${command} would change online configuration. Re-run with --apply after reviewing the command.`);
}

function keyHasUsableSecret(row) {
  return Boolean(row?.hasSecret || row?.secret || row?.credentials?.apiKey || row?.hasCredentials);
}

function compactProviderKeys(result) {
  return {
    ok: true,
    keys: (result.keys || []).map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      enabled: row.enabled !== false,
      priority: row.priority,
      rpm: row.rpm || 0,
      secretPreview: row.secretPreview || null,
      hasSecret: Boolean(row.hasSecret),
      healthStatus: row.runtime?.healthStatus || null,
      lastSuccessAt: row.runtime?.lastSuccessAt || null,
      lastErrorAt: row.runtime?.lastErrorAt || null,
      lastError: row.runtime?.lastError || null,
    })),
  };
}

async function inspect(client) {
  const [diagnostics, modelOps, opsControl] = await Promise.all([
    client.get('/api/admin/ai-gateway/diagnostics'),
    client.get('/api/admin/model-ops-config'),
    client.get('/api/admin/ai-gateway/ops-control'),
  ]);
  return compactInspection({ diagnostics, modelOps, opsControl });
}

async function providerKeys(client) {
  return compactProviderKeys(await client.get('/api/admin/ai-gateway/provider-keys'));
}

async function providerKeyUpsert(client, args) {
  assertApply(args, 'provider-key-upsert');
  const provider = normalizeProviderId(args.provider || 'google-agent-platform');
  if (!provider) throw new Error('--provider is required');
  const secret = requireNonEmpty(
    args.secret || process.env.PROVIDER_API_KEY || process.env.AGENT_PLATFORM_API_KEY,
    'PROVIDER_API_KEY'
  );
  const label = String(args.label || (provider === 'vertex-site' ? 'Agent Platform primary' : `${provider} primary`)).trim();
  const current = await client.get('/api/admin/ai-gateway/provider-keys');
  const rows = Array.isArray(current.keys) ? current.keys : [];
  const existing = rows.find((row) => normalizeProviderId(row.provider) === provider && row.label === label)
    || rows.find((row) => normalizeProviderId(row.provider) === provider && keyHasUsableSecret(row));
  const nextRow = {
    ...(existing || {}),
    id: existing?.id,
    provider,
    label,
    enabled: true,
    priority: Number(args.priority || existing?.priority || 100),
    rpm: Number(args.rpm || existing?.rpm || 0),
    secret,
    credentials: existing?.credentials || {},
  };
  const nextRows = existing
    ? rows.map((row) => (row.id === existing.id ? nextRow : row))
    : [...rows, nextRow];
  const saved = await client.put('/api/admin/ai-gateway/provider-keys', { keys: nextRows });
  const savedRow = (saved.keys || []).find((row) => normalizeProviderId(row.provider) === provider && row.label === label)
    || (saved.keys || []).find((row) => normalizeProviderId(row.provider) === provider);
  const smoke = savedRow?.id
    ? await client.post(`/api/admin/ai-gateway/provider-keys/${encodeURIComponent(savedRow.id)}/smoke-test`, {})
    : null;
  return {
    ok: true,
    provider,
    key: savedRow
      ? {
          id: savedRow.id,
          label: savedRow.label,
          enabled: savedRow.enabled !== false,
          secretPreview: savedRow.secretPreview || null,
          hasSecret: Boolean(savedRow.hasSecret),
        }
      : null,
    smoke: smoke
      ? {
          ok: Boolean(smoke.ok),
          status: smoke.status || null,
          mode: smoke.mode || null,
          message: smoke.message || null,
          nextAction: smoke.nextAction || null,
        }
      : null,
  };
}

async function diagnostics(client, args) {
  const models = commaList(args.models);
  if (!models.length) throw new Error('--models is required');
  const layers = args.generation ? ['route', 'generation'] : ['route'];
  const result = await client.post('/api/admin/model-diagnostics/run', {
    layers,
    models: models.map((canonicalModelId) => ({
      canonicalModelId,
      modality: inferDiagnosticModality(canonicalModelId),
    })),
  });
  return compactDiagnostics(result);
}

async function savePublished(client, nextAllowlist) {
  const current = await client.get('/api/admin/model-ops-config');
  const config = {
    ...(current.config || {}),
    publishedCanonicalModelAllowlist: nextAllowlist.length ? nextAllowlist : null,
  };
  const saved = await client.put('/api/admin/model-ops-config', { config });
  return {
    ok: true,
    publishedCanonicalModelAllowlist: saved.config?.publishedCanonicalModelAllowlist || null,
    updatedAt: saved.config?.updatedAt || null,
  };
}

async function publishSet(client, args) {
  assertApply(args, 'publish-set');
  const models = commaList(args.models);
  if (!models.length) throw new Error('--models is required');
  return savePublished(client, models);
}

async function publishAdd(client, args) {
  assertApply(args, 'publish-add');
  const models = commaList(args.models);
  if (!models.length) throw new Error('--models is required');
  const current = await client.get('/api/admin/model-ops-config');
  const existing = Array.isArray(current.config?.publishedCanonicalModelAllowlist)
    ? current.config.publishedCanonicalModelAllowlist
    : [];
  return savePublished(client, [...existing, ...models].filter((item, index, arr) => item && arr.indexOf(item) === index));
}

async function publishRemove(client, args) {
  assertApply(args, 'publish-remove');
  const models = new Set(commaList(args.models));
  if (!models.size) throw new Error('--models is required');
  const current = await client.get('/api/admin/model-ops-config');
  const existing = Array.isArray(current.config?.publishedCanonicalModelAllowlist)
    ? current.config.publishedCanonicalModelAllowlist
    : [];
  return savePublished(client, existing.filter((model) => !models.has(model)));
}

async function pause(client, args, kind) {
  const rawKey = kind === 'provider' ? args.provider : args.model;
  const key = kind === 'provider' ? normalizeProviderId(rawKey) : String(rawKey || '').trim();
  if (!key) throw new Error(kind === 'provider' ? '--provider is required' : '--model is required');
  assertApply(args, `pause-${kind}`);
  return client.post('/api/admin/ai-gateway/ops-control/actions', {
    kind,
    key,
    ttlMinutes: args.ttl || 60,
    reason: args.reason || `admin-online-config pause ${kind}`,
  });
}

async function resume(client, args, kind) {
  const rawKey = kind === 'provider' ? args.provider : args.model;
  const key = kind === 'provider' ? normalizeProviderId(rawKey) : String(rawKey || '').trim();
  if (!key) throw new Error(kind === 'provider' ? '--provider is required' : '--model is required');
  assertApply(args, `resume-${kind}`);
  const current = await client.get('/api/admin/ai-gateway/ops-control');
  const config = current.config || {};
  const next = {
    ...config,
    disabledProviders:
      kind === 'provider' ? (config.disabledProviders || []).filter((item) => normalizeProviderId(item) !== key) : config.disabledProviders || [],
    disabledProviderRules:
      kind === 'provider'
        ? (config.disabledProviderRules || []).filter((item) => normalizeProviderId(item?.provider) !== key)
        : config.disabledProviderRules || [],
    disabledModels:
      kind === 'model' ? (config.disabledModels || []).filter((item) => item !== key) : config.disabledModels || [],
    disabledModelRules:
      kind === 'model' ? (config.disabledModelRules || []).filter((item) => item?.model !== key) : config.disabledModelRules || [],
  };
  return client.put('/api/admin/ai-gateway/ops-control', next);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  if (command === 'help' || args.help) {
    usage();
    return;
  }

  const client = new OnlineAdminClient({
    authBase: String(process.env.AUTH_API_BASE || DEFAULT_AUTH),
    origin: String(process.env.ADMIN_ORIGIN || DEFAULT_ORIGIN),
    identifier: requireNonEmpty(process.env.ADMIN_IDENTIFIER, 'ADMIN_IDENTIFIER'),
    password: requireNonEmpty(process.env.ADMIN_PASSWORD, 'ADMIN_PASSWORD'),
  });

  const login = await client.login();
  let result;
  if (command === 'inspect') result = await inspect(client);
  else if (command === 'provider-keys') result = await providerKeys(client);
  else if (command === 'provider-key-upsert') result = await providerKeyUpsert(client, args);
  else if (command === 'diagnostics') result = await diagnostics(client, args);
  else if (command === 'publish-set') result = await publishSet(client, args);
  else if (command === 'publish-add') result = await publishAdd(client, args);
  else if (command === 'publish-remove') result = await publishRemove(client, args);
  else if (command === 'pause-provider') result = await pause(client, args, 'provider');
  else if (command === 'resume-provider') result = await resume(client, args, 'provider');
  else if (command === 'pause-model') result = await pause(client, args, 'model');
  else if (command === 'resume-model') result = await resume(client, args, 'model');
  else if (command === 'clear-pauses') {
    assertApply(args, 'clear-pauses');
    result = await client.delete('/api/admin/ai-gateway/ops-control');
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  console.log(JSON.stringify({ actor: login.username, command, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
