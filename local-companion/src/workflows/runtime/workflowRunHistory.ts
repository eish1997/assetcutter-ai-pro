import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkflowRun } from './workflowRuns.js';

const defaultHistoryPath = path.resolve('.assetcutter/workflow-runtime/workflow-runs.json');
let memoryRuns: WorkflowRun[] = [];

export function saveWorkflowRun(run: WorkflowRun, historyPath = defaultHistoryPath) {
  const runs = [
    run,
    ...listWorkflowRuns(historyPath).filter((item) => item.id !== run.id),
  ].slice(0, 20);

  memoryRuns = runs;
  persistRuns(runs, historyPath);
  return run;
}

export function listWorkflowRuns(historyPath = defaultHistoryPath) {
  if (!existsSync(historyPath)) return path.resolve(historyPath) === defaultHistoryPath ? memoryRuns : [];

  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf8')) as unknown;
    const runs = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.runs) ? parsed.runs : [];
    return runs as WorkflowRun[];
  } catch {
    return [];
  }
}

export function clearWorkflowRuns(historyPath = defaultHistoryPath) {
  memoryRuns = [];
  persistRuns([], historyPath);
}

function persistRuns(runs: WorkflowRun[], historyPath: string) {
  const dir = path.dirname(historyPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${historyPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ runs, saved_at: new Date().toISOString(), schema_version: 1 }, null, 2), 'utf8');
  renameSync(tmp, historyPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
