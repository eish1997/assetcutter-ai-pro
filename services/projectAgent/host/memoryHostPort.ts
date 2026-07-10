import type { WorkflowPendingTask } from '../../../types';
import type {
  AgentArtifactDraft,
  AgentSurfaceContext,
  ProjectAgentHostPort,
  ProjectAgentHostQueueSnapshot,
  PromoteTarget,
} from '../../../types/projectAgent';

export type MemoryHostPortOptions = {
  surface?: AgentSurfaceContext;
  assetLabels?: Record<string, { previewSrc?: string; label?: string }>;
};

/**
 * In-memory HostPort for unit tests (§16.6). No WorkflowSection.
 */
export function createMemoryHostPort(options: MemoryHostPortOptions = {}): ProjectAgentHostPort & {
  _pending: WorkflowPendingTask[];
  _artifacts: Map<string, AgentArtifactDraft>;
} {
  const pending: WorkflowPendingTask[] = [];
  const executing: WorkflowPendingTask[] = [];
  const assetErrors: Record<string, string> = {};
  const artifacts = new Map<string, AgentArtifactDraft>();
  let artifactSeq = 0;

  const port: ProjectAgentHostPort & {
    _pending: WorkflowPendingTask[];
    _artifacts: Map<string, AgentArtifactDraft>;
  } = {
    _pending: pending,
    _artifacts: artifacts,
    enqueueTasks(tasks: WorkflowPendingTask[]): string[] {
      const ids: string[] = [];
      for (const t of tasks) {
        const id =
          typeof (t as { id?: string }).id === 'string' && (t as { id?: string }).id!.trim()
            ? (t as { id: string }).id
            : `mem-task-${pending.length + 1}`;
        pending.push({ ...t, id } as WorkflowPendingTask);
        ids.push(id);
      }
      return ids;
    },
    getQueueSnapshot(): ProjectAgentHostQueueSnapshot {
      return {
        pending: [...pending],
        executing: [...executing],
        assetErrors: { ...assetErrors },
      };
    },
    resolveAssetDisplay(assetId: string) {
      return options.assetLabels?.[assetId] ?? { label: assetId };
    },
    reportSurfaceContext: () => options.surface ?? { kind: 'none' },
    executePlan(_intent, plan) {
      const taskIds = plan.map((_, i) => `mem-plan-task-${i + 1}`);
      for (const id of taskIds) {
        pending.push({ id } as WorkflowPendingTask);
      }
      return { taskIds };
    },
    emitArtifact(a: AgentArtifactDraft): string {
      artifactSeq += 1;
      const id = `mem-art-${artifactSeq}`;
      artifacts.set(id, a);
      return id;
    },
    async promoteArtifact(
      artifactId: string,
      _target: PromoteTarget
    ): Promise<{ ok: boolean; id?: string }> {
      if (!artifacts.has(artifactId)) return { ok: false };
      return { ok: true, id: `mem-preset-${artifactId}` };
    },
  };

  return port;
}
