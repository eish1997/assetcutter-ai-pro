import type { CapabilityPackage } from './capabilityPackages.js';
import { collectConnectionFacts } from './connectionDiscovery.js';
import type { ConnectionFacts } from './connectionFacts.js';
import { resolveConnectionStrategies } from './connectionStrategyRegistry.js';
import { resolveSoftwareBridgeStrategies } from './softwareBridgeRegistry.js';
import type { ConnectionStrategy } from './connectionStrategy.js';

export type StrategyDraft = {
  connectionId: string;
  facts: ConnectionFacts;
  candidateStrategies: ConnectionStrategy[];
  recommendedNextStrategy: ConnectionStrategy | null;
  questionsForUser: string[];
  blockedReason: string;
  requiredEvidenceToVerify: string[];
};

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function questionsForDraft(facts: ConnectionFacts, strategies: ConnectionStrategy[]): string[] {
  const questions: string[] = [];
  if (!facts.executablePath && !facts.processName) questions.push('请选择软件 exe，或先打开软件后执行“识别已打开软件”。');
  if (strategies.some((strategy) => strategy.requiresUserDirs.length === 0 && strategy.kind !== 'existing_process_probe')) {
    questions.push('请确认可写入的脚本目录、插件目录或项目目录。');
  }
  if (!strategies.some((strategy) => strategy.probePlan.expectedEvidence.length > 0)) {
    questions.push('请确认真实探测信号类型，例如 heartbeat、HTTP health、command port 或插件回调。');
  }
  return unique(questions);
}

export function buildConnectionStrategyDraft(pkg: CapabilityPackage): StrategyDraft {
  const facts = collectConnectionFacts(pkg);
  const strategies = uniqueStrategies([
    ...resolveSoftwareBridgeStrategies(pkg),
    ...resolveConnectionStrategies(facts, pkg),
  ]);
  const recommendedNextStrategy =
    strategies.find((strategy) => strategy.verified) ||
    strategies.find((strategy) => strategy.risk === 'low') ||
    strategies[0] ||
    null;
  return {
    connectionId: pkg.id,
    facts,
    candidateStrategies: strategies,
    recommendedNextStrategy,
    questionsForUser: questionsForDraft(facts, strategies),
    blockedReason: strategies.length ? '' : '没有可尝试的候选策略。',
    requiredEvidenceToVerify: unique(strategies.flatMap((strategy) => strategy.probePlan.expectedEvidence)),
  };
}

function uniqueStrategies(strategies: ConnectionStrategy[]): ConnectionStrategy[] {
  const seen = new Set<string>();
  return strategies.filter((strategy) => {
    if (!strategy.id || seen.has(strategy.id)) return false;
    seen.add(strategy.id);
    return true;
  });
}
