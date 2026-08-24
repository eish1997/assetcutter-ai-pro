import type { ConnectionStrategyProvider } from '../connectionStrategyRegistry.js';

export const enginePluginStrategyProvider: ConnectionStrategyProvider = {
  id: 'engine-plugin',
  label: 'Engine Plugin',
  provide: ({ facts }) =>
    facts.candidatePluginDirs
      .filter((dir) => /engine|editor|plugins|marketplace/i.test(dir))
      .map((dir) => ({
        id: `engine-plugin:${dir}`,
        label: '引擎插件',
        kind: 'engine_plugin',
        risk: 'high',
        confidence: 0.55,
        requiresUserDirs: [dir],
        installPlan: {
          steps: [{ kind: 'copy_plugin', target: dir, description: '只在用户确认后向引擎或编辑器插件目录写入连接插件。' }],
          expectedEvidence: ['引擎插件目录写入记录'],
        },
        probePlan: {
          steps: [{ kind: 'host_signal', description: '重启或打开软件后读取插件产生的真实连接信号。' }],
          expectedEvidence: ['真实软件加载插件后的探测信号'],
        },
        uninstallPlan: {
          steps: [{ kind: 'remove_written_files', target: dir, description: '只移除本策略写入的引擎插件文件。' }],
          expectedEvidence: ['写入记录和删除结果'],
        },
        safetyBoundary: ['引擎目录写入属于高风险，必须来自用户确认。', '不能跨版本批量写入。'],
        evidence: facts.evidence,
      })),
};
