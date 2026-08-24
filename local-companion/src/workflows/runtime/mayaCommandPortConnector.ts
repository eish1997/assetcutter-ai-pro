import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ExternalMayaConnectorExportResult,
  ExternalMayaConnectorSyncStatus,
} from './mayaConnectorHttpActivity.js';

const defaultOutputRoot = path.resolve('.assetcutter/workflow-runtime');

export type MayaCommandPortTarget = {
  host: string;
  port: number;
};

export function getDefaultMayaCommandPortTarget(override?: Partial<MayaCommandPortTarget>): MayaCommandPortTarget {
  const host = String(override?.host || process.env.COMPANION_MAYA_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const portRaw = Number(override?.port ?? process.env.COMPANION_MAYA_PORT ?? 7001);
  const port = Number.isFinite(portRaw) && portRaw > 0 && portRaw < 65536 ? Math.floor(portRaw) : 7001;
  return { host, port };
}

export async function checkMayaCommandPortConnector(target?: Partial<MayaCommandPortTarget>): Promise<ExternalMayaConnectorSyncStatus> {
  const checkedAt = new Date().toISOString();
  const resolved = getDefaultMayaCommandPortTarget(target);
  try {
    const selection = await queryMayaSelection(resolved);
    return {
      lastCheckedAt: checkedAt,
      mode: 'command_port',
      selectionCount: selection.selectionCount,
      state: 'connected',
    };
  } catch (error) {
    return {
      lastCheckedAt: checkedAt,
      lastError: error instanceof Error ? error.message : String(error),
      mode: 'command_port',
      state: 'offline',
    };
  }
}

export async function exportMayaCommandPortFbx(input: {
  output_path: string;
  overwrite: boolean;
  target?: Partial<MayaCommandPortTarget>;
  trace_id?: string;
}): Promise<ExternalMayaConnectorExportResult> {
  try {
    const outputPath = resolveWorkflowOutputPath(input.output_path);
    if (existsSync(outputPath) && !input.overwrite) {
      return {
        error: {
          message: `Output already exists: ${input.output_path}`,
        },
        ok: false,
      };
    }
    const exported = await exportCurrentMayaSelection(outputPath, input.trace_id, getDefaultMayaCommandPortTarget(input.target));
    return {
      data: {
        bytes: exported.bytes,
        exportedAt: exported.exportedAt,
        localPath: exported.localPath,
        selectedObjects: exported.selectedObjects,
        selectionCount: exported.selectionCount,
        sourceUri: 'maya://ui/selection/current',
        storageUri: input.output_path,
        traceId: input.trace_id,
      },
      ok: true,
    };
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
    };
  }
}

async function queryMayaSelection(target: MayaCommandPortTarget) {
  const result = await runMayaPython(`
import maya.cmds as cmds
selection = cmds.ls(selection=True, long=True) or []
_AC_RESULT = {
    "ok": True,
    "maya_version": cmds.about(version=True),
    "selection_count": len(selection),
    "selected_objects": selection,
}
`, 30000, target);
  return {
    mayaVersion: getStringField(result, 'maya_version') ?? '',
    selectedObjects: getStringArrayField(result, 'selected_objects'),
    selectionCount: getNumberField(result, 'selection_count') ?? 0,
  };
}

async function exportCurrentMayaSelection(outputPath: string, traceId: string | undefined, target: MayaCommandPortTarget) {
  const result = await runMayaPython(`
import os
import maya.cmds as cmds
output_path = ${JSON.stringify(outputPath.replace(/\\/g, '/'))}
selection = cmds.ls(selection=True, long=True) or []
if not selection:
    raise RuntimeError("Maya UI selection is empty. Select at least one object in Maya, then run the Workflow again.")
os.makedirs(os.path.dirname(output_path), exist_ok=True)
try:
    cmds.loadPlugin("fbxmaya", quiet=True)
except Exception:
    pass
cmds.file(output_path, force=True, options="v=0;", type="FBX export", preserveReferences=True, exportSelected=True)
_AC_RESULT = {
    "ok": True,
    "bytes": os.path.getsize(output_path),
    "exported_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "local_path": output_path,
    "selected_objects": selection,
    "selection_count": len(selection),
    "trace_id": ${JSON.stringify(traceId || '')},
}
`, 120000, target);
  return {
    bytes: getNumberField(result, 'bytes') ?? 0,
    exportedAt: getStringField(result, 'exported_at') ?? new Date().toISOString(),
    localPath: getStringField(result, 'local_path') ?? outputPath,
    selectedObjects: getStringArrayField(result, 'selected_objects'),
    selectionCount: getNumberField(result, 'selection_count') ?? 0,
  };
}

