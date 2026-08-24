import {
  getBlenderBridgeStatus,
  installBlenderBridge,
  uninstallBlenderBridge,
} from '../../bridges/blenderBridgeInstall.js';
import type { SoftwareBridgeDriver } from '../softwareBridgeDriver.js';
import { normalizeConnectionStrategy } from '../connectionStrategy.js';
import { bridgeProbeResult, targetDirsFromInput, textMatches } from './driverUtils.js';

export const blenderBridgeDriver: SoftwareBridgeDriver = {
  id: 'blender',
  label: 'Blender',
  match: (input) => textMatches(input, /\bblender\b|blender_http|blender_startup|python_http/),
  getStatus: (input) => getBlenderBridgeStatus({ startupDirs: targetDirsFromInput(input) }),
  install: (input) => installBlenderBridge({ startupDirs: targetDirsFromInput(input), port: input?.port }),
  probe: async (input) => {
    const status = await getBlenderBridgeStatus({ startupDirs: targetDirsFromInput(input) });
    return bridgeProbeResult(status.probe, 'Blender probe failed.', 'blender');
  },
  uninstall: (input) => uninstallBlenderBridge({ startupDirs: targetDirsFromInput(input) }),
  strategies: (input) => [
    normalizeConnectionStrategy({
      id: 'blender-startup-script',
      label: 'Blender 启动脚本',
      kind: 'startup_script',
      risk: 'medium',
      confidence: 0.84,
      status: 'verified',
      verified: true,
      requiresUserDirs: Array.isArray(input.manifest.candidateScriptDirs)
        ? input.manifest.candidateScriptDirs.map(String).filter(Boolean)
        : [],
      installPlan: {
        steps: [{ kind: 'write_script', description: '向 Blender scripts/startup 目录写入 AssetCutter 启动脚本。' }],
        expectedEvidence: ['startup 脚本写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'http_probe', description: 'Blender 加载启动脚本后读取本机 HTTP health。' }],
        expectedEvidence: ['Blender bridge HTTP health 返回 ok'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', description: '移除本策略写入的 Blender startup 脚本。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['启动脚本必须由真实 Blender 加载后才能 probe 成功。'],
    }),
    normalizeConnectionStrategy({
      id: 'blender-http-probe',
      label: 'Blender HTTP 探测',
      kind: 'http_probe',
      risk: 'low',
      confidence: 0.8,
      status: 'verified',
      verified: true,
      probePlan: {
        steps: [{ kind: 'http_probe', description: '读取 Blender bridge 的本机 /health。' }],
        expectedEvidence: ['host=blender 的本机 HTTP health'],
      },
      safetyBoundary: ['端口打开但没有 Blender host 响应不能算 connected。'],
    }),
    normalizeConnectionStrategy({
      id: 'blender-existing-process',
      label: '识别已打开 Blender',
      kind: 'existing_process_probe',
      risk: 'low',
      confidence: 0.45,
      status: 'planned',
      probePlan: {
        steps: [{ kind: 'process_probe', description: '识别运行中的 Blender 进程作为候选事实。' }],
        expectedEvidence: ['blender.exe 运行路径'],
      },
      safetyBoundary: ['进程存在只作为 facts，不能直接 connected。'],
    }),
  ],
};
