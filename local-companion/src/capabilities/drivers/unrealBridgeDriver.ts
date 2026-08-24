import {
  getUnrealBridgeStatus,
  installUnrealBridge,
  uninstallUnrealBridge,
} from '../../bridges/unrealBridgeInstall.js';
import type { SoftwareBridgeDriver } from '../softwareBridgeDriver.js';
import { normalizeConnectionStrategy } from '../connectionStrategy.js';
import { bridgeProbeResult, targetDirsFromInput, textMatches } from './driverUtils.js';

export const unrealBridgeDriver: SoftwareBridgeDriver = {
  id: 'unreal',
  label: 'Unreal',
  match: (input) => textMatches(input, /\bunreal\b|unreal_http|unreal_python|project plugin/),
  getStatus: (input) => getUnrealBridgeStatus({ projectDirs: targetDirsFromInput(input) }),
  install: (input) => installUnrealBridge({ projectDirs: targetDirsFromInput(input), port: input?.port }),
  probe: async (input) => {
    const status = await getUnrealBridgeStatus({ projectDirs: targetDirsFromInput(input) });
    return bridgeProbeResult(status.probe, 'Unreal probe failed.', 'unreal');
  },
  uninstall: (input) => uninstallUnrealBridge({ projectDirs: targetDirsFromInput(input) }),
  strategies: (input) => [
    normalizeConnectionStrategy({
      id: 'unreal-project-plugin',
      label: 'Unreal 项目插件',
      kind: 'project_plugin',
      risk: 'medium',
      confidence: 0.86,
      status: 'verified',
      verified: true,
      requiresUserDirs: Array.isArray(input.manifest.candidateProjectDirs)
        ? input.manifest.candidateProjectDirs.map(String).filter(Boolean)
        : [],
      installPlan: {
        steps: [{ kind: 'copy_plugin', description: '向用户选择的 Unreal 项目 Plugins 目录写入 AssetCutterBridge。' }],
        expectedEvidence: ['项目目录包含 .uproject', 'AssetCutterBridge.uplugin 写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'http_probe', description: '项目打开并加载插件后，读取本机 Unreal bridge /health。' }],
        expectedEvidence: ['Unreal bridge HTTP health 返回 ok'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', description: '移除项目目录内本策略写入的 AssetCutterBridge 文件。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['只写入用户选择的项目目录。', '插件加载并真实 probe 成功前不能标记 connected。'],
    }),
    normalizeConnectionStrategy({
      id: 'unreal-engine-plugin',
      label: 'Unreal 引擎插件',
      kind: 'engine_plugin',
      risk: 'high',
      confidence: 0.78,
      status: 'verified',
      verified: true,
      requiresUserDirs: Array.isArray(input.manifest.candidatePluginDirs)
        ? input.manifest.candidatePluginDirs.map(String).filter(Boolean)
        : [],
      installPlan: {
        steps: [{ kind: 'copy_plugin', description: '向用户确认的 Unreal Engine Plugins/Marketplace 目录写入 AssetCutterBridge。' }],
        expectedEvidence: ['引擎目录包含 UnrealEditor.exe 或 UE4Editor.exe', 'AssetCutterBridge.uplugin 写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'http_probe', description: '重启 Unreal 并加载插件后，读取本机 Unreal bridge /health。' }],
        expectedEvidence: ['Unreal bridge HTTP health 返回 ok'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', description: '移除引擎目录内本策略写入的 AssetCutterBridge 文件。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['引擎目录写入必须来自用户明确选择。', '不能要求用户必须提供项目文件夹。'],
    }),
  ],
};
