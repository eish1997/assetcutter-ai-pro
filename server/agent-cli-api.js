/**
 * Cloud Agent CLI API — PAT + projects/assets/run/audit.
 * Zero coupling to companion MCP / Body MCP.
 */
import { defaultAgentCliStore } from './agent-cli-store.js';

function bearerToken(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

function svgDataUrl(prompt, projectId) {
  const title = String(prompt || 'Agent CLI').slice(0, 80).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1a1a22"/><stop offset="100%" stop-color="#2d4a6f"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="40" y="80" fill="#e8e8ef" font-size="28" font-family="sans-serif">AssetCutter Agent CLI</text>
  <text x="40" y="130" fill="#a8b0c0" font-size="16" font-family="sans-serif">${title}</text>
  <text x="40" y="480" fill="#6a7384" font-size="12" font-family="monospace">${projectId}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * @returns {Promise<boolean>} handled
 */
export async function handleAgentCliRoutes(req, res, path, ctx) {
  const {
    requireAuth,
    json,
    readBody,
    store = defaultAgentCliStore,
    publicSiteUrl = process.env.PUBLIC_SITE_URL || process.env.VITE_SITE_URL || 'http://localhost:3000',
    authApiPublicUrl = process.env.AUTH_API_PUBLIC_URL || '',
  } = ctx;

  const runGenerate = async (job, user) => {
    store.updateJob(job.id, { status: 'running' });
    try {
      // Soul path: always produce a platform asset. Real model wiring can replace this later;
      // do not call MCP/bridge. Optional gateway hook via env for future.
      const url = svgDataUrl(job.prompt, job.projectId);
      const asset = store.createAsset({
        userId: user.id,
        username: user.username,
        projectId: job.projectId,
        kind: 'image',
        name: `run-${job.id.slice(0, 10)}`,
        prompt: job.prompt,
        url,
        meta: { jobId: job.id, presetId: job.presetId, generator: 'agent-cli-svg' },
      });
      store.updateJob(job.id, {
        status: 'succeeded',
        assetId: asset.id,
        finishedAt: new Date().toISOString(),
      });
      store.appendAudit({
        actorUserId: user.id,
        action: 'run.complete',
        ok: true,
        resourceIds: [job.id, asset.id],
      });
      return { job: store.getJob({ userId: user.id, jobId: job.id }), asset };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      store.updateJob(job.id, {
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      store.appendAudit({
        actorUserId: user.id,
        action: 'run.complete',
        ok: false,
        resourceIds: [job.id],
        meta: { error: message },
      });
      return { job: store.getJob({ userId: user.id, jobId: job.id }), asset: null, error: message };
    }
  };

  // --- Device login (no auth for start/poll; approve needs session) ---
  if (path === '/api/agent/cli/device/start' && req.method === 'POST') {
    const body = await readBody(req);
    const siteUrl = String(body.siteUrl || publicSiteUrl).trim() || publicSiteUrl;
    const row = store.startDeviceLogin({ siteUrl });
    const verifyPath = `/api/agent/cli/device/verify?user_code=${encodeURIComponent(row.userCode)}`;
    const authBase = String(authApiPublicUrl || '').replace(/\/+$/, '');
    const verificationUrl = authBase
      ? `${authBase}${verifyPath}`
      : verifyPath;
    json(res, 200, {
      ok: true,
      deviceCode: row.deviceCode,
      userCode: row.userCode,
      verificationUrl,
      verificationUriComplete: verificationUrl,
      expiresIn: 900,
      interval: 2,
      message: 'Open verificationUrl while logged in to AssetCutter, then return here.',
    });
    return true;
  }

  if (path === '/api/agent/cli/device/poll' && req.method === 'POST') {
    const body = await readBody(req);
    const deviceCode = String(body.deviceCode || '').trim();
    if (!deviceCode) {
      json(res, 400, { error: '缺少 deviceCode', code: 'AGENT_CLI_INVALID_ARGS' });
      return true;
    }
    const result = store.pollDevice(deviceCode);
    if (result.status === 'pending') {
      json(res, 200, { ok: true, status: 'pending', userCode: result.userCode });
      return true;
    }
    if (result.status === 'expired') {
      json(res, 400, { ok: false, status: 'expired', error: result.error || 'expired' });
      return true;
    }
    json(res, 200, {
      ok: true,
      status: 'approved',
      token: result.token,
      userId: result.userId,
      username: result.username,
      patId: result.patId,
      tokenHint: 'Store locally; never commit. Revoke via /api/agent/cli/pat/revoke',
    });
    return true;
  }

  if (path === '/api/agent/cli/device/verify' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://local');
    const userCode = String(url.searchParams.get('user_code') || '').trim().toUpperCase();
    const html = (title, body) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
        <body style="font-family:sans-serif;padding:2rem;background:#0f0f12;color:#eee;line-height:1.5">
        ${body}</body>`);
    };
    if (!userCode) {
      html('Agent CLI', '<h1>Agent CLI 授权</h1><p>缺少 user_code。请从 CLI 打开完整链接。</p>');
      return true;
    }
    // Avoid JSON 401 for browser: probe session without writing error body first
    const cookieHeader = String(req.headers.cookie || '');
    if (!/ac_session=/.test(cookieHeader)) {
      const site = String(publicSiteUrl || 'http://localhost:3000').replace(/\/+$/, '');
      html(
        'Agent CLI',
        `<h1>请先登录 AssetCutter</h1>
         <p>设备码：<code>${userCode}</code></p>
         <p><a style="color:#8ab4ff" href="${site}">打开网站登录</a> 后，重新打开本授权链接。</p>`,
      );
      return true;
    }
    const user = await requireAuth(req, res);
    if (!user) {
      // requireAuth already wrote JSON; for browsers this is suboptimal but rare if cookie present-but-expired
      return true;
    }
    const approved = store.approveDevice({
      userCode,
      userId: user.id,
      username: user.username,
    });
    if (!approved.ok) {
      html(
        'Agent CLI',
        `<h1>授权失败</h1><p>${approved.error}</p>
         <p>请重新运行 <code>npm run agent:cli -- login</code></p>`,
      );
      return true;
    }
    html(
      'Agent CLI',
      `<h1>已授权 Agent CLI</h1>
       <p>用户 <strong>${String(user.username || user.id)}</strong> 已批准设备码 <code>${userCode}</code>。</p>
       <p>请回到终端；CLI 将自动保存 Token。可关闭此页。</p>`,
    );
    return true;
  }

  if (path === '/api/agent/cli/device/approve' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const userCode = String(body.userCode || '').trim();
    const approved = store.approveDevice({
      userCode,
      userId: user.id,
      username: user.username,
    });
    if (!approved.ok) {
      json(res, 400, { ok: false, error: approved.error });
      return true;
    }
    json(res, 200, { ok: true, userCode, patId: approved.device.patId });
    return true;
  }

  // --- Authenticated via PAT or session ---
  async function requireCliUser() {
    const token = bearerToken(req);
    if (token) {
      const pat = store.resolvePat(token);
      if (!pat) {
        json(res, 401, { error: '无效或已撤销的 Agent PAT', code: 'AGENT_CLI_PAT_INVALID' });
        return null;
      }
      return { id: pat.userId, username: pat.username, patId: pat.id, via: 'pat' };
    }
    const user = await requireAuth(req, res);
    if (!user) return null;
    return { id: user.id, username: user.username, via: 'session' };
  }

  if (path === '/api/agent/cli/whoami' && req.method === 'GET') {
    const user = await requireCliUser();
    if (!user) return true;
    json(res, 200, {
      ok: true,
      user: { id: user.id, username: user.username },
      auth: user.via,
      patId: user.patId || null,
    });
    return true;
  }

  if (path === '/api/agent/cli/pat/create' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const { pat, token } = store.createPat({
      userId: user.id,
      username: user.username,
      label: body.label,
    });
    json(res, 200, {
      ok: true,
      patId: pat.id,
      token,
      tokenPrefix: pat.tokenPrefix,
      scopes: pat.scopes,
      message: 'Save token locally; it will not be shown again.',
    });
    return true;
  }

  if (path === '/api/agent/cli/pat/revoke' && req.method === 'POST') {
    const user = await requireCliUser();
    if (!user) return true;
    const body = await readBody(req);
    const patId = String(body.patId || user.patId || '').trim();
    if (!patId) {
      json(res, 400, { error: '缺少 patId' });
      return true;
    }
    const row = store.revokePat({ userId: user.id, patId });
    if (!row) {
      json(res, 404, { error: 'PAT 不存在' });
      return true;
    }
    json(res, 200, { ok: true, patId });
    return true;
  }

  if (path === '/api/agent/cli/projects' && req.method === 'GET') {
    const user = await requireCliUser();
    if (!user) return true;
    const projects = store.listProjects({ userId: user.id });
    json(res, 200, { ok: true, count: projects.length, projects });
    return true;
  }

  if (path === '/api/agent/cli/projects' && req.method === 'POST') {
    const user = await requireCliUser();
    if (!user) return true;
    const body = await readBody(req);
    const project = store.createProject({
      userId: user.id,
      username: user.username,
      name: body.name,
    });
    json(res, 200, { ok: true, project });
    return true;
  }

  if (path === '/api/agent/cli/assets' && req.method === 'GET') {
    const user = await requireCliUser();
    if (!user) return true;
    const url = new URL(req.url || '/', 'http://local');
    const projectId = url.searchParams.get('projectId') || '';
    const limit = Number(url.searchParams.get('limit') || 50);
    const assets = store.listPlatformAssets({
      userId: user.id,
      limit,
    }).filter((a) => !projectId || a.projectId === projectId);
    json(res, 200, { ok: true, count: assets.length, assets, source: 'agent-cli' });
    return true;
  }

  if (path === '/api/agent/cli/assets/get' && req.method === 'POST') {
    const user = await requireCliUser();
    if (!user) return true;
    const body = await readBody(req);
    const assetId = String(body.assetId || '').trim();
    const asset = store.getAsset({ userId: user.id, assetId });
    if (!asset) {
      json(res, 404, { error: '资产不存在', code: 'AGENT_CLI_ASSET_NOT_FOUND' });
      return true;
    }
    json(res, 200, { ok: true, asset });
    return true;
  }

  if (path === '/api/agent/cli/run' && req.method === 'POST') {
    const user = await requireCliUser();
    if (!user) return true;
    const body = await readBody(req);
    let projectId = String(body.projectId || '').trim();
    const prompt = String(body.prompt || '').trim();
    const wait = body.wait !== false;
    if (!prompt) {
      json(res, 400, { error: '缺少 prompt', code: 'AGENT_CLI_INVALID_ARGS' });
      return true;
    }
    if (!projectId) {
      const project = store.createProject({
        userId: user.id,
        username: user.username,
        name: body.projectName || `Agent ${new Date().toISOString().slice(0, 10)}`,
      });
      projectId = project.id;
    } else if (!store.getProject({ userId: user.id, projectId })) {
      json(res, 404, { error: '项目不存在', code: 'AGENT_CLI_PROJECT_NOT_FOUND' });
      return true;
    }
    const job = store.createJob({
      userId: user.id,
      username: user.username,
      projectId,
      prompt,
      presetId: body.presetId || 'text-to-image',
    });
    if (!wait) {
      // fire and forget
      void runGenerate(job, user);
      json(res, 202, { ok: true, status: 'queued', jobId: job.id, projectId });
      return true;
    }
    const result = await runGenerate(job, user);
    if (result.error) {
      json(res, 500, {
        ok: false,
        job: result.job,
        error: result.error,
      });
      return true;
    }
    json(res, 200, {
      ok: true,
      job: result.job,
      asset: result.asset,
      projectId,
      message: 'Asset created in platform Agent CLI asset list (source=agent-cli).',
    });
    return true;
  }

  if (path === '/api/agent/cli/jobs/get' && req.method === 'POST') {
    const user = await requireCliUser();
    if (!user) return true;
    const body = await readBody(req);
    const job = store.getJob({ userId: user.id, jobId: String(body.jobId || '').trim() });
    if (!job) {
      json(res, 404, { error: '任务不存在' });
      return true;
    }
    json(res, 200, { ok: true, job });
    return true;
  }

  if (path === '/api/agent/cli/audit' && req.method === 'GET') {
    const user = await requireCliUser();
    if (!user) return true;
    const url = new URL(req.url || '/', 'http://local');
    const limit = Number(url.searchParams.get('limit') || 50);
    const entries = store.listAudit({ userId: user.id, limit });
    json(res, 200, { ok: true, count: entries.length, entries, source: 'agent-cli' });
    return true;
  }

  return false;
}
