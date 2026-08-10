#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const companionBase = String(process.env.ASSETCUTTER_COMPANION_URL || 'http://127.0.0.1:18765').replace(/\/+$/, '');
const mayapyCandidates = [
  process.env.MAYA_MAYAPY,
  'C:/Program Files/Autodesk/Maya2022/bin/mayapy.exe',
  'D:/Program Files/Autodesk/Maya2022/bin/mayapy.exe',
  'C:/Program Files/Autodesk/Maya2018/bin/mayapy.exe',
].filter(Boolean).map((item) => String(item));
const mayapyPath = mayapyCandidates.find((item) => existsSync(item)) || mayapyCandidates[0];
const workflowId = 'workflow.maya.export_selection_fbx';

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

function runMayapyExport(outputPath) {
  const pyPath = path.join(mkdtempSync(path.join(tmpdir(), 'ac-maya-real-smoke-script-')), 'export_selection.py');
  writeFileSync(pyPath, `
from __future__ import print_function
import json
import os
import sys

output_path = sys.argv[1]
os.makedirs(os.path.dirname(output_path))

import maya.standalone
maya.standalone.initialize(name='python')
import maya.cmds as cmds

cmds.file(new=True, force=True)
cube = cmds.polyCube(name='AssetCutter_Workflow_RealSmoke_Cube')[0]
cmds.select(cube, replace=True)
try:
    cmds.loadPlugin('fbxmaya', quiet=True)
except Exception:
    pass
cmds.file(output_path, force=True, options='v=0;', type='FBX export', preserveReferences=True, exportSelected=True)
size = os.path.getsize(output_path)
print(json.dumps({
    'ok': True,
    'bytes': size,
    'output_path': output_path,
    'selected_objects': [cube],
}))
maya.standalone.uninitialize()
`, 'utf8');

  return new Promise((resolve, reject) => {
    const child = spawn(mayapyPath, [pyPath, outputPath], {
      windowsHide: true,
      timeout: 120000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`mayapy exited ${code}: ${stderr || stdout}`));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).reverse().find((item) => item.trim().startsWith('{'));
      if (!line) {
        reject(new Error(`mayapy did not return JSON: ${stdout || stderr}`));
        return;
      }
      resolve(JSON.parse(line));
    });
  });
}

function startConnector(outputRoot) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { ok: true, data: { mode: 'real_maya_mayapy', mayapy_path: mayapyPath } });
        return;
      }
      if (req.method === 'GET' && req.url === '/selection') {
        json(res, 200, { ok: true, data: { count: 1, selected_objects: ['AssetCutter_Workflow_RealSmoke_Cube'] } });
        return;
      }
      if (req.method === 'POST' && req.url === '/export/fbx') {
        const body = await readBody(req);
        const rawOutputPath = String(body.output_path || '').trim();
        const outputPath = path.isAbsolute(rawOutputPath)
          ? rawOutputPath
          : path.join(outputRoot, rawOutputPath.replace(/^project:[/\\]+/i, '').replace(/^[/\\]+/, ''));
        const result = await runMayapyExport(outputPath);
        json(res, 200, {
          ok: true,
          data: {
            bytes: result.bytes,
            exported_at: new Date().toISOString(),
            local_path: outputPath,
            selected_objects: result.selected_objects,
            selection_count: result.selected_objects.length,
            source_uri: 'maya://selection/current',
            storage_uri: outputPath,
            trace_id: body.trace_id,
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
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return parsed;
}

async function main() {
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'ac-workflow-maya-real-'));
  const outputDir = path.join(outputRoot, 'exports').replace(/\\/g, '/');
  const fileName = `workflow_real_${Date.now()}`;
  const connector = await startConnector(outputRoot);
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
      mayapy_path: mayapyPath,
      output_path: outputPath,
      run_id: run.id,
      status: run.status,
      workflow_id: run.workflow_id,
    };
    console.log(JSON.stringify(report, null, 2));
    if (run.status !== 'succeeded' || bytes <= 0) {
      throw new Error(`Workflow real smoke failed: ${JSON.stringify(report)}`);
    }
  } finally {
    await new Promise((resolve) => connector.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
