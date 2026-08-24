import type { ConnectionStrategyProvider } from '../connectionStrategyRegistry.js';

export const projectPluginStrategyProvider: ConnectionStrategyProvider = {
  id: 'project-plugin',
  label: 'Project Plugin',
  provide: ({ facts }) =>
    facts.candidateProjectDirs.map((dir) => ({
      id: `project-plugin:${dir}`,
      label: '项目插件',
      kind: 'project_plugin',
      risk: 'medium',
      confidence: 0.62,
      requiresUserDirs: [dir],
      installPlan: {
        steps: [{ kind: 'copy_plugin', target: dir, description: '只向用户确认的项目目录写入连接插件。' }],
        expectedEvidence: ['项目目录内的插件文件和写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'host_signal', description: '打开该项目后读取插件产生的真实信号。' }],
        expectedEvidence: ['插件运行后产生的 heartbeat、HTTP health 或 host 回调'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', target: dir, description: '只移除本策略写入的项目插件文件。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['只写入用户确认的项目目录。', '插件未被真实软件加载前不能标记 connected。'],
      evidence: facts.evidence,
    })),
};
