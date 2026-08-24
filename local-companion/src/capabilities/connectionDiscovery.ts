import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { CapabilityPackage } from './capabilityPackages.js';
import { normalizeConnectionFacts, type ConnectionFacts } from './connectionFacts.js';
import { readCustomHostTargetsForHost } from '../bridges/customHostTargets.js';

export type ConnectionDiscoveryInput =
  | CapabilityPackage
  | {
      id?: string;
      name?: string;
      appName?: string;
      manifest?: Record<string, unknown>;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function existingDir(path: string): boolean {
  if (!path || !existsSync(path)) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function existingFile(path: string): boolean {
  if (!path || !existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function childrenNamed(root: string, names: string[]): string[] {
  if (!existingDir(root)) return [];
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  try {
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((child) => wanted.has(basename(child).toLowerCase()) && existingDir(child));
  } catch {
    return [];
  }
}

function dirsFromPath(path: string): string[] {
  if (!path) return [];
  if (existingDir(path)) return [path];
  if (existingFile(path)) return [dirname(path)];
  if (extname(path)) return [dirname(path)];
  return [path];
}

function findProjectDirs(paths: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    const roots = dirsFromPath(path);
    for (const root of roots) {
      if (!existingDir(root)) continue;
      try {
        const names = readdirSync(root);
        if (names.some((name) => name.toLowerCase().endsWith('.uproject'))) out.push(root);
        if (names.some((name) => name.toLowerCase() === 'project.godot')) out.push(root);
        if (names.some((name) => name.toLowerCase() === 'assets') && existingDir(join(root, 'Assets'))) out.push(root);
      } catch {
        /* ignore unreadable folders */
      }
    }
  }
  return unique(out);
}

function candidateDirs(paths: string[], names: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    for (const root of dirsFromPath(path)) {
      out.push(...childrenNamed(root, names));
    }
  }
  return unique(out);
}

function savedTargetPaths(hostId: string): string[] {
  if (!hostId) return [];
  return readCustomHostTargetsForHost(hostId).flatMap((target) => [target.inputPath, target.resolvedPath]);
}

export function collectConnectionFacts(input: ConnectionDiscoveryInput): ConnectionFacts {
  const record = asRecord(input);
  const manifest = asRecord(record.manifest);
  const hostId = text(manifest.hostId) || text(manifest.softwareId);
  const inputPath = text(manifest.inputPath);
  const shortcutPath = text(manifest.shortcutPath);
  const executablePath = text(manifest.executablePath);
  const savedPaths = savedTargetPaths(hostId);
  const allPaths = unique([inputPath, shortcutPath, executablePath, ...savedPaths]);
  const savedExecutablePath = savedPaths.find((path) => extname(path).toLowerCase() === '.exe') || '';
  const inputExecutablePath = extname(inputPath).toLowerCase() === '.exe' ? inputPath : '';
  const preferredExecutablePath = executablePath || inputExecutablePath || savedExecutablePath;

  return normalizeConnectionFacts({
    name: text(record.name),
    appName: text(record.appName) || text(manifest.appName),
    displayName: text(manifest.displayName),
    manifest: {
      ...manifest,
      inputPath,
      shortcutPath,
      executablePath: preferredExecutablePath,
      processName: text(manifest.processName) || text(manifest.exeName) || (preferredExecutablePath ? basename(preferredExecutablePath) : ''),
      candidateProjectDirs: unique([...list(manifest.candidateProjectDirs), ...findProjectDirs(allPaths)]),
      candidateScriptDirs: unique([...list(manifest.candidateScriptDirs), ...candidateDirs(allPaths, ['scripts', 'Scripts', 'startup', 'Startup'])]),
      candidatePluginDirs: unique([...list(manifest.candidatePluginDirs), ...candidateDirs(allPaths, ['plugins', 'Plugins'])]),
      candidateConfigDirs: unique([...list(manifest.candidateConfigDirs), ...candidateDirs(allPaths, ['config', 'Config'])]),
    },
    evidence: [
      ...(hostId
        ? [
            {
              source: 'manifest' as const,
              at: new Date(0).toISOString(),
              value: hostId,
              note: 'hostId',
            },
          ]
        : []),
      ...savedPaths.map((path) => ({
        source: extname(path).toLowerCase() === '.exe' ? ('process' as const) : ('filesystem' as const),
        at: new Date(0).toISOString(),
        path,
        note: 'saved_host_target',
      })),
    ],
  });
}
