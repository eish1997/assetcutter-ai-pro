import type { CapabilityPackage } from './capabilityPackages.js';
import type { ConnectionFacts } from './connectionFacts.js';
import {
  normalizeConnectionStrategy,
  type ConnectionStrategy,
  type ConnectionStrategyInput,
} from './connectionStrategy.js';
import { enginePluginStrategyProvider } from './strategies/enginePluginStrategy.js';
import { existingProcessProbeStrategyProvider } from './strategies/existingProcessProbeStrategy.js';
import { projectPluginStrategyProvider } from './strategies/projectPluginStrategy.js';
import { scriptFolderStrategyProvider } from './strategies/scriptFolderStrategy.js';

export type ConnectionStrategyProviderInput = {
  facts: ConnectionFacts;
  package?: CapabilityPackage;
};

export type ConnectionStrategyProvider = {
  id: string;
  label: string;
  provide(input: ConnectionStrategyProviderInput): ConnectionStrategyInput[];
};

const providers = new Map<string, ConnectionStrategyProvider>();

function fallbackManualStrategy(input: ConnectionStrategyProviderInput): ConnectionStrategyInput {
  return {
    id: 'manual-bridge-script',
    label: '手动桥接脚本',
    kind: 'manual_bridge_script',
    risk: 'medium',
    confidence: Math.max(0.1, Math.min(0.45, input.facts.confidence)),
    requiresUserDirs: [
      ...input.facts.candidateScriptDirs,
      ...input.facts.candidatePluginDirs,
    ],
    installPlan: {
      steps: [{ kind: 'manual', description: '根据已收集 facts 生成一份需要用户确认目录的桥接脚本计划。' }],
      expectedEvidence: ['用户确认的脚本或插件目录'],
    },
    probePlan: {
      steps: [{ kind: 'manual_probe', description: '运行桥接脚本后读取真实 host signal、heartbeat、HTTP 或进程响应。' }],
      expectedEvidence: ['真实软件产生的探测信号'],
    },
    uninstallPlan: {
      steps: [{ kind: 'manual', description: '只移除本连接写入且有记录的脚本或插件文件。' }],
      expectedEvidence: ['写入记录和删除结果'],
    },
    safetyBoundary: [
      '不能把 exe 存在当作 connected。',
      '不能在真实 probe 成功前发布为 verified strategy。',
      '写入目录必须来自 facts 或用户确认。',
    ],
    evidence: input.facts.evidence,
  };
}

function normalizeProvider(provider: ConnectionStrategyProvider): ConnectionStrategyProvider {
  const id = String(provider.id || '').trim();
  if (!id) throw new Error('connection_strategy_provider_id_required');
  return {
    ...provider,
    id,
    label: String(provider.label || id).trim(),
  };
}

export function registerConnectionStrategyProvider(provider: ConnectionStrategyProvider): void {
  const normalized = normalizeProvider(provider);
  if (providers.has(normalized.id)) {
    throw new Error(`connection_strategy_provider_duplicate:${normalized.id}`);
  }
  providers.set(normalized.id, normalized);
}

export function listConnectionStrategyProviders(): ConnectionStrategyProvider[] {
  return Array.from(providers.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function clearConnectionStrategyProvidersForTest(): void {
  providers.clear();
}

export function registerDefaultConnectionStrategyProviders(): void {
  for (const provider of [
    existingProcessProbeStrategyProvider,
    projectPluginStrategyProvider,
    enginePluginStrategyProvider,
    scriptFolderStrategyProvider,
  ]) {
    if (!providers.has(provider.id)) providers.set(provider.id, provider);
  }
}

export function resolveConnectionStrategies(facts: ConnectionFacts, pkg?: CapabilityPackage): ConnectionStrategy[] {
  registerDefaultConnectionStrategyProviders();
  const collected: ConnectionStrategyInput[] = [];
  for (const provider of listConnectionStrategyProviders()) {
    collected.push(...provider.provide({ facts, package: pkg }));
  }
  collected.push(fallbackManualStrategy({ facts, package: pkg }));

  const seen = new Set<string>();
  return collected
    .map(normalizeConnectionStrategy)
    .filter((strategy) => {
      if (!strategy.id || seen.has(strategy.id)) return false;
      seen.add(strategy.id);
      return true;
    })
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.confidence - a.confidence || a.id.localeCompare(b.id));
}
