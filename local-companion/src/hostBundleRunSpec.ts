import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 与 docs/本地伴侣-插件与发行.md 中「run.json」约定一致 */
export type HostBundleRunSpecV1 = {
  schemaVersion: 1;
  description?: string;
  /** 相对 extracted/ 的工作目录，缺省为 extracted 根 */
  cwd?: string;
  /** 可选：健康/就绪探测（短命令，不长期占用） */
  probe?: { command: string[]; cwd?: string; env?: Record<string, string> };
  /** 可选：单次执行入口（后续由 compute Adapter 调用） */
  exec?: { command: string[]; cwd?: string; env?: Record<string, string> };
};

function isNonEmptyStringArray(a: unknown): a is string[] {
  return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && x.length > 0);
}

function isStringRecord(o: unknown): o is Record<string, string> {
  if (!o || typeof o !== 'object') return false;
  for (const v of Object.values(o as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

export function parseHostBundleRunSpecJson(raw: unknown): HostBundleRunSpecV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  const out: HostBundleRunSpecV1 = { schemaVersion: 1 };
  if (typeof o.description === 'string') out.description = o.description;
  if (typeof o.cwd === 'string') out.cwd = o.cwd;
  if (o.probe && typeof o.probe === 'object' && o.probe !== null) {
    const p = o.probe as Record<string, unknown>;
    if (isNonEmptyStringArray(p.command)) {
      out.probe = {
        command: p.command,
        cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
        env: isStringRecord(p.env) ? { ...p.env } : undefined,
      };
    }
  }
  if (o.exec && typeof o.exec === 'object' && o.exec !== null) {
    const e = o.exec as Record<string, unknown>;
    if (isNonEmptyStringArray(e.command)) {
      out.exec = {
        command: e.command,
        cwd: typeof e.cwd === 'string' ? e.cwd : undefined,
        env: isStringRecord(e.env) ? { ...e.env } : undefined,
      };
    }
  }
  return out;
}

/** bundle 根目录为 host-bundles/<semverDir>/ */
export function readHostBundleRunSpecSync(bundleRootDir: string): HostBundleRunSpecV1 | null {
  const p = join(bundleRootDir, 'extracted', 'run.json');
  if (!existsSync(p)) return null;
  try {
    const text = readFileSync(p, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    return parseHostBundleRunSpecJson(parsed);
  } catch {
    return null;
  }
}
