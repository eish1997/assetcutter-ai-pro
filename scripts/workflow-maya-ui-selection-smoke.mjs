#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const companionBase = String(process.env.ASSETCUTTER_COMPANION_URL || 'http://127.0.0.1:18765').replace(/\/+$/, '');
const mayaHost = String(process.env.COMPANION_MAYA_HOST || '127.0.0.1').trim() || '127.0.0.1';
const mayaPort = parsePort(process.env.COMPANION_MAYA_PORT, 7001);
const workflowId = 'workflow.maya.export_selection_fbx';

function parsePort(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : fallback;
}

function pairingConfigPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return '';
  const sandbox = path.join(localAppData, 'AssetCutterCompanion', 'sandbox', 'desktop-shell', 'pairing-config.json');
  if (existsSync(sandbox)) return sandbox;
  const stable = path.join(localAppData, 'AssetCutterCompanion', 'desktop-shell', 'pairing-config.json');
  if (existsSync(stable)) return stable;
  return '';
}

function readPairingToken() {
  const p = pairingConfigPath();
  if (!p) return '';
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  return parsed && parsed.sharedToken ? String(parsed.sharedToken) : '';
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(text),
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendMayaCommand(line, budgetMs = 120000) {
  const payload = line.endsWith('\n') ? line : `${line}\n`;
  const connectOpts = mayaHost === '127.0.0.1' || mayaHost === 'localhost'
    ? { host: mayaHost, port: mayaPort, family: 4 }
    : { host: mayaHost, port: mayaPort };

  return new Promise((resolve, reject) => {
    const sock = net.createConnection(connectOpts);
    const chunks = [];
    let settled = false;
    let idleTimer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      const text = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '');
      try {
        if (!sock.destroyed && !sock.writableEnded) sock.end();
        if (!sock.destroyed) sock.unref();
      } catch {
        // ignore cleanup errors
      }
      if (error) reject(error);
      else resolve(text);
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), 500);
    };

    const timer = setTimeout(() => finish(new Error('MAYA_UI_COMMAND_TIMEOUT')), Math.max(1000, budgetMs));
    sock.once('connect', () => sock.write(payload));
    sock.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      armIdle();
    });
    sock.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    sock.on('close', () => finish());
  });
}

