/**
 * electron-updater（generic / electron-builder）用 latest.yml 片段。
 * sha512 字段为 **Base64**（由登记时的 128 位十六进制 SHA-512 转换）。
 */
import { Buffer } from 'node:buffer';

/** @param {string} r2Key */
/** @param {string} publicBase 公网可访问前缀，无尾部斜杠，如 https://pub.example.com */
export function publicFileUrlForR2Key(r2Key, publicBase) {
  const base = String(publicBase || '').trim().replace(/\/$/, '');
  if (!base) return null;
  const segs = String(r2Key || '')
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));
  return `${base}/${segs.join('/')}`;
}

function yamlScalar(s) {
  const t = String(s);
  if (t === '' || /[:#{}[\],&*?]|^\s|\s$/.test(t) || t.includes('\n')) {
    return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return t;
}

/** @param {string | undefined | null} hex128 */
export function hexSha512ToUpdaterBase64(hex128) {
  const h = String(hex128 || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(h)) return '';
  return Buffer.from(h, 'hex').toString('base64');
}

/**
 * @param {object} rec companion-artifacts 记录（须含 semver, bytes, fileName, r2Key, publishedAt, sha512?）
 * @param {string} publicBase COMPANION_DIST_PUBLIC_HTTP_BASE
 */
export function buildElectronAppUpdateYaml(rec, publicBase) {
  const url = publicFileUrlForR2Key(rec.r2Key, publicBase);
  if (!url) {
    throw new Error('缺少公网基址：请设置环境变量 COMPANION_DIST_PUBLIC_HTTP_BASE（无尾部斜杠）');
  }
  const version = String(rec.semver || '').trim();
  if (!version) throw new Error('semver 为空');
  const size = Math.floor(Number(rec.bytes) || 0);
  const fileName = String(rec.fileName || 'artifact.bin').trim() || 'artifact.bin';
  const releaseDate = String(rec.publishedAt || new Date().toISOString());
  const sha512B64 = hexSha512ToUpdaterBase64(rec.sha512);
  const lines = [`version: ${yamlScalar(version)}`, 'files:', `  - url: ${yamlScalar(url)}`, `    size: ${size}`];
  if (sha512B64) {
    lines.push(`    sha512: ${sha512B64}`);
  }
  lines.push(`path: ${yamlScalar(fileName)}`);
  if (sha512B64) {
    lines.push(`sha512: ${sha512B64}`);
  }
  lines.push(`releaseDate: '${releaseDate.replace(/'/g, "''")}'`);
  return `${lines.join('\n')}\n`;
}
