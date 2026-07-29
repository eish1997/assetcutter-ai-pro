import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';

const RUN_TIMEOUT_MS = 600000;

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function parsePort(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : 7001;
}

function sendMayaCommand(host, port, line, timeoutMs) {
  const payload = line.endsWith('\n') ? line : `${line}\n`;
  const connectOpts = host === '127.0.0.1' || host === 'localhost' ? { host, port, family: 4 } : { host, port };
  return new Promise((resolvePromise, reject) => {
    const sock = net.createConnection(connectOpts);
    const chunks = [];
    let settled = false;
    let idleTimer = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '');
      try {
        if (!sock.destroyed && !sock.writableEnded) sock.end();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolvePromise(text);
    };

    const timer = setTimeout(() => finish(new Error('Maya 执行超时')), timeoutMs);
    sock.once('connect', () => sock.write(payload));
    sock.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), 700);
    });
    sock.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    sock.on('close', () => finish());
  });
}

function buildMayaScript(params, packageRoot) {
  const paramsB64 = Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
  const root = packageRoot.replace(/\\/g, '/');
  return `
# -*- coding: utf-8 -*-
from __future__ import print_function
import base64 as _b64
import json as _json
import sys

_ROOT = ${JSON.stringify(root)}
_PARAMS = _json.loads(_b64.b64decode("${paramsB64}").decode("utf-8"))
if _ROOT in sys.path:
    sys.path.remove(_ROOT)
sys.path.insert(0, _ROOT)

def _print(msg):
    if sys.version_info[0] < 3:
        try:
            unicode_type = unicode
        except NameError:
            unicode_type = str
        try:
            if isinstance(msg, unicode_type):
                print(msg.encode("utf-8"))
            else:
                print(str(msg))
        except Exception:
            print(repr(msg))
    else:
        print(str(msg))

def _as_bool(value):
    return bool(value) and str(value).lower() not in ("0", "false", "no", "off")

from maya_export_models_fbx.core.exporter import export_models

_print(u"[FBX 单独导出] 使用本地壳参数开始执行")
result = export_models(
    output_dir=_PARAMS.get("outputDir") or "",
    source=_PARAMS.get("source") or "selection",
    name_mode=_PARAMS.get("nameMode") or "node",
    prefix=_PARAMS.get("prefix") or "",
    suffix=_PARAMS.get("suffix") or "",
    include_hidden=_as_bool(_PARAMS.get("includeHidden")),
    overwrite=_as_bool(_PARAMS.get("overwrite")),
)
_print(u"[FBX 单独导出] 已导出: %s/%s" % (result.get("count"), result.get("total")))
_print(u"[FBX 单独导出] 输出目录: %s" % result.get("outputDir"))
for path in result.get("exported") or []:
    _print(path)
if result.get("skipped"):
    _print(u"[FBX 单独导出] 已跳过已有文件: %s" % len(result.get("skipped")))
`;
}

async function main() {
  const host = env('TOOL_PARAM_MAYA_HOST', '127.0.0.1');
  const port = parsePort(env('TOOL_PARAM_MAYA_PORT', '7001'));
  const params = {
    mayaHost: host,
    mayaPort: String(port),
    outputDir: env('TOOL_PARAM_OUTPUT_DIR'),
    source: env('TOOL_PARAM_SOURCE', 'selection'),
    nameMode: env('TOOL_PARAM_NAME_MODE', 'node'),
    prefix: env('TOOL_PARAM_PREFIX'),
    suffix: env('TOOL_PARAM_SUFFIX'),
    includeHidden: env('TOOL_PARAM_INCLUDE_HIDDEN', '0'),
    overwrite: env('TOOL_PARAM_OVERWRITE', '1'),
  };
  const tmp = join(tmpdir(), `assetcutter-export-fbx-${randomUUID()}.py`);
  try {
    console.log(`正在连接 Maya Command Port：${host}:${port}`);
    writeFileSync(tmp, buildMayaScript(params, resolve('.')), 'utf8');
    const fp = tmp.replace(/\\/g, '/');
    const stdout = await sendMayaCommand(
      host,
      port,
      `exec(__import__('codecs').open(r'${fp}', 'r', 'utf-8').read())`,
      RUN_TIMEOUT_MS,
    );
    if (stdout.trim()) process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(`执行失败：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
