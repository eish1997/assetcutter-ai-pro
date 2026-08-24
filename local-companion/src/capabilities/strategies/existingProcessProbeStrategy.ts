import type { ConnectionStrategyProvider } from '../connectionStrategyRegistry.js';

export const existingProcessProbeStrategyProvider: ConnectionStrategyProvider = {
  id: 'existing-process-probe',
  label: 'Existing Process Probe',
  provide: ({ facts }) => {
    if (!facts.processName && !facts.executablePath) return [];
    return [
      {
        id: 'existing-process-probe',
        label: '识别已打开软件',
        kind: 'existing_process_probe',
        risk: 'low',
        confidence: facts.processName ? 0.7 : 0.45,
        installPlan: {
          steps: [{ kind: 'none', description: '不安装文件，只使用已收集到的进程或可执行文件事实。' }],
          expectedEvidence: ['进程名或可执行文件路径'],
        },
        probePlan: {
          steps: [{ kind: 'process_probe', description: '确认目标进程仍在运行，并尝试读取白名单 IPC 或本地响应。' }],
          expectedEvidence: ['运行中进程或本地响应'],
        },
        uninstallPlan: {
          steps: [{ kind: 'none', description: '该策略没有写入文件，无需卸载。' }],
          expectedEvidence: [],
        },
        safetyBoundary: ['不能把进程存在当作 connected。', '必须收到真实 host signal 才能通过 probe。'],
        evidence: facts.evidence,
      },
    ];
  },
};
