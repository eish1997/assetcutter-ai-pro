import { win32 as pathWin32 } from 'node:path';

export type ConnectionFactEvidenceSource =
  | 'user_input'
  | 'manifest'
  | 'shortcut'
  | 'executable_path'
  | 'process'
  | 'filesystem'
  | 'unknown';

export type ConnectionFactEvidence = {
  source: ConnectionFactEvidenceSource;
  at: string;
  path?: string;
  processName?: string;
  value?: string;
  note?: string;
};

export type ConnectionFacts = {
  displayName: string;
  inputPath: string;
  shortcutPath: string;
  executablePath: string;
  processName: string;
  version: string;
  installRoot: string;
  candidateProjectDirs: string[];
  candidateScriptDirs: string[];
  candidatePluginDirs: string[];
  candidateConfigDirs: string[];
  detectedProtocols: string[];
  confidence: number;
  evidence: ConnectionFactEvidence[];
};

export type ConnectionFactsInput = Partial<ConnectionFacts> & {
  name?: unknown;
  appName?: unknown;
  manifest?: Record<string, unknown>;
};

const EMPTY_FACTS: ConnectionFacts = {
  displayName: '',
  inputPath: '',
  shortcutPath: '',
  executablePath: '',
  processName: '',
  version: '',
  installRoot: '',
  candidateProjectDirs: [],
  candidateScriptDirs: [],
  candidatePluginDirs: [],
  candidateConfigDirs: [],
  detectedProtocols: [],
  confidence: 0.05,
  evidence: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return '';
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(cleanString).filter(Boolean))).slice(0, 24);
}

function normalizeEvidence(value: unknown, fallbackAt: string): ConnectionFactEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const source = cleanString(record.source) as ConnectionFactEvidenceSource;
      const path = cleanString(record.path);
      const processName = cleanString(record.processName);
      const factValue = cleanString(record.value);
      const note = cleanString(record.note);
      if (!source && !path && !processName && !factValue && !note) return null;
      return {
        source: source || 'unknown',
        at: cleanString(record.at) || fallbackAt,
        ...(path ? { path } : {}),
        ...(processName ? { processName } : {}),
        ...(factValue ? { value: factValue } : {}),
        ...(note ? { note } : {}),
      };
    })
    .filter((item): item is ConnectionFactEvidence => Boolean(item));
}

function pushEvidence(
  evidence: ConnectionFactEvidence[],
  source: ConnectionFactEvidenceSource,
  at: string,
  detail: Omit<ConnectionFactEvidence, 'source' | 'at'>,
): void {
  const key = `${source}:${detail.path || ''}:${detail.processName || ''}:${detail.value || ''}:${detail.note || ''}`;
  const exists = evidence.some(
    (item) => `${item.source}:${item.path || ''}:${item.processName || ''}:${item.value || ''}:${item.note || ''}` === key,
  );
  if (!exists) evidence.push({ source, at, ...detail });
}

function inferPathFacts(inputPath: string, shortcutPath: string, executablePath: string): Pick<ConnectionFacts, 'inputPath' | 'shortcutPath' | 'executablePath' | 'installRoot'> {
  const normalizedInputPath = inputPath;
  let normalizedShortcutPath = shortcutPath;
  let normalizedExecutablePath = executablePath;

  const lowerInputPath = normalizedInputPath.toLowerCase();
  if (!normalizedShortcutPath && lowerInputPath.endsWith('.lnk')) normalizedShortcutPath = normalizedInputPath;
  if (!normalizedExecutablePath && lowerInputPath.endsWith('.exe')) normalizedExecutablePath = normalizedInputPath;

  const installRoot = normalizedExecutablePath ? pathWin32.dirname(normalizedExecutablePath) : '';
  return {
    inputPath: normalizedInputPath,
    shortcutPath: normalizedShortcutPath,
    executablePath: normalizedExecutablePath,
    installRoot,
  };
}

function scoreConfidence(facts: Omit<ConnectionFacts, 'confidence'>): number {
  let score = 0.05;
  if (facts.displayName) score += 0.1;
  if (facts.inputPath) score += 0.2;
  if (facts.shortcutPath) score += 0.2;
  if (facts.executablePath) score += 0.3;
  if (facts.processName) score += 0.25;
  if (facts.version) score += 0.1;
  if (facts.installRoot) score += 0.1;
  if (facts.evidence.length) score += Math.min(0.2, facts.evidence.length * 0.05);
  return Math.max(0.01, Math.min(1, Number(score.toFixed(2))));
}

export function normalizeConnectionFacts(input?: ConnectionFactsInput | null): ConnectionFacts {
  const source = asRecord(input);
  const manifest = asRecord(source.manifest);
  const at = new Date(0).toISOString();
  const inputPath = firstString(source.inputPath, manifest.inputPath);
  const pathFacts = inferPathFacts(
    inputPath,
    firstString(source.shortcutPath, manifest.shortcutPath),
    firstString(source.executablePath, manifest.executablePath),
  );
  const evidence = normalizeEvidence(source.evidence, at);

  const factsWithoutConfidence: Omit<ConnectionFacts, 'confidence'> = {
    ...EMPTY_FACTS,
    displayName: firstString(source.displayName, source.appName, source.name, manifest.appName, manifest.displayName),
    ...pathFacts,
    version: firstString(source.version, manifest.softwareVersion, manifest.versionHint, manifest.version),
    processName: firstString(source.processName, manifest.processName, manifest.exeName),
    candidateProjectDirs: uniqueStrings(source.candidateProjectDirs ?? manifest.candidateProjectDirs),
    candidateScriptDirs: uniqueStrings(source.candidateScriptDirs ?? manifest.candidateScriptDirs),
    candidatePluginDirs: uniqueStrings(source.candidatePluginDirs ?? manifest.candidatePluginDirs),
    candidateConfigDirs: uniqueStrings(source.candidateConfigDirs ?? manifest.candidateConfigDirs),
    detectedProtocols: uniqueStrings(source.detectedProtocols ?? manifest.detectedProtocols),
    evidence,
  };

  if (factsWithoutConfidence.inputPath) {
    pushEvidence(factsWithoutConfidence.evidence, 'user_input', at, { path: factsWithoutConfidence.inputPath });
  }
  if (factsWithoutConfidence.shortcutPath) {
    pushEvidence(factsWithoutConfidence.evidence, 'shortcut', at, { path: factsWithoutConfidence.shortcutPath });
  }
  if (factsWithoutConfidence.executablePath) {
    pushEvidence(factsWithoutConfidence.evidence, 'executable_path', at, { path: factsWithoutConfidence.executablePath });
  }
  if (factsWithoutConfidence.processName) {
    pushEvidence(factsWithoutConfidence.evidence, 'process', at, { processName: factsWithoutConfidence.processName });
  }
  if (factsWithoutConfidence.version) {
    pushEvidence(factsWithoutConfidence.evidence, 'manifest', at, { value: factsWithoutConfidence.version, note: 'version' });
  }

  return {
    ...factsWithoutConfidence,
    confidence: scoreConfidence(factsWithoutConfidence),
  };
}
