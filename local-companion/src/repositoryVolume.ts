import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_REL = join('.assetcutter-companion', 'volume');

/** 仓库根目录：优先环境变量，否则用户目录下固定子目录（可写、不污染仓库根） */
export function getRepositoryRoot(): string {
  const raw = process.env.COMPANION_VOLUME_ROOT?.trim();
  if (raw) return resolve(raw);
  return resolve(homedir(), DEFAULT_REL);
}

export function ensureRepositoryRoot(): string {
  const root = getRepositoryRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

export type RepositorySummary = {
  rootAbsolutePath: string;
  exists: boolean;
  topLevelEntryCount: number;
  note: string;
};

export function getRepositorySummary(): RepositorySummary {
  const root = getRepositoryRoot();
  const exists = existsSync(root);
  let topLevelEntryCount = 0;
  if (exists) {
    try {
      topLevelEntryCount = readdirSync(root).length;
    } catch {
      topLevelEntryCount = -1;
    }
  }
  return {
    rootAbsolutePath: root,
    exists,
    topLevelEntryCount,
    note: 'catalog / AssetHandle 索引为 P1；当前仅暴露本机卷根路径供开发与联调。',
  };
}

/** 浅层占用估算：仅根目录一级文件 size 求和（目录不计入，避免全盘遍历） */
export function getRepositoryShallowBytesUsed(): number | null {
  const root = getRepositoryRoot();
  if (!existsSync(root)) return 0;
  let total = 0;
  try {
    for (const name of readdirSync(root)) {
      const p = join(root, name);
      try {
        const st = statSync(p);
        if (st.isFile()) total += st.size;
      } catch {
        /* skip */
      }
    }
    return total;
  } catch {
    return null;
  }
}
