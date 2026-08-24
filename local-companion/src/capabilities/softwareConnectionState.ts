import type { CapabilityPackage } from './capabilityPackages.js';
import { collectConnectionFacts } from './connectionDiscovery.js';
import type { ConnectionFacts } from './connectionFacts.js';
import {
  normalizeConnectionLocalVersions,
  type LocalSoftwareVersion,
} from './connectionLocalVersions.js';
import { resolveSoftwareBridgeDriver } from './softwareBridgeRegistry.js';

export type ConnectionMaturity =
  | 'draft'
  | 'discovery_pending'
  | 'exploring'
  | 'strategy_draft'
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
  facts?: ConnectionFacts;
};

export type ConnectionCardMaintenanceChip = {
  label: string;
  tone: 'neutral' | 'info' | 'ok' | 'warn' | 'bad';
};

export type ConnectionCardView = {
  id: string;
  name: string;
  statusLabel: string;
  currentLocalVersion: LocalSoftwareVersion | null;
  localVersions: LocalSoftwareVersion[];
  cloudVersionLabel?: string;
  nextActionLabel: string;
  maintenanceChips: ConnectionCardMaintenanceChip[];
  primaryActions: Array<'agent_loop' | 'launch' | 'probe' | 'publish'>;
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

function state(
  maturity: ConnectionMaturity,
  label: string,
  availableActions: string[],
  blockedReason: string,
  nextAction: string,
  publishEligible = false,
  facts?: ConnectionFacts,
): ConnectionState {
  return {
    maturity,
    label,
    availableActions: unique(availableActions),
    blockedReason,
    nextAction,
    publishEligible,
    ...(facts ? { facts } : {}),
  };
}

function hasUsefulFacts(facts: ConnectionFacts): boolean {
  return (
    Boolean(facts.inputPath || facts.shortcutPath || facts.executablePath || facts.processName) ||
    facts.candidateProjectDirs.length > 0 ||
    facts.candidateScriptDirs.length > 0 ||
    facts.candidatePluginDirs.length > 0 ||
    facts.candidateConfigDirs.length > 0 ||
    facts.detectedProtocols.length > 0 ||
    facts.evidence.length > 0
  );
}

function cloudVersionLabel(pkg: SoftwareConnectionPackageLike): string {
  const version = String(
    (pkg as unknown as Record<string, unknown>).cloudVersion ||
      (pkg as unknown as Record<string, unknown>).semverCloud ||
      pkg.version ||
      '',
  ).trim();
  return version ? `v${version.replace(/^v/i, '')}` : '';
}

function factChipLabel(facts: ConnectionFacts): string {
  const signals: string[] = [];
  if (facts.executablePath) signals.push('exe');
  if (facts.processName) signals.push('进程');
  if (facts.version) signals.push('版本');
  if (facts.candidateScriptDirs.length) signals.push(`脚本目录 ${facts.candidateScriptDirs.length}`);
  if (facts.candidatePluginDirs.length) signals.push(`插件目录 ${facts.candidatePluginDirs.length}`);
  if (signals.length) return `事实 ${signals.slice(0, 3).join(' / ')}`;
  return '';
}

function maintenanceChipsForState(stateValue: ConnectionState): ConnectionCardMaintenanceChip[] {
  const chips: ConnectionCardMaintenanceChip[] = [];
  const statusTone: ConnectionCardMaintenanceChip['tone'] =
    stateValue.maturity === 'connected'
      ? 'ok'
      : stateValue.maturity === 'probe_failed' || stateValue.maturity === 'needs_user_action'
        ? 'bad'
        : stateValue.maturity === 'bridge_installed' || stateValue.maturity === 'strategy_draft'
          ? 'warn'
          : 'neutral';
  chips.push({ label: stateValue.label, tone: statusTone });
  if (stateValue.facts) {
    const label = factChipLabel(stateValue.facts);
    if (label) chips.push({ label, tone: 'neutral' });
  }
  if (stateValue.publishEligible) {
    chips.push({ label: '可提交云端', tone: 'ok' });
  } else if (stateValue.blockedReason) {
    chips.push({ label: stateValue.blockedReason, tone: statusTone === 'bad' ? 'bad' : 'warn' });
  }
  return chips.slice(0, 3);
}

function primaryActionsForState(stateValue: ConnectionState): ConnectionCardView['primaryActions'] {
  const actions: ConnectionCardView['primaryActions'] = ['agent_loop'];
  if (stateValue.availableActions.includes('launch')) actions.push('launch');
  if (stateValue.availableActions.includes('probe')) actions.push('probe');
  if (stateValue.publishEligible) actions.push('publish');
  return actions.slice(0, 4);
}

export function deriveSoftwareConnectionState(pkg: SoftwareConnectionPackageLike): ConnectionState {
  if (!pkg || pkg.type !== 'software_connection') {
    return state(
      'draft',
      '未配置',
      BASE_ACTIONS,
      '这不是软件连接能力包。',
      '创建或选择一个软件连接。',
    );
  }

  const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
  const hostId = manifestValue(manifest, 'hostId') || manifestValue(manifest, 'softwareId');
  const facts = collectConnectionFacts(pkg);
  const supportedBridge = Boolean(resolveSoftwareBridgeDriver(pkg));

  if (recordOk(pkg.lastProbe)) {
    return state(
      'connected',
      '已连接',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...BRIDGE_ACTIONS],
      '',
      '已收到真实软件信号，可以继续对话优化或由管理员提交云端版本。',
      true,
      facts,
    );
  }

  if (recordFailed(pkg.lastProbe)) {
    return state(
      'probe_failed',
      '探测失败',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...(supportedBridge ? BRIDGE_ACTIONS : [])],
      '未收到真实软件连接信号。',
      '交给 Copilot 读取失败证据并继续修复，或在软件内运行连接入口后重新探测。',
      false,
      facts,
    );
  }

  if (recordOk(pkg.lastInstall)) {
    return state(
      'bridge_installed',
      '已安装待探测',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...BRIDGE_ACTIONS],
      '连接脚本或插件已安装，但还没有真实探测成功。',
      '打开或重启目标软件，运行连接入口，然后执行真实探测。',
      false,
      facts,
    );
  }

  if (supportedBridge) {
    return state(
      'bridge_supported',
      '可安装连接',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS, ...BRIDGE_ACTIONS],
      '',
      '安装连接脚本或插件，然后在软件内加载并探测真实信号。',
      false,
      facts,
    );
  }

  if (hostId) {
    return state(
      'strategy_draft',
      '策略草稿',
      [...BASE_ACTIONS, ...PROCESS_ACTIONS],
      '当前还没有 verified strategy。旧的 template_missing 只表示缺少已验证策略，不是连接终点。',
      '让 Copilot 基于 facts 生成候选连接策略，并从最低风险策略开始验证。',
      false,
      facts,
    );
  }

  if (hasUsefulFacts(facts)) {
    return state(
      'exploring',
      '正在探索连接方式',
      BASE_ACTIONS,
      '已收集到部分软件事实，但尚未确认真实连接方式。',
      '让 Copilot 读取 facts，生成候选策略草稿；不能把 exe 存在当作连接成功。',
      false,
      facts,
    );
  }

  return state(
    'discovery_pending',
    '等待探索',
    BASE_ACTIONS,
    '尚未记录可探索的软件事实。',
    '通过对话、拖入快捷方式、选择 exe 或识别运行中进程来收集 facts。',
    false,
    facts,
  );
}

