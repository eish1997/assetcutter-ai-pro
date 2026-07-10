import type { ProjectAgentToolId } from '../../../types/projectAgent';
// path: services/projectAgent/tools → repo types/

/** Shared tool typing helpers for Phase 1. */
export type ToolArgs = Record<string, unknown>;

export type ToolExecResult =
  | { ok: true; taskIds?: string[]; assetIds?: string[]; artifactIds?: string[]; message?: string }
  | { ok: false; errorMessage: string };

export type ToolExecutor = (args: ToolArgs) => Promise<ToolExecResult>;

export type ToolExecutorMap = Partial<Record<ProjectAgentToolId, ToolExecutor>>;
