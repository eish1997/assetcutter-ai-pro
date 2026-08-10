import type { CapabilityPackage } from './capabilityPackages.js';

export type ConnectionMaturity =
  | 'draft'
  | 'path_ready'
  | 'process_ready'
  | 'bridge_supported'
  | 'bridge_installed'
  | 'probe_failed'
  | 'connected'
  | 'template_missing'
  | 'needs_user_action';

export type ConnectionState = {
  maturity: ConnectionMaturity;
  label: string;
  availableActions: string[];
  blockedReason: string;
  nextAction: string;
  publishEligible: boolean;
};

type SoftwareConnectionPackageLike = CapabilityPackage & {
  draftStatus?: string;
  lastInstall?: unknown;
  lastProbe?: unknown;
  events?: Array<{ kind?: string; ok?: boolean; message?: string }>;
};

const BASE_ACTIONS = ['agent_loop', 'conversation', 'export'];
const PROCESS_ACTIONS = ['discover_running', 'launch', 'close'];
const BRIDGE_ACTIONS = ['install', 'probe', 'uninstall'];

function recordOk(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && (record as Record<string, unknown>).ok === true);
}

function recordFailed(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && (record as Record<string, unknown>).ok === false);
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

function manifestValue(manifest: Record<string, unknown>, key: string): string {
  return String(manifest[key] || '').trim();
}

function hasSupportedBridgeTemplate(pkg: SoftwareConnectionPackageLike, manifest: Record<string, unknown>): boolean {
  const text = [pkg.id, pkg.name, manifestValue(manifest, 'appName'), manifestValue(manifest, 'hostId'), manifestValue(manifest, 'templateHint')]
    .join(' ')
    .toLowerCase();
  return /\bphotoshop\b|extendscript_heartbeat|\bblender\b|blender_http|blender_startup|python_http/.test(text);
}

function state(
  maturity: ConnectionMaturity,
  label: string,
  availableActions: string[],
  blockedReason: string,
  nextAction: string,
  publishEligible = false,
): ConnectionState {
  return {
    maturity,
    label,
    availableActions: unique(availableActions),
    blockedReason,
    nextAction,
    publishEligible,
  };
}

export function deriveSoftwareConnectionState(pkg: SoftwareConnectionPackageLike): ConnectionState {
  if (!pkg || pkg.type !== 'software_connection') {
    return state('draft', '未配置', BASE_ACTIONS, '这不是软件连接能力包。', '创建或选择一个软件连接。');
  }

  const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
  const hostId = manifestValue(manifest, 'hostId') || manifestValue(manifest, 'softwareId');
  const executablePath = manifestValue(manifest, 'executablePath');
  const shortcutPath = manifestValue(manifest, 'shortcutPath');
  const hasPath = Boolean(executablePath || shortcutPath || manifestValue(manifest, 'inputPath'));
  const supportedBridge = hasSupportedBridgeTemplate(pkg, manifest);

  if (recordOk(pkg.lastProbe)) {
    return state(
      'connected',
      '已连接',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...BRIDGE_ACTIONS],
      '',
      '已收到真实软件信号，可继续对话优化或由管理员提交云端版本。',
      true,
    );
  }

  if (recordFailed(pkg.lastProbe)) {
    return state(
      'probe_failed',
      '探测失败',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...(supportedBridge ? BRIDGE_ACTIONS : [])],
      '未收到真实软件连接信号。',
      '交给 Copilot 读取失败证据并继续修复，或在软件内运行连接入口后重新探测。',
    );
  }

  if (recordOk(pkg.lastInstall)) {
    return state(
      'bridge_installed',
      '已安装待探测',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...BRIDGE_ACTIONS],
      '连接脚本或插件已安装，但还没有真实探测成功。',
      '打开或重启目标软件，运行连接入口，然后执行真实探测。',
    );
  }

  if (supportedBridge) {
    return state(
      'bridge_supported',
      '可安装连接',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...BRIDGE_ACTIONS],
      '',
      '安装连接脚本或插件，然后在软件内加载并探测真实信号。',
    );
  }

  if (hostId) {
    return state(
      'template_missing',
      '模板待接入',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS],
      '当前软件还没有接入真实安装/探测模板。',
      '可先启动或识别运行中的软件；真实连接需要 Copilot 或开发者补齐模板。',
    );
  }

  if (hasPath) {
    return state(
      'path_ready',
      '已找到位置',
      BASE_ACTIONS,
      '已记录软件位置，但尚未确认软件类型和真实连接方式。',
      '交给 Copilot 识别软件、补齐 hostId 和真实探测方式。',
    );
  }

  return state(
    'draft',
    '草稿',
    BASE_ACTIONS,
    '尚未记录可启动路径、hostId 或真实连接模板。',
    '通过对话或拖入快捷方式补齐连接目标。',
  );
}
