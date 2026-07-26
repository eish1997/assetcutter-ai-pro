/**
 * Server-authoritative store for Agent CLI (PAT, projects, assets, audit).
 * File-backed under server/data/agent-cli/ — no MCP / companion dependency.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(__dirname, 'data', 'agent-cli');

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function createAgentCliStore(options = {}) {
  const root = path.resolve(String(options.root || process.env.AGENT_CLI_STORE_ROOT || DEFAULT_ROOT));
  const dbPath = path.join(root, 'db.json');

  function ensure() {
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(dbPath)) {
      const empty = {
        version: 1,
        pats: [],
        deviceCodes: [],
        projects: [],
        assets: [],
        jobs: [],
        audit: [],
      };
      fs.writeFileSync(dbPath, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
    }
  }

  function read() {
    ensure();
    try {
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      return {
        version: 1,
        pats: Array.isArray(raw.pats) ? raw.pats : [],
        deviceCodes: Array.isArray(raw.deviceCodes) ? raw.deviceCodes : [],
        projects: Array.isArray(raw.projects) ? raw.projects : [],
        assets: Array.isArray(raw.assets) ? raw.assets : [],
        jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
        audit: Array.isArray(raw.audit) ? raw.audit : [],
      };
    } catch {
      return { version: 1, pats: [], deviceCodes: [], projects: [], assets: [], jobs: [], audit: [] };
    }
  }

  function write(db) {
    ensure();
    const tmp = `${dbPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, dbPath);
  }

  function appendAudit(entry) {
    const db = read();
    const row = {
      id: crypto.randomUUID(),
      at: nowIso(),
      source: 'agent-cli',
      ...entry,
    };
    db.audit.unshift(row);
    if (db.audit.length > 5000) db.audit.length = 5000;
    write(db);
    return row;
  }

  function createPat({ userId, username, label }) {
    const token = `acpat_${crypto.randomBytes(24).toString('hex')}`;
    const db = read();
    const row = {
      id: crypto.randomUUID(),
      userId: String(userId),
      username: String(username || ''),
      label: String(label || 'default').slice(0, 64),
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      scopes: ['project:write', 'asset:read', 'run:generate'],
      createdAt: nowIso(),
      revokedAt: null,
    };
    db.pats.push(row);
    write(db);
    appendAudit({
      actorUserId: row.userId,
      action: 'pat.create',
      ok: true,
      resourceIds: [row.id],
      meta: { label: row.label, tokenPrefix: row.tokenPrefix },
    });
    return { pat: row, token };
  }

  function revokePat({ userId, patId }) {
    const db = read();
    const row = db.pats.find((p) => p.id === patId && p.userId === userId);
    if (!row) return null;
    row.revokedAt = nowIso();
    write(db);
    appendAudit({
      actorUserId: userId,
      action: 'pat.revoke',
      ok: true,
      resourceIds: [patId],
    });
    return row;
  }

  function resolvePat(token) {
    const t = String(token || '').trim();
    if (!t.startsWith('acpat_')) return null;
    const db = read();
    const hash = hashToken(t);
    const row = db.pats.find((p) => p.tokenHash === hash && !p.revokedAt);
    return row || null;
  }

  function startDeviceLogin({ siteUrl }) {
    const deviceCode = crypto.randomBytes(16).toString('hex');
    const userCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const db = read();
    const row = {
      deviceCode,
      userCode,
      siteUrl: String(siteUrl || '').trim(),
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      approvedAt: null,
      userId: null,
      username: null,
      patToken: null,
    };
    db.deviceCodes.push(row);
    // prune old
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    db.deviceCodes = db.deviceCodes.filter((d) => new Date(d.createdAt).getTime() > cutoff);
    write(db);
    return row;
  }

  function getDevice(deviceCode) {
    const db = read();
    return db.deviceCodes.find((d) => d.deviceCode === deviceCode) || null;
  }

  function getDeviceByUserCode(userCode) {
    const db = read();
    const code = String(userCode || '').trim().toUpperCase();
    return db.deviceCodes.find((d) => d.userCode === code && !d.approvedAt) || null;
  }

  function approveDevice({ userCode, userId, username }) {
    const db = read();
    const code = String(userCode || '').trim().toUpperCase();
    const row = db.deviceCodes.find((d) => d.userCode === code && !d.approvedAt);
    if (!row) return { ok: false, error: 'device_code_not_found' };
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      return { ok: false, error: 'device_code_expired' };
    }
    const { pat, token } = createPat({ userId, username, label: `device-${row.userCode}` });
    // createPat already wrote; re-read and patch device
    const db2 = read();
    const d = db2.deviceCodes.find((x) => x.deviceCode === row.deviceCode);
    if (!d) return { ok: false, error: 'device_code_not_found' };
    d.approvedAt = nowIso();
    d.userId = String(userId);
    d.username = String(username || '');
    d.patToken = token;
    d.patId = pat.id;
    write(db2);
    appendAudit({
      actorUserId: String(userId),
      action: 'device.approve',
      ok: true,
      resourceIds: [d.deviceCode, pat.id],
    });
    return { ok: true, device: d, token };
  }

  function pollDevice(deviceCode) {
    const row = getDevice(deviceCode);
    if (!row) return { status: 'expired', error: 'device_code_not_found' };
    if (new Date(row.expiresAt).getTime() < Date.now() && !row.approvedAt) {
      return { status: 'expired', error: 'device_code_expired' };
    }
    if (!row.approvedAt) {
      return { status: 'pending', userCode: row.userCode };
    }
    const token = row.patToken || null;
    // one-time reveal: clear token from store after first successful poll
    if (token) {
      const db = read();
      const d = db.deviceCodes.find((x) => x.deviceCode === deviceCode);
      if (d) {
        d.patToken = null;
        write(db);
      }
    }
    return {
      status: 'approved',
      token,
      userId: row.userId,
      username: row.username,
      patId: row.patId,
    };
  }

  function createProject({ userId, username, name }) {
    const db = read();
    const project = {
      id: `agp_${crypto.randomBytes(8).toString('hex')}`,
      userId: String(userId),
      username: String(username || ''),
      name: String(name || 'Agent project').trim().slice(0, 120) || 'Agent project',
      source: 'agent-cli',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.projects.unshift(project);
    write(db);
    appendAudit({
      actorUserId: project.userId,
      action: 'project.create',
      ok: true,
      resourceIds: [project.id],
      meta: { name: project.name },
    });
    return project;
  }

  function listProjects({ userId }) {
    const db = read();
    return db.projects.filter((p) => p.userId === String(userId));
  }

  function getProject({ userId, projectId }) {
    const db = read();
    return db.projects.find((p) => p.userId === String(userId) && p.id === projectId) || null;
  }

  function createAsset({ userId, username, projectId, kind, name, prompt, url, meta }) {
    const db = read();
    const asset = {
      id: `aga_${crypto.randomBytes(8).toString('hex')}`,
      userId: String(userId),
      username: String(username || ''),
      projectId: String(projectId),
      kind: String(kind || 'image'),
      name: String(name || 'Agent asset').slice(0, 160),
      prompt: String(prompt || '').slice(0, 4000),
      url: url ? String(url) : null,
      meta: meta && typeof meta === 'object' ? meta : {},
      source: 'agent-cli',
      createdAt: nowIso(),
    };
    db.assets.unshift(asset);
    const project = db.projects.find((p) => p.id === projectId && p.userId === String(userId));
    if (project) project.updatedAt = nowIso();
    write(db);
    appendAudit({
      actorUserId: asset.userId,
      action: 'asset.create',
      ok: true,
      resourceIds: [asset.id, projectId],
      meta: { kind: asset.kind, name: asset.name },
    });
    return asset;
  }

  function listAssets({ userId, projectId, limit = 50 }) {
    const db = read();
    let rows = db.assets.filter((a) => a.userId === String(userId));
    if (projectId) rows = rows.filter((a) => a.projectId === String(projectId));
    return rows.slice(0, Math.min(200, Math.max(1, Number(limit) || 50)));
  }

  function getAsset({ userId, assetId }) {
    const db = read();
    return db.assets.find((a) => a.userId === String(userId) && a.id === assetId) || null;
  }

  function createJob({ userId, username, projectId, prompt, presetId }) {
    const db = read();
    const job = {
      id: `agj_${crypto.randomBytes(8).toString('hex')}`,
      userId: String(userId),
      username: String(username || ''),
      projectId: String(projectId),
      prompt: String(prompt || '').slice(0, 4000),
      presetId: String(presetId || 'text-to-image').slice(0, 80),
      status: 'queued',
      assetId: null,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null,
    };
    db.jobs.unshift(job);
    write(db);
    appendAudit({
      actorUserId: job.userId,
      action: 'run.create',
      ok: true,
      resourceIds: [job.id, projectId],
      meta: { presetId: job.presetId },
    });
    return job;
  }

  function updateJob(jobId, patch) {
    const db = read();
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: nowIso() });
    write(db);
    return job;
  }

  function getJob({ userId, jobId }) {
    const db = read();
    return db.jobs.find((j) => j.userId === String(userId) && j.id === jobId) || null;
  }

  function listAudit({ userId, limit = 50 }) {
    const db = read();
    return db.audit.filter((a) => a.actorUserId === String(userId)).slice(0, Math.min(200, Math.max(1, Number(limit) || 50)));
  }

  /** Platform list shape for web UI merge */
  function listPlatformAssets({ userId, limit = 100 }) {
    return listAssets({ userId, limit }).map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      url: a.url,
      projectId: a.projectId,
      prompt: a.prompt,
      createdAt: a.createdAt,
      source: 'agent-cli',
      meta: a.meta,
    }));
  }

  return {
    root,
    createPat,
    revokePat,
    resolvePat,
    startDeviceLogin,
    getDevice,
    getDeviceByUserCode,
    approveDevice,
    pollDevice,
    createProject,
    listProjects,
    getProject,
    createAsset,
    listAssets,
    getAsset,
    createJob,
    updateJob,
    getJob,
    listAudit,
    listPlatformAssets,
    appendAudit,
  };
}

export const defaultAgentCliStore = createAgentCliStore();
