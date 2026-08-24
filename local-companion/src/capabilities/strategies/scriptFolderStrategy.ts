import type { ConnectionStrategyProvider } from '../connectionStrategyRegistry.js';

export const scriptFolderStrategyProvider: ConnectionStrategyProvider = {
  id: 'script-folder',
  label: 'Script Folder',
  provide: ({ facts }) =>
    facts.candidateScriptDirs.map((dir) => ({
      id: `script-folder:${dir}`,
      label: '脚本目录',
      kind: 'script_folder',
      risk: 'medium',
      confidence: 0.58,
      requiresUserDirs: [dir],
      installPlan: {
        steps: [{ kind: 'write_script', target: dir, description: '只向用户确认的脚本目录写入连接脚本。' }],
        expectedEvidence: ['脚本文件写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'heartbeat_file', description: '用户在软件内运行脚本后读取新鲜 heartbeat。' }],
        expectedEvidence: ['真实软件写入的新鲜 heartbeat'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', target: dir, description: '只移除本策略写入的脚本文件。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['脚本目录必须来自 facts 或用户确认。', 'heartbeat 必须由真实软件运行脚本产生。'],
      evidence: facts.evidence,
    })),
};
