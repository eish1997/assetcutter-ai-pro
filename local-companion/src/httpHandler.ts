import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCapabilitiesPayload,
  buildRuntimeStatus,
  listPlugins,
} from './pluginRegistry.js';
import {
  getRepositoryRoot,
  getRepositorySummary,
  getRepositoryShallowBytesUsed,
} from './repositoryVolume.js';
import { listProjectIds } from './storage/projectPaths.js';
import {
  deleteAsset,
  getAssetMeta,
  getManifestJson,
  putAsset,
  readAssetObjectBytes,
  reconcileManifestOrphansFromDisk,
} from './storage/assetBlob.js';
import { openProjectFile, saveProjectFile } from './storage/projectFileIO.js';
import {
  createWorkspaceProjectInRepo,
  deleteWorkspaceProjectFromRepo,
  listWorkspaceTrashProjectsFromRepo,
  listWorkspaceProjectsFromRepo,
  renameWorkspaceProjectInRepo,
  restoreWorkspaceProjectFromTrash,
} from './storage/workspaceProjects.js';
import { listRecentJobs, submitJob, getJob, deleteJob, listJobEvents } from './compute/jobsStore.js';
import { readRequestBodyRaw } from './httpReadBody.js';
import {
  checkBearerAuthorization,
  isBearerExemptPath,
  isOriginAllowed,
  parseAllowedOriginEntries,
} from './accessGate.js';
import { getPairingSessionSummary, revokePairingSession } from './pairingSession.js';
import { installHostPluginBundleFromUrl, listInstalledHostPluginBundles } from './hostPluginBundles.js';

let cachedIndexHtml: string | null = null;

/** 桌面壳 spawn 的 cwd 恒为伴侣根目录；bundle 与源码布局下均为 `<根>/public/index.html` */
function resolvePublicIndexHtmlPath(): string {
  const fromCwd = join(process.cwd(), 'public', 'index.html');
  if (existsSync(fromCwd)) return fromCwd;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'public', 'index.html');
}

function loadIndexHtml(): string {
  if (cachedIndexHtml) return cachedIndexHtml;
  const p = resolvePublicIndexHtmlPath();
  cachedIndexHtml = readFileSync(p, 'utf8');
  return cachedIndexHtml;
}

function readOrigin(req: IncomingMessage): string | undefined {
  const h = req.headers.origin;
  return typeof h === 'string' ? h : undefined;
}

function sendJson(
  res: ServerResponse,
  code: number,
  body: unknown,
  origin: string | undefined,
  extraHeaders?: Record<string, string>,
): void {
  const o = origin ?? '*';
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, html: string, origin?: string): void {
  const o = origin ?? '*';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': o,
  });
  res.end(html);
}

function preflight(res: ServerResponse, origin: string | undefined): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end();
}

function sendSseHeaders(res: ServerResponse, origin: string | undefined): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': origin ?? '*',
  });
}

