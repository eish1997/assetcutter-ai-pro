import {
  getMayaBridgeStatus,
  installMayaBridge,
  uninstallMayaBridge,
} from '../../bridges/mayaBridgeInstall.js';
import { buildScriptConnectorsPayload } from '../../scriptRun/scriptConnectorsSnapshot.js';
import type { SoftwareBridgeDriver, SoftwareBridgeLifecycleResult } from '../softwareBridgeDriver.js';
import { normalizeConnectionStrategy } from '../connectionStrategy.js';
import { targetDirsFromInput, textMatches } from './driverUtils.js';

async function probeMayaCommandPort(port?: number): Promise<SoftwareBridgeLifecycleResult> {
  const status = getMayaBridgeStatus();
  const payload = await buildScriptConnectorsPayload({
    mayaHost: '127.0.0.1',
    mayaPort: port || status.port || status.defaultPort,
    bustCache: true,
  });
  const connector = payload.connectors.find((item) => item.targetType === 'maya' || item.id.includes('maya')) || null;
  if (!connector) return { ok: false, error: 'probe_failed', message: 'Maya connector probe returned no Maya connector.', softwareId: 'maya' };
  return connector.status === 'ok'
    ? { ok: true, message: connector.message, status: connector.status, host: connector.host, port: connector.port, softwareId: 'maya' }
    : { ok: false, error: 'probe_failed', message: connector.message, status: connector.status, host: connector.host, port: connector.port, softwareId: 'maya' };
}

export const mayaBridgeDriver: SoftwareBridgeDriver = {
  id: 'maya',
  label: 'Maya',
  match: (input) => textMatches(input, /\bmaya\b|maya_command_port|command port/),
  getStatus: (input) => getMayaBridgeStatus({ extraScriptsDirs: targetDirsFromInput(input) }),
  install: (input) => installMayaBridge({ scriptsDirs: targetDirsFromInput(input), port: input?.port }),
  probe: (input) => probeMayaCommandPort(input?.port),
  uninstall: (input) => uninstallMayaBridge({ scriptsDirs: targetDirsFromInput(input) }),
  strategies: (input) => [
    normalizeConnectionStrategy({
      id: 'maya-script-folder',
      label: 'Maya 脚本目录',
      kind: 'script_folder',
      risk: 'medium',
      confidence: 0.82,
      status: 'verified',
      verified: true,
      requiresUserDirs: Array.isArray(input.manifest.candidateScriptDirs)
        ? input.manifest.candidateScriptDirs.map(String).filter(Boolean)
        : [],
      installPlan: {
        steps: [{ kind: 'write_script', description: '向 Maya scripts 目录写入 AssetCutter bridge 脚本。' }],
        expectedEvidence: ['Maya bridge 脚本写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'command_port', description: 'Maya 启动并加载脚本后通过 command port 获取真实响应。' }],
        expectedEvidence: ['Maya command port 返回 host 响应'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', description: '移除本策略写入的 Maya bridge 脚本和 userSetup 标记。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['command port 必须来自真实 Maya 响应。'],
    }),
    normalizeConnectionStrategy({
      id: 'maya-command-port',
      label: 'Maya 命令端口',
      kind: 'command_port',
      risk: 'low',
      confidence: 0.8,
      status: 'verified',
      verified: true,
      probePlan: {
        steps: [{ kind: 'command_port', description: '通过白名单本机 command port 读取 Maya 连接状态。' }],
        expectedEvidence: ['Maya connector status=ok'],
      },
      safetyBoundary: ['端口必须绑定本机，命令必须走白名单。'],
    }),
    normalizeConnectionStrategy({
      id: 'maya-existing-process',
      label: '识别已打开 Maya',
      kind: 'existing_process_probe',
      risk: 'low',
      confidence: 0.45,
      status: 'planned',
      probePlan: {
        steps: [{ kind: 'process_probe', description: '识别运行中的 Maya 进程作为候选事实。' }],
        expectedEvidence: ['maya.exe 运行路径'],
      },
      safetyBoundary: ['进程存在只作为 facts，不能直接 connected。'],
    }),
  ],
};
