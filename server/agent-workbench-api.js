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

  return false;
}