async function runMayaPython(source: string, budgetMs: number, target: MayaCommandPortTarget): Promise<Record<string, unknown>> {
  const scriptPath = path.join(tmpdir(), `assetcutter-workflow-maya-${randomUUID()}.py`);
  const resultPath = path.join(tmpdir(), `assetcutter-workflow-maya-result-${randomUUID()}.json`);
  const wrapped = [
    'from __future__ import print_function',
    'import json',
    'import traceback',
    `RESULT_PATH = ${JSON.stringify(resultPath.replace(/\\/g, '/'))}`,
    '_AC_RESULT = None',
    'try:',
    ...source.split(/\r?\n/).map((line) => `    ${line}`),
    '    with open(RESULT_PATH, "w") as _f:',
    '        _f.write(json.dumps(_AC_RESULT if _AC_RESULT is not None else {"ok": False, "error": "workflow did not set a result"}))',
    'except Exception as exc:',
    '    with open(RESULT_PATH, "w") as _f:',
    '        _f.write(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}))',
  ].join('\n');
  writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const command = `exec(open(r'${scriptPath.replace(/\\/g, '/')}').read()) or open(r'${resultPath.replace(/\\/g, '/')}').read()`;
    const stdout = await sendMayaCommand(command, budgetMs, target);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout.trim() || '{}') as Record<string, unknown>;
    } catch {
      throw new Error(`Maya did not return Workflow JSON: ${stdout.slice(0, 500)}`);
    }
    if (!parsed.ok) throw new Error(getStringField(parsed, 'error') ?? 'Maya Workflow command failed');
    return parsed;
  } finally {
    safeUnlink(scriptPath);
    safeUnlink(resultPath);
  }
}

function sendMayaCommand(line: string, budgetMs: number, target: MayaCommandPortTarget): Promise<string> {
  const { host, port } = target;
  const payload = line.endsWith('\n') ? line : `${line}\n`;
  const connectOpts: net.NetConnectOpts =
    host === '127.0.0.1' || host === 'localhost' ? { host, port, family: 4 } : { host, port };

  return new Promise((resolve, reject) => {
    const sock = net.createConnection(connectOpts);
    const chunks: Buffer[] = [];
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => finish(new Error('MAYA_WORKFLOW_COMMAND_TIMEOUT')), Math.max(1000, budgetMs));

    function finish(error?: Error) {
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
    }

    function armIdleFinish() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), 500);
    }

    sock.once('connect', () => sock.write(payload));
    sock.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      armIdleFinish();
    });
    sock.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    sock.on('close', () => finish());
  });
}

function resolveWorkflowOutputPath(outputPath: string) {
  if (path.isAbsolute(outputPath)) return path.resolve(outputPath);
  if (outputPath.startsWith('project://')) {
    return path.resolve(defaultOutputRoot, outputPath.slice('project://'.length).replace(/^[/\\]+/, ''));
  }
  if (outputPath.startsWith('file://')) {
    return path.resolve(fileURLToPath(outputPath));
  }
  return path.resolve(defaultOutputRoot, outputPath.replace(/^[/\\]+/, ''));
}

function safeUnlink(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

function getStringField(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(record: unknown, key: string) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function getStringArrayField(record: unknown, key: string) {
  if (!isRecord(record)) return [];
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
