import {
  getAdobeBridgeStatus,
  installAdobeBridge,
  uninstallAdobeBridge,
} from '../../bridges/adobeExtendScriptBridgeInstall.js';
import type { SoftwareBridgeDriver } from '../softwareBridgeDriver.js';
import { normalizeConnectionStrategy } from '../connectionStrategy.js';
import { bridgeProbeResult, targetDirsFromInput, textMatches } from './driverUtils.js';

export const photoshopBridgeDriver: SoftwareBridgeDriver = {
  id: 'photoshop',
  label: 'Photoshop',
  match: (input) => textMatches(input, /\bphotoshop\b|adobe photoshop|extendscript_heartbeat/),
  getStatus: () => getAdobeBridgeStatus('photoshop'),
  install: (input) => installAdobeBridge('photoshop', { scriptsDirs: targetDirsFromInput(input), port: input?.port }),
  probe: async () => {
    const status = await getAdobeBridgeStatus('photoshop');
    return bridgeProbeResult(status.probe, 'Photoshop probe failed.', 'photoshop');
  },
  uninstall: (input) => uninstallAdobeBridge('photoshop', { scriptsDirs: targetDirsFromInput(input) }),
  strategies: (input) => [
    normalizeConnectionStrategy({
      id: 'photoshop-script-folder',
      label: 'Photoshop 脚本目录',
      kind: 'script_folder',
      risk: 'medium',
      confidence: 0.82,
      status: 'verified',
      verified: true,
      requiresUserDirs: Array.isArray(input.manifest.candidateScriptDirs)
        ? input.manifest.candidateScriptDirs.map(String).filter(Boolean)
        : [],
      installPlan: {
        steps: [{ kind: 'write_script', description: '向 Photoshop Presets/Scripts 目录写入 AssetCutter ExtendScript。' }],
        expectedEvidence: ['AssetCutter Photoshop Bridge.jsx 写入记录'],
      },
      probePlan: {
        steps: [{ kind: 'heartbeat_file', description: '用户在 Photoshop 菜单运行脚本后读取新鲜 heartbeat。' }],
        expectedEvidence: ['Photoshop 脚本写入的新鲜 heartbeat'],
      },
      uninstallPlan: {
        steps: [{ kind: 'remove_written_files', description: '移除本策略写入的 Photoshop ExtendScript 文件。' }],
        expectedEvidence: ['写入记录和删除结果'],
      },
      safetyBoundary: ['heartbeat 必须由真实 Photoshop 脚本生成。', '不能把脚本文件存在当作 connected。'],
    }),
    normalizeConnectionStrategy({
      id: 'photoshop-heartbeat-file',
      label: 'Photoshop 心跳探测',
      kind: 'heartbeat_file',
      risk: 'low',
      confidence: 0.8,
      status: 'verified',
      verified: true,
      probePlan: {
        steps: [{ kind: 'heartbeat_file', description: '读取 Photoshop 连接脚本产生的新鲜 heartbeat。' }],
        expectedEvidence: ['host=photoshop 的新鲜 heartbeat'],
      },
      safetyBoundary: ['旧 heartbeat 不能冒充当前连接成功。'],
    }),
    normalizeConnectionStrategy({
      id: 'photoshop-extension-panel',
      label: 'Photoshop 扩展面板',
      kind: 'extension_panel',
      risk: 'medium',
      confidence: 0.35,
      status: 'planned',
      probePlan: {
        steps: [{ kind: 'extension_probe', description: '后续通过 Photoshop 扩展面板建立更稳定的双向连接。' }],
        expectedEvidence: ['扩展面板真实加载事件'],
      },
      safetyBoundary: ['未实现前不能显示为 verified。'],
    }),
  ],
};