async function runMayaPython(source, budgetMs = 120000) {
  const scriptPath = path.join(tmpdir(), `ac-workflow-maya-ui-${randomUUID()}.py`);
  const resultPath = path.join(tmpdir(), `ac-workflow-maya-ui-result-${randomUUID()}.json`);
  const wrapped = [
    'from __future__ import print_function',
    'import json',
    'import traceback',
    `RESULT_PATH = ${JSON.stringify(resultPath.replace(/\\/g, '/'))}`,
    '_AC_RESULT = None',
    'try:',
    ...source.split(/\r?\n/).map((line) => `    ${line}`),
    '    with open(RESULT_PATH, "w") as _f:',
    '        _f.write(json.dumps(_AC_RESULT if _AC_RESULT is not None else {"ok": False, "error": "acceptance did not set a result"}))',
    'except Exception as exc:',
    '    with open(RESULT_PATH, "w") as _f:',
    '        _f.write(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}))',
  ].join('\n');
  writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const command = `exec(open(r'${scriptPath.replace(/\\/g, '/')}').read()) or open(r'${resultPath.replace(/\\/g, '/')}').read()`;
    const stdout = await sendMayaCommand(command, budgetMs);
    let parsed;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (error) {
      throw new Error(`Maya did not return acceptance JSON: ${stdout.slice(0, 500)}`);
    }
    if (!parsed.ok) throw new Error(parsed.error || 'Maya command failed');
    return parsed;
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {
      // ignore cleanup errors
    }
    try {
      unlinkSync(resultPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function queryMayaUiSelection() {
  return runMayaPython(`
import maya.cmds as cmds
selection = cmds.ls(selection=True, long=True) or []
_AC_RESULT = {
    "ok": True,
    "mode": "real_maya_ui_selection",
    "maya_version": cmds.about(version=True),
    "selection_count": len(selection),
    "selected_objects": selection,
}
`, 30000);
}

async function exportCurrentMayaUiSelection(outputPath, traceId) {
  return runMayaPython(`
import os
import maya.cmds as cmds
output_path = ${JSON.stringify(outputPath)}
selection = cmds.ls(selection=True, long=True) or []
if not selection:
    raise RuntimeError("Maya UI selection is empty. Select at least one object in Maya, then rerun this acceptance.")
os.makedirs(os.path.dirname(output_path), exist_ok=True)
try:
    cmds.loadPlugin("fbxmaya", quiet=True)
except Exception:
    pass
cmds.file(output_path, force=True, options="v=0;", type="FBX export", preserveReferences=True, exportSelected=True)
size = os.path.getsize(output_path)
_AC_RESULT = {
    "ok": True,
    "bytes": size,
    "exported_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "local_path": output_path,
    "maya_version": cmds.about(version=True),
    "selected_objects": selection,
    "selection_count": len(selection),
    "source_uri": "maya://ui/selection/current",
    "storage_uri": output_path,
    "trace_id": ${JSON.stringify(traceId || '')},
}
`, 120000);
}

function startConnector() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        const selection = await queryMayaUiSelection();
        json(res, 200, {
          ok: true,
          data: {
            maya_version: selection.maya_version,
            mode: selection.mode,
            selection_count: selection.selection_count,
          },
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/selection') {
        const selection = await queryMayaUiSelection();
        json(res, 200, {
          ok: true,
          data: {
            count: selection.selection_count,
            selected_objects: selection.selected_objects,
          },
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/export/fbx') {
        const body = await readBody(req);
        const outputPath = String(body.output_path || '').trim();
        if (!path.isAbsolute(outputPath)) {
          json(res, 400, { ok: false, error: { message: `Expected absolute output_path, got ${outputPath}` } });
          return;
        }
        if (existsSync(outputPath) && !body.overwrite) {
          json(res, 409, { ok: false, error: { message: `Output already exists: ${outputPath}` } });
          return;
        }
        const exported = await exportCurrentMayaUiSelection(outputPath, String(body.trace_id || ''));
        json(res, 200, {
          ok: true,
          data: {
            bytes: exported.bytes,
            exported_at: exported.exported_at,
            local_path: exported.local_path,
            selected_objects: exported.selected_objects,
            selection_count: exported.selection_count,
            source_uri: exported.source_uri,
            storage_uri: exported.storage_uri,
            trace_id: exported.trace_id,
          },
        });
        return;
      }
      json(res, 404, { ok: false, error: { message: 'not_found' } });
    } catch (error) {
      json(res, 500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('connector did not bind to a TCP port'));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function postJson(url, body) {
  const token = process.env.ASSETCUTTER_COMPANION_TOKEN || readPairingToken();
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return parsed;
}

async function main() {
  const selection = await queryMayaUiSelection();
  if (!selection.selection_count) {
    throw new Error('Maya UI selection is empty. Select at least one object in the open Maya UI, then run npm run workflow:maya-ui-selection-smoke again.');
  }

  const outputRoot = mkdtempSync(path.join(tmpdir(), 'ac-workflow-maya-ui-selection-'));
  const outputDir = path.join(outputRoot, 'exports').replace(/\\/g, '/');
  const fileName = `workflow_ui_selection_${Date.now()}`;
  const connector = await startConnector();
  try {
    const result = await postJson(`${companionBase}/v1/workflows/${encodeURIComponent(workflowId)}/run`, {
      baseUrl: connector.url,
      params: {
        file_name: fileName,
        output_dir: outputDir,
        overwrite: true,
      },
    });
    const run = result.result || {};
    const artifact = Array.isArray(run.artifacts) ? run.artifacts[0] : null;
    const outputPath = artifact && artifact.local_path ? artifact.local_path : path.join(outputDir, `${fileName}.fbx`);
    const bytes = statSync(outputPath).size;
    const report = {
      artifact_id: artifact && artifact.id,
      bytes,
      connector_url: connector.url,
      maya_host: mayaHost,
      maya_port: mayaPort,
      maya_version: selection.maya_version,
      output_path: outputPath,
      run_id: run.id,
      selected_objects: selection.selected_objects,
      selection_count: selection.selection_count,
      status: run.status,
      workflow_id: run.workflow_id,
    };
    console.log(JSON.stringify(report, null, 2));
    if (run.status !== 'succeeded' || bytes <= 0) {
      throw new Error(`Workflow Maya UI selection acceptance failed: ${JSON.stringify(report)}`);
    }
  } finally {
    await new Promise((resolve) => connector.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