export function attachSoftwareConnectionState<T extends CapabilityPackage>(
  pkg: T,
): T | (T & { connectionState: ConnectionState; connectionCardView: ConnectionCardView }) {
  if (!pkg || pkg.type !== 'software_connection') return pkg;
  return {
    ...pkg,
    connectionState: deriveSoftwareConnectionState(pkg as SoftwareConnectionPackageLike),
    connectionCardView: buildConnectionCardView(pkg as SoftwareConnectionPackageLike),
  };
}

export function buildConnectionCardView(pkg: SoftwareConnectionPackageLike): ConnectionCardView {
  const connectionState = deriveSoftwareConnectionState(pkg);
  const localVersionState = normalizeConnectionLocalVersions({
    name: pkg.name,
    appName: pkg.manifest?.appName,
    manifest: pkg.manifest,
  });
  const cloudLabel = cloudVersionLabel(pkg);
  return {
    id: pkg.id,
    name: pkg.name,
    statusLabel: connectionState.label,
    currentLocalVersion: localVersionState.currentLocalVersion,
    localVersions: localVersionState.localVersions,
    ...(cloudLabel ? { cloudVersionLabel: cloudLabel } : {}),
    nextActionLabel: connectionState.nextAction,
    maintenanceChips: maintenanceChipsForState(connectionState),
    primaryActions: primaryActionsForState(connectionState),
  };
}
