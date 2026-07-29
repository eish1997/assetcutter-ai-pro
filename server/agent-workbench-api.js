/**
 * P1 主站 Agent Workbench 薄 API（鉴权：会话 Cookie，P1a）。
 */

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} path
 * @param {{
 *   requireAuth: (req: any, res: any) => Promise<object | null>;
 *   json: (res: any, status: number, body: object) => void;
 *   readBody: (req: any, opts?: object) => Promise<object>;
 *   getWorkspaceUsedBytes: (userId: string) => number;
 * }} ctx
 * @returns {Promise<boolean>} handled
 */
export async function handleAgentWorkbenchRoutes(req, res, path, ctx) {
  const { requireAuth, json, readBody, getWorkspaceUsedBytes } = ctx;

  if (path === '/api/agent/workbench/context' && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    json(res, 200, {
      authenticated: true,
      agentApiVersion: 1,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      workspaceUsedBytes: getWorkspaceUsedBytes(user.id),
      hint: '项目与能力预设状态由 workbench bridge（客户端）补充；请先在工作台 BrowserView 登录。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/open-project' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const projectId = String(body.projectId || '').trim();
    if (!projectId) {
      json(res, 400, {
        error: '缺少 projectId',
        code: 'AGENT_TOOL_INVALID_ARGS',
      });
      return true;
    }
    json(res, 200, {
      ok: true,
      projectId,
      userId: user.id,
      bridgeRequired: true,
      hint: '主进程将调用 workbench bridge 切换项目。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/create-project' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    json(res, 200, {
      ok: true,
      name: name || null,
      userId: user.id,
      bridgeRequired: true,
      hint: '主进程将调用 workbench bridge 创建项目并打开。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/list-assets' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    json(res, 200, {
      ok: true,
      projectId: body.projectId ? String(body.projectId) : null,
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : null,
      userId: user.id,
      bridgeRequired: true,
      hint: '实际资产摘要由 workbench bridge 从当前工作区状态读取。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/get-asset' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const assetId = String(body.assetId || '').trim();
    if (!assetId) {
      json(res, 400, {
        error: '缺少 assetId',
        code: 'AGENT_TOOL_INVALID_ARGS',
      });
      return true;
    }
    json(res, 200, {
      ok: true,
      projectId: body.projectId ? String(body.projectId) : null,
      assetId,
      userId: user.id,
      bridgeRequired: true,
      hint: '实际资产详情由 workbench bridge 从当前工作区状态读取。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/run-capability' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const presetId = String(body.presetId || '').trim();
    if (!presetId) {
      json(res, 400, {
        error: '缺少 presetId',
        code: 'AGENT_TOOL_INVALID_ARGS',
      });
      return true;
    }
    json(res, 200, {
      ok: true,
      presetId,
      projectId: body.projectId ? String(body.projectId) : null,
      inputText: body.inputText != null ? String(body.inputText) : null,
      imageDataUrlPresent: typeof body.imageDataUrl === 'string' && body.imageDataUrl.trim().length > 0,
      inputAssetId: body.inputAssetId ? String(body.inputAssetId) : null,
      inputAssetDisplayKey: body.inputAssetDisplayKey ? String(body.inputAssetDisplayKey) : null,
      userId: user.id,
      bridgeRequired: true,
      hint: '实际执行由 workbench bridge 调用 capabilityExecutor。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/create-text-asset' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) {
      json(res, 400, {
        error: '缺少 text',
        code: 'AGENT_TOOL_INVALID_ARGS',
      });
      return true;
    }
    json(res, 200, {
      ok: true,
      projectId: body.projectId ? String(body.projectId) : null,
      name: body.name != null ? String(body.name) : null,
      textLength: text.length,
      userId: user.id,
      bridgeRequired: true,
      hint: '实际创建由 workbench bridge 写入当前工作区项目资产列表。',
    });
    return true;
  }

  if (path === '/api/agent/workbench/create-image-asset' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const imageDataUrl = String(body.imageDataUrl || '').trim();
    const localPath = body.localPath != null ? String(body.localPath).trim() : '';
    const originalCompanionKey =
      body.originalCompanionKey != null ? String(body.originalCompanionKey).trim() : '';
    const imageDataUrlPresent =
      Boolean(body.imageDataUrlPresent) ||
      (imageDataUrl.length > 0 && /^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl));
    const imageDataUrlLength =
      Number.isFinite(Number(body.imageDataUrlLength)) && Number(body.imageDataUrlLength) > 0
        ? Number(body.imageDataUrlLength)
        : imageDataUrl.length;
    const imageByteLength =
      Number.isFinite(Number(body.imageByteLength)) && Number(body.imageByteLength) > 0
        ? Number(body.imageByteLength)
        : null;
    if (!imageDataUrlPresent && !localPath && !originalCompanionKey && !imageDataUrl) {
      json(res, 400, {
        error: '缺少 localPath 或 imageDataUrl',
        code: 'AGENT_TOOL_INVALID_ARGS',
      });
      return true;
    }
    if (imageDataUrl && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl)) {
      json(res, 400, {
        error: 'imageDataUrl 须为 data:image/...;base64,...',
        code: 'AGENT_TOOL_INVALID_ARGS',
      });
      return true;
    }
    json(res, 200, {
      ok: true,
      projectId: body.projectId ? String(body.projectId) : null,
      name: body.name != null ? String(body.name) : null,
      imageDataUrlPresent: Boolean(imageDataUrlPresent),
      imageDataUrlLength,
      imageByteLength,
      localPath: localPath || null,
      originalCompanionKey: originalCompanionKey || null,
      userId: user.id,
      bridgeRequired: true,
      hint: '实际导入由 workbench bridge 写入当前工作区项目资产列表；大图优先 localPath → 伴侣落盘。',
    });
    return true;
  }

  return false;
}
