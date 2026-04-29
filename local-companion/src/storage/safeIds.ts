/** 项目 / 资源 key 仅允许安全片段，防路径穿越。 */
const SAFE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,126})$/;

export function isSafeIdPart(s: string | undefined): s is string {
  if (!s || s.length > 128) return false;
  if (s.includes('..') || s.includes('/') || s.includes('\\')) return false;
  return SAFE.test(s);
}

export function assertSafeId(s: string | undefined, name: string): string {
  if (!isSafeIdPart(s)) throw new Error(`invalid_${name}`);
  return s;
}

/**
 * 工作区项目目录名（磁盘文件夹名）：允许 Unicode 作显示名，仍禁止路径穿越与非法文件名字符。
 * 与 `isSafeIdPart`（资产 object key）区分：资产 key 保持 ASCII 单段；项目目录可与 UI 名称一致。
 */
export function isSafeWorkspaceFolderName(s: string | undefined): s is string {
  if (!s || s.length > 128) return false;
  const n = String(s);
  if (n !== n.trim()) return false;
  if (n === '.' || n === '..') return false;
  if (n.includes('..')) return false;
  if (/[/\\]/.test(n)) return false;
  if (/[<>:"|?*\x00-\x1f]/.test(n)) return false;
  return true;
}

export function assertSafeWorkspaceFolderName(s: string | undefined, name: string): string {
  if (!isSafeWorkspaceFolderName(s)) throw new Error(`invalid_${name}`);
  return String(s).trim();
}

/** 回收站目录名：`原项目名__时间戳` */
export function isWorkspaceTrashDirName(s: string | undefined): boolean {
  if (!s || s.length > 220) return false;
  const i = s.lastIndexOf('__');
  if (i <= 0) return false;
  const orig = s.slice(0, i);
  const ts = s.slice(i + 2);
  if (!orig || !/^\d{8,}$/.test(ts)) return false;
  if (orig.includes('..') || /[/\\]/.test(orig) || /[<>:"|?*\x00-\x1f]/.test(orig)) return false;
  return orig.length <= 128;
}
