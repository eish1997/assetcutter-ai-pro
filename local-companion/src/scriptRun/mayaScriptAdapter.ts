/**
 * Maya Command Port（Python 模式）：临时 .py + `exec(open(...))` 一行下发。
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

export const MAYA_SCRIPT_ADAPTER_ID = 'maya.command_port@v1';

async function fetchScriptHubRevisionContent(
  scriptId: string,
  revisionId: string,
  contentJwt: string,
): Promise<{ ok: true; content: string } | { error: string; code: string }> {
  const base = String(process.env.SCRIPT_HUB_API_BASE_URL || 'http://127.0.0.1:9101')
    .trim()
    .replace(/\/+$/, '');
  const url = `${base}/api/scripts/${encodeURIComponent(scriptId)}/revisions/${encodeURIComponent(revisionId)}/content`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${contentJwt}`, Accept: 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `拉取脚本正文失败：${msg}`, code: 'SCRIPT_HUB_FETCH_ERROR' };
  }
  const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string; code?: string };
  if (!res.ok) {
    return {
      error: String(data.error || `HTTP ${res.status}`),
      code: String(data.code || 'SCRIPT_HUB_CONTENT_HTTP'),
    };
  }
  const content = typeof data.content === 'string' ? data.content : '';
  if (!content.trim()) return { error: '远端返回空正文', code: 'SCRIPT_HUB_EMPTY_CONTENT' };
  return { ok: true, content };
}

function buildWrapperPython(paramsB64: string, sourceB64: string): string {
  return [
    'import json as _j',
    'import base64 as _b64',
    `_PARAMS = _j.loads(_b64.b64decode("${paramsB64}").decode("utf-8"))`,
    `_SRC = _b64.b64decode("${sourceB64}").decode("utf-8")`,
    '_ns = {}',
    'exec(compile(_SRC, "<script-hub>", "exec"), _ns, _ns)',
    '_run = _ns.get("run")',
    'if not callable(_run):',
    '    raise RuntimeError("Script must define run(params)")',
    '_run(_PARAMS)',
  ].join('\n');
}

function forwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 探测收尾：勿 destroy（易 RST 关掉 Maya 整条 commandPort）；仅摘监听并 unref */
function detachProbeSocketQuietly(sock: net.Socket) {
  try {
    sock.removeAllListeners('data');
    sock.removeAllListeners('error');
    sock.removeAllListeners('close');
    if (!sock.destroyed) sock.unref();
  } catch {
    /* ignore */
  }
}

type SendMayaCommandOptions = {
  /**
   * Maya Command Port 对单行命令常保持 TCP 不关闭，仅依赖 `close` 会误判超时。
   * 探测用：在收到任意数据后，若 idleMs 内无新数据则视为本轮输出结束。
   */
  idleMsAfterData?: number;
};

