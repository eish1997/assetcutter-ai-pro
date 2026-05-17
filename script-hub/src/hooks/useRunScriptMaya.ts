import { useCallback } from 'react';
import {
  createScriptRun,
  getRevisionContent,
  issueRevisionContentToken,
  patchScriptRun,
} from '../services/scriptHubApi';
import {
  formatMayaJobStatus,
  submitScriptMayaJob,
  waitForComputeJob,
} from '../services/companionJobs';
import { useScriptHubPrefs } from '../context/ScriptHubPrefsContext';

export type RunScriptMayaInput = {
  scriptId: string;
  revisionId: string;
  params: Record<string, unknown>;
  /** 详情页可传内联正文；列表页走 cloud JWT 或按需拉取 */
  content?: string;
  onProgress?: (label: string) => void;
};

export type RunScriptMayaResult =
  | { ok: true; log: string; runId: string }
  | { ok: false; error: string; runId?: string };

export function useRunScriptMaya() {
  const { mayaHost, mayaPort, saveLastParams } = useScriptHubPrefs();

  const runScriptMaya = useCallback(
    async (input: RunScriptMayaInput): Promise<RunScriptMayaResult> => {
      const t0 = Date.now();
      let runId: string | null = null;
      const progress = (label: string) => input.onProgress?.(label);

      try {
        progress('正在登记执行记录…');
        const { run } = await createScriptRun({
          scriptId: input.scriptId,
          revisionId: input.revisionId,
          targetType: 'maya',
          params: input.params,
        });
        runId = run.id;

        let inlineContent = typeof input.content === 'string' ? input.content : '';
        if (!inlineContent.trim()) {
          try {
            const rev = await getRevisionContent(input.scriptId, input.revisionId);
            inlineContent = rev.content;
          } catch {
            /* cloud-only */
          }
        }

        let mayaPayload:
          | {
              content: string;
              params: Record<string, unknown>;
              mayaHost: string;
              mayaPort: number;
              timeoutMs: number;
            }
          | {
              scriptSource: 'cloud';
              scriptId: string;
              revisionId: string;
              contentJwt: string;
              params: Record<string, unknown>;
              mayaHost: string;
              mayaPort: number;
              timeoutMs: number;
            } = {
          content: inlineContent,
          params: input.params,
          mayaHost,
          mayaPort,
          timeoutMs: 120_000,
        };

        try {
          const { token } = await issueRevisionContentToken(input.scriptId, input.revisionId);
          if (token) {
            mayaPayload = {
              scriptSource: 'cloud',
              scriptId: input.scriptId,
              revisionId: input.revisionId,
              contentJwt: token,
              params: input.params,
              mayaHost,
              mayaPort,
              timeoutMs: 120_000,
            };
          }
        } catch {
          /* JWT 不可用时回退内联 content */
        }

        progress('正在提交本机伴侣…');
        const { jobId, status: submitStatus } = await submitScriptMayaJob(mayaPayload);
        await patchScriptRun(runId, { status: 'running', companionJobId: jobId });
        progress(`${formatMayaJobStatus(submitStatus)}（${jobId.slice(0, 8)}…）`);

        const terminal = await waitForComputeJob(jobId, {
          timeoutMs: 130_000,
          onStatus: (job) => progress(`${formatMayaJobStatus(job.status)}（${jobId.slice(0, 8)}…）`),
        });

        if (terminal.status === 'failed' || terminal.status === 'cancelled') {
          throw new Error(terminal.error?.message || terminal.error?.code || '执行失败');
        }

        const note = terminal.result?.note || '完成';
        await patchScriptRun(runId, {
          status: 'completed',
          exitCode: 0,
          durationMs: Date.now() - t0,
          logExcerpt: note,
        });
        await saveLastParams(input.scriptId, input.params, input.revisionId);
        return { ok: true, log: note, runId };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (runId) {
          try {
            await patchScriptRun(runId, {
              status: 'failed',
              errorCode: 'SCRIPT_HUB_MAYA_RUN',
              errorMessage: msg,
              durationMs: Date.now() - t0,
            });
          } catch {
            /* ignore */
          }
        }
        return { ok: false, error: msg, ...(runId ? { runId } : {}) };
      }
    },
    [mayaHost, mayaPort, saveLastParams],
  );

  return { runScriptMaya, mayaHost, mayaPort };
}