function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  httpPort: number,
): Promise<void> {
  const origin = readOrigin(req);
  const urlStr = req.url || '/';
  const method = (req.method ?? 'GET').toUpperCase();
  const u = new URL(urlStr, 'http://127.0.0.1');
  const path = u.pathname;

  if (method === 'OPTIONS') {
    if (!isOriginAllowed(origin, parseAllowedOriginEntries())) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'origin_not_allowed', code: 'AUTH_ORIGIN_DENIED' }));
      return;
    }
    preflight(res, origin);
    return;
  }

  if (!isOriginAllowed(origin, parseAllowedOriginEntries())) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'origin_not_allowed', code: 'AUTH_ORIGIN_DENIED' }));
    return;
  }

  if (!isBearerExemptPath(path, method)) {
    const ah = req.headers.authorization;
    const ahv = Array.isArray(ah) ? ah[0] : ah;
    const bc = checkBearerAuthorization(ahv);
    if (bc !== 'ok') {
      const code =
        bc === 'missing' ? 'AUTH_TOKEN_REQUIRED' : bc === 'revoked' ? 'AUTH_TOKEN_REVOKED' : 'AUTH_TOKEN_INVALID';
      const err = bc === 'missing' ? 'bearer_required' : bc === 'revoked' ? 'bearer_revoked' : 'bearer_invalid';
      sendJson(res, 401, { error: err, code }, origin, { 'WWW-Authenticate': 'Bearer' });
      return;
    }
  }

  try {
    if (path === '/v1/health' && method === 'GET') {
      sendJson(
        res,
        200,
        { ok: true, service: 'assetcutter-local-companion', time: new Date().toISOString() },
        origin,
      );
      return;
    }

    if (path === '/v1/capabilities' && method === 'GET') {
      sendJson(res, 200, buildCapabilitiesPayload(), origin);
      return;
    }

    if (path === '/v1/runtime-status' && method === 'GET') {
      sendJson(res, 200, buildRuntimeStatus(httpPort), origin);
      return;
    }

    if (path === '/v1/pairing/session' && method === 'GET') {
      sendJson(res, 200, { pairing: getPairingSessionSummary() }, origin);
      return;
    }

    if (path === '/v1/pairing/revoke' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let reason = '';
      if (raw.length > 0) {
        try {
          const parsed = JSON.parse(raw.toString('utf8')) as { reason?: string };
          reason = typeof parsed.reason === 'string' ? parsed.reason : '';
        } catch {
          /* ignore bad JSON reason; still revoke */
        }
      }
      sendJson(res, 200, { pairing: revokePairingSession(reason || 'manual_api_revoke') }, origin);
      return;
    }

    if (path === '/v1/plugins' && method === 'GET') {
      sendJson(res, 200, { plugins: listPlugins() }, origin);
      return;
    }

    if (path === '/v1/host-plugins/bundles' && method === 'GET') {
      const bundles = await listInstalledHostPluginBundles();
      sendJson(res, 200, { bundles }, origin);
      return;
    }

    if (path === '/v1/host-plugins/install-from-url' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: 'invalid_json', code: 'BAD_JSON' }, origin);
          return;
        }
      }
      try {
        const url = typeof body.url === 'string' ? body.url.trim() : '';
        const semver = typeof body.semver === 'string' ? body.semver.trim() : '';
        const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim() : '';
        const bytes = body.bytes;
        const label = typeof body.label === 'string' ? body.label : '';
        if (!url || !semver || !sha256) {
          sendJson(res, 400, { error: '缺少 url / semver / sha256', code: 'BAD_BODY' }, origin);
          return;
        }
        const result = await installHostPluginBundleFromUrl({
          url,
          semver,
          sha256Expected: sha256,
          bytesExpected: typeof bytes === 'number' ? bytes : Number(bytes),
          label,
        });
        sendJson(res, 200, { ok: true, manifest: result.manifest, bundlePath: result.bundlePath }, origin);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { error: msg, code: 'HOST_BUNDLE_INSTALL_FAILED' }, origin);
      }
      return;
    }

    if (path === '/v1/repository/summary' && method === 'GET') {
      sendJson(
        res,
        200,
        {
          ...getRepositorySummary(),
          shallowFileBytesTotal: getRepositoryShallowBytesUsed(),
          volumeRootConfigured: getRepositoryRoot(),
        },
        origin,
      );
      return;
    }

    if (path === '/v1/projects' && method === 'GET') {
      sendJson(res, 200, { projectIds: listProjectIds() }, origin);
      return;
    }

    if (path === '/v1/workspace/projects' && method === 'GET') {
      sendJson(res, 200, { projects: listWorkspaceProjectsFromRepo() }, origin);
      return;
    }

    if (path === '/v1/workspace/trash/projects' && method === 'GET') {
      sendJson(res, 200, { items: listWorkspaceTrashProjectsFromRepo() }, origin);
      return;
    }

    if (path === '/v1/workspace/projects' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'WORKSPACE_PROJECT_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as { name?: string };
      const created = createWorkspaceProjectInRepo(String(body.name || ''));
      sendJson(res, 201, { ok: true, project: created }, origin);
      return;
    }

    const mWorkspaceProject = path.match(/^\/v1\/workspace\/projects\/([^/]+)$/);
    if (mWorkspaceProject && method === 'PATCH') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'WORKSPACE_PROJECT_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as { name?: string };
      const updated = renameWorkspaceProjectInRepo(decodeURIComponent(mWorkspaceProject[1]!), String(body.name || ''));
      sendJson(res, 200, { ok: true, project: updated }, origin);
      return;
    }

    if (mWorkspaceProject && method === 'DELETE') {
      const out = deleteWorkspaceProjectFromRepo(decodeURIComponent(mWorkspaceProject[1]!));
      sendJson(res, 200, out, origin);
      return;
    }

    const mWorkspaceTrashRestore = path.match(/^\/v1\/workspace\/trash\/projects\/([^/]+)\/restore$/);
    if (mWorkspaceTrashRestore && method === 'POST') {
      const out = restoreWorkspaceProjectFromTrash(decodeURIComponent(mWorkspaceTrashRestore[1]!));
      sendJson(res, 200, out, origin);
      return;
    }

    if (path === '/v1/compute/jobs' && method === 'GET') {
      sendJson(res, 200, { jobs: listRecentJobs(30) }, origin);
      return;
    }

    if (path === '/v1/projects/save-as' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'PROJECT_FILE_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as {
        filePath?: string;
        projectId?: string;
        projectName?: string;
        bundle?: unknown;
      };
      if (!body.bundle || typeof body.bundle !== 'object') {
        sendJson(res, 400, { error: 'bundle_required', code: 'PROJECT_FILE_BUNDLE_REQUIRED' }, origin);
        return;
      }
      const out = saveProjectFile({
        filePath: String(body.filePath || ''),
        ...(body.projectId ? { projectId: String(body.projectId) } : {}),
        ...(body.projectName ? { projectName: String(body.projectName) } : {}),
        bundle: body.bundle,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          ...out,
          deprecated: true,
          message: 'DEPRECATED: use /v1/workspace/projects APIs instead',
        },
        origin,
        {
          Deprecation: 'true',
          Sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
        }
      );
      return;
    }

    if (path === '/v1/projects/open' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        data = JSON.parse(raw.length ? raw.toString('utf8') : '{}') as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'PROJECT_FILE_INVALID_BODY' }, origin);
        return;
      }
      const body = (data && typeof data === 'object' ? data : {}) as { filePath?: string };
      const out = openProjectFile({ filePath: String(body.filePath || '') });
      sendJson(
        res,
        200,
        {
          ok: true,
          ...out,
          deprecated: true,
          message: 'DEPRECATED: use /v1/workspace/projects APIs instead',
        },
        origin,
        {
          Deprecation: 'true',
          Sunset: 'Wed, 31 Dec 2026 23:59:59 GMT',
        }
      );
      return;
    }

    const mManifest = path.match(/^\/v1\/projects\/([^/]+)\/manifest$/);
    if (mManifest && method === 'GET') {
      const r = getManifestJson(mManifest[1]!);
      if ('ok' in r) sendJson(res, 200, r.body, origin);
      else
        sendJson(
          res,
          r.code === 'STORAGE_NOT_FOUND' ? 404 : 400,
          { error: r.error, code: r.code },
          origin,
        );
      return;
    }

    const mManifestReconcile = path.match(/^\/v1\/projects\/([^/]+)\/manifest\/reconcile$/);
    if (mManifestReconcile && method === 'POST') {
      const out = reconcileManifestOrphansFromDisk(mManifestReconcile[1]!);
      if ('error' in out) {
        const status = out.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: out.error, code: out.code }, origin);
      } else {
        sendJson(res, 200, { ok: true, added: out.added, keys: out.keys }, origin);
      }
      return;
    }

    const mMeta = path.match(/^\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/meta$/);
    if (mMeta && method === 'GET') {
      const r = getAssetMeta(mMeta[1]!, mMeta[2]!);
      if ('error' in r) {
        const status = r.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: r.error, code: r.code }, origin);
      } else {
        sendJson(
          res,
          200,
          {
            projectId: r.projectId,
            key: r.entry.key,
            relPath: r.entry.relPath,
            byteSize: r.entry.byteSize,
            mime: r.entry.mime,
            updatedAt: r.entry.updatedAt,
            onDisk: r.exists,
          },
          origin,
        );
      }
      return;
    }

    const mAsset = path.match(/^\/v1\/projects\/([^/]+)\/assets\/([^/]+)$/);
    if (mAsset && method === 'GET') {
      const pid = mAsset[1]!;
      const key = mAsset[2]!;
      const meta = getAssetMeta(pid, key);
      if ('error' in meta) {
        const status = meta.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, status, { error: meta.error, code: meta.code }, origin);
        return;
      }
      if (!meta.exists) {
        sendJson(res, 404, { error: 'object_missing', code: 'STORAGE_NOT_FOUND' }, origin);
        return;
      }
      const body = readAssetObjectBytes(pid, key);
      if (!('ok' in body && body.ok)) {
        const e = body as { error: string; code: string };
        sendJson(res, 400, { error: e.error, code: e.code }, origin);
        return;
      }
      const ct = meta.entry.mime || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': String(body.body.length),
        'Access-Control-Allow-Origin': origin ?? '*',
      });
      res.end(body.body);
      return;
    }

    if (mAsset && method === 'PUT') {
      const body = await readRequestBodyRaw(req);
      if (body.length === 0) {
        sendJson(res, 400, { error: 'empty_body', code: 'STORAGE_INVALID_BODY' }, origin);
        return;
      }
      const ct = req.headers['content-type'];
      const ctStr = Array.isArray(ct) ? ct[0] : ct;
      const out = putAsset(mAsset[1]!, mAsset[2]!, body, ctStr);
      sendJson(
        res,
        201,
        {
          key: mAsset[2],
          projectId: mAsset[1],
          ...out,
        },
        origin,
      );
      return;
    }

    if (mAsset && method === 'DELETE') {
      const d = deleteAsset(mAsset[1]!, mAsset[2]!);
      if ('ok' in d) sendJson(res, 200, { ok: true, key: mAsset[2], projectId: mAsset[1] }, origin);
      else {
        const st = d.code === 'STORAGE_NOT_FOUND' ? 404 : 400;
        sendJson(res, st, { error: d.error, code: d.code }, origin);
      }
      return;
    }

    if (path === '/v1/compute/jobs' && method === 'POST') {
      const raw = await readRequestBodyRaw(req);
      let data: unknown;
      try {
        const t = raw.length ? raw.toString('utf8') : '{}';
        data = JSON.parse(t) as unknown;
      } catch {
        sendJson(res, 400, { error: 'invalid_json', code: 'COMPUTE_INVALID_BODY' }, origin);
        return;
      }
      if (data && typeof data === 'object' && data !== null && 'job' in data) {
        data = (data as { job: unknown }).job;
      }
      const s = await submitJob(data);
      if (s && 'ok' in s && s.ok) {
        sendJson(res, 201, { jobId: s.job.jobId, status: s.job.status, job: s.job }, origin);
        return;
      }
      const err = s as { error: string; code: string };
      const code = err.code || 'COMPUTE_ERROR';
      const st = code === 'COMPUTE_DUPLICATE' ? 409 : 400;
      sendJson(res, st, { error: err.error, code: err.code }, origin);
      return;
    }

    const mJob = path.match(/^\/v1\/compute\/jobs\/([^/]+)$/);
    if (mJob && method === 'GET') {
      const j = getJob(mJob[1]!);
      if (!j) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      sendJson(res, 200, { job: j }, origin);
      return;
    }

    const mJobEvents = path.match(/^\/v1\/compute\/jobs\/([^/]+)\/events$/);
    if (mJobEvents && method === 'GET') {
      const jobId = mJobEvents[1]!;
      if (!getJob(jobId)) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      const afterSeqRaw = u.searchParams.get('afterSeq');
      const limitRaw = u.searchParams.get('limit');
      const afterSeq = afterSeqRaw ? Number.parseInt(afterSeqRaw, 10) : 0;
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
      const events = listJobEvents(jobId, Number.isFinite(afterSeq) ? afterSeq : 0, Number.isFinite(limit) ? limit : 100);
      const nextAfterSeq = events.length ? events[events.length - 1]!.seq : Number.isFinite(afterSeq) ? afterSeq : 0;
      sendJson(res, 200, { jobId, events, nextAfterSeq }, origin);
      return;
    }

    const mJobStream = path.match(/^\/v1\/compute\/jobs\/([^/]+)\/stream$/);
    if (mJobStream && method === 'GET') {
      const jobId = mJobStream[1]!;
      if (!getJob(jobId)) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      const afterSeqRaw = u.searchParams.get('afterSeq');
      let cursor = afterSeqRaw ? Number.parseInt(afterSeqRaw, 10) : 0;
      if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

      sendSseHeaders(res, origin);
      writeSse(res, 'ready', { jobId, afterSeq: cursor });
      const timer = setInterval(() => {
        const events = listJobEvents(jobId, cursor, 100);
        if (events.length > 0) {
          for (const e of events) {
            writeSse(res, 'job.event', e);
            cursor = Math.max(cursor, e.seq);
            if (e.type === 'reply.completed' || e.type === 'task.failed' || e.type === 'task.cancelled') {
              writeSse(res, 'job.end', { jobId, seq: e.seq, type: e.type });
              clearInterval(timer);
              res.end();
              return;
            }
          }
        } else {
          writeSse(res, 'keepalive', { afterSeq: cursor, at: Date.now() });
        }
      }, 1200);

      req.on('close', () => {
        clearInterval(timer);
      });
      return;
    }

    if (mJob && method === 'DELETE') {
      const j = getJob(mJob[1]!);
      if (!j) {
        sendJson(res, 404, { error: 'job_not_found', code: 'COMPUTE_NOT_FOUND' }, origin);
        return;
      }
      const removed = deleteJob(mJob[1]!);
      sendJson(
        res,
        200,
        { ok: removed, jobId: mJob[1], message: 'cancel or drop from memory' },
        origin,
      );
      return;
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      try {
        sendHtml(res, loadIndexHtml(), origin);
      } catch {
        sendJson(res, 500, { error: 'dashboard_read_failed' }, origin);
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found', path: path + u.search }, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'payload_too_large') {
      sendJson(res, 413, { error: 'payload_too_large', code: 'PAYLOAD_TOO_LARGE' }, origin);
    } else if (msg === 'invalid_projectId' || msg === 'invalid_key' || msg.startsWith('invalid_')) {
      sendJson(res, 400, { error: msg, code: 'STORAGE_INVALID_ID' }, origin);
    } else if (
      msg === 'PROJECT_FILE_PATH_REQUIRED' ||
      msg === 'PROJECT_FILE_PATH_MUST_BE_ABSOLUTE' ||
      msg === 'PROJECT_FILE_DIR_NOT_FOUND' ||
      msg === 'PROJECT_FILE_FORMAT_UNSUPPORTED'
    ) {
      sendJson(res, 400, { error: msg.toLowerCase(), code: msg }, origin);
    } else if (
      msg === 'WORKSPACE_PROJECT_NAME_REQUIRED' ||
      msg === 'WORKSPACE_PROJECT_NAME_INVALID' ||
      msg === 'WORKSPACE_PROJECT_ID_INVALID' ||
      msg === 'WORKSPACE_PROJECT_ALREADY_EXISTS' ||
      msg === 'WORKSPACE_TRASH_ID_INVALID'
    ) {
      sendJson(res, 400, { error: msg.toLowerCase(), code: msg }, origin);
    } else if (msg === 'WORKSPACE_PROJECT_NOT_FOUND') {
      sendJson(res, 404, { error: 'workspace_project_not_found', code: msg }, origin);
    } else if (msg === 'WORKSPACE_TRASH_NOT_FOUND') {
      sendJson(res, 404, { error: 'workspace_trash_not_found', code: msg }, origin);
    } else if (msg === 'PROJECT_FILE_NOT_FOUND') {
      sendJson(res, 404, { error: 'project_file_not_found', code: msg }, origin);
    } else {
      sendJson(res, 500, { error: 'internal', message: msg }, origin);
    }
  }
}