async function sendMayaCommand(
  host: string,
  port: number,
  line: string,
  budgetMs: number,
  opts?: SendMayaCommandOptions,
): Promise<string> {
  const payload = line.endsWith('\n') ? line : `${line}\n`;
  const idleAfter = opts?.idleMsAfterData;
  /** 探测：end() 后等 Maya 完全释放连接；grace 内禁止 destroy（RST 会关掉整条 commandPort → ECONNREFUSED） */
  const postEndGraceMs = idleAfter != null && idleAfter > 0 ? 5000 : 0;
  /** 总预算须覆盖 idle + grace，否则先触发 MAYA_EXEC_TIMEOUT → destroy → 下一轮拒绝连接 */
  const effectiveBudgetMs =
    idleAfter != null && idleAfter > 0
      ? Math.max(budgetMs, idleAfter + postEndGraceMs + 2000)
      : budgetMs;
  const connectOpts: net.NetConnectOpts =
    host === '127.0.0.1' || host === 'localhost' ? { host, port, family: 4 } : { host, port };

  return new Promise((resolve, reject) => {
    const sock = net.createConnection(connectOpts);
    const chunks: Buffer[] = [];
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let postEndGraceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearIdle = () => {
      if (idleTimer != null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const clearPostEndGrace = () => {
      if (postEndGraceTimer != null) {
        clearTimeout(postEndGraceTimer);
        postEndGraceTimer = null;
      }
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearIdle();
      clearPostEndGrace();
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString('utf8');
      const probeIdleMode = idleAfter != null && idleAfter > 0;
      try {
        if (err) {
          if (probeIdleMode && sock.writableEnded) {
            detachProbeSocketQuietly(sock);
          } else {
            sock.destroy();
          }
        } else if (!sock.destroyed && !sock.writableEnded) {
          sock.end();
        }
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(text);
    };

    const timer = setTimeout(() => finish(new Error('MAYA_EXEC_TIMEOUT')), Math.max(1000, effectiveBudgetMs));

    const armIdleFinish = () => {
      if (idleAfter == null || idleAfter <= 0) return;
      clearIdle();
      idleTimer = setTimeout(() => {
        clearIdle();
        try {
          if (!sock.destroyed && !sock.writableEnded) sock.end();
        } catch {
          /* ignore */
        }
        if (postEndGraceMs > 0) {
          postEndGraceTimer = setTimeout(() => {
            if (!settled) {
              detachProbeSocketQuietly(sock);
              finish();
            }
          }, postEndGraceMs);
        }
      }, idleAfter);
    };

    sock.once('connect', () => {
      sock.write(payload);
    });
    sock.on('data', (c) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      armIdleFinish();
    });
    sock.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
    sock.on('close', () => {
      clearPostEndGrace();
      finish();
    });
  });
}

export async function probeMayaCommandPort(
  host: string,
  port: number,
  timeoutMs = 10000,
): Promise<{ ok: boolean; message: string }> {
  try {
    await sendMayaCommand(host, port, 'print("SCRIPT_HUB_PING")', timeoutMs, { idleMsAfterData: 250 });
    return { ok: true, message: `Maya Command Port 可达 ${host}:${port}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'MAYA_EXEC_TIMEOUT') return { ok: false, message: `连接 ${host}:${port} 超时` };
    return { ok: false, message: `无法连接 ${host}:${port}：${msg}` };
  }
}

export async function runMayaScriptJob(
  inputs: unknown,
  params: unknown,
): Promise<{ ok: true; stdout: string } | { error: string; code: string; stdout?: string }> {
  const inp = inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? (inputs as Record<string, unknown>) : {};
  const par = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  const scriptSource = typeof inp.scriptSource === 'string' ? inp.scriptSource.trim().toLowerCase() : '';
  let content = '';
  if (scriptSource === 'cloud') {
    const sid = typeof inp.scriptId === 'string' ? inp.scriptId.trim() : '';
    const rid = typeof inp.revisionId === 'string' ? inp.revisionId.trim() : '';
    const jwt = typeof inp.contentJwt === 'string' ? inp.contentJwt.trim() : '';
    if (!sid || !rid || !jwt) {
      return { error: 'cloud 模式需 scriptId、revisionId、contentJwt', code: 'SCRIPT_CLOUD_BAD_INPUT' };
    }
    const fetched = await fetchScriptHubRevisionContent(sid, rid, jwt);
    if ('error' in fetched) return fetched;
    content = fetched.content;
  } else {
    content = typeof inp.content === 'string' ? inp.content : '';
  }
  if (!content.trim()) return { error: '缺少脚本正文 content', code: 'SCRIPT_NO_CONTENT' };

  const paramsJson = JSON.stringify(par);
  const paramsB64 = Buffer.from(paramsJson, 'utf8').toString('base64');
  const sourceB64 = Buffer.from(content, 'utf8').toString('base64');
  const wrapper = buildWrapperPython(paramsB64, sourceB64);

  const mayaIn = inp.maya && typeof inp.maya === 'object' && !Array.isArray(inp.maya) ? (inp.maya as Record<string, unknown>) : {};
  const host =
    typeof mayaIn.host === 'string' && mayaIn.host.trim()
      ? mayaIn.host.trim()
      : String(process.env.COMPANION_MAYA_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const portNum = Number(mayaIn.port ?? process.env.COMPANION_MAYA_PORT ?? 7001);
  const port = Number.isFinite(portNum) && portNum > 0 ? Math.floor(portNum) : 7001;
  const timeoutMsRaw = inp.timeoutMs ?? par.timeoutMs;
  const timeoutMs = Number(timeoutMsRaw);
  const budget = Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? Math.min(Math.floor(timeoutMs), 600_000) : 120_000;

  const tmp = join(tmpdir(), `script-hub-maya-${randomUUID()}.py`);
  try {
    writeFileSync(tmp, wrapper, 'utf8');
    const fp = forwardSlashes(tmp);
    const mel = `exec(open(r'${fp}').read())`;
    const stdout = await sendMayaCommand(host, port, mel, budget);
    return { ok: true, stdout };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg === 'MAYA_EXEC_TIMEOUT' ? 'MAYA_EXEC_TIMEOUT' : 'MAYA_RUNTIME_ERROR';
    return { error: msg, code };
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
