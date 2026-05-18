/**
 * electron-updater（generic / electron-builder）用 latest.yml 片段。
 * sha512 字段为 **Base64**（由登记时的 128 位十六进制 SHA-512 转换）。
 */
import { Buffer } from 'node:buffer';

/** 伴侣发行公网读 URL 前缀：优先 COMPANION_DIST_PUBLIC_HTTP_BASE，否则回退 R2_PUBLIC_BASE_URL */
export function companionDistPublicHttpBase() {
  return String(process.env.COMPANION_DIST_PUBLIC_HTTP_BASE || process.env.R2_PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

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
 * @param {string} [publicBase] 默认 companionDistPublicHttpBase()
 */
export function buildElectronAppUpdateYaml(rec, publicBase) {
  const base = String(publicBase || companionDistPublicHttpBase()).trim();
  const url = publicFileUrlForR2Key(rec.r2Key, base);
  if (!url) {
    throw new Error(
      '缺少公网基址：请设置 COMPANION_DIST_PUBLIC_HTTP_BASE 或 R2_PUBLIC_BASE_URL（无尾部斜杠）',
    );
  }
  const version = String(rec.semver || '').trim();
  if (!version) throw new Error('semver 为空');
  const size = Math.floor(Number(rec.bytes) || 0);
  const fileName = String(rec.fileName || 'artifact.bin').trim() || 'artifact.bin';
  const releaseDate = String(rec.publishedAt || new Date().toISOString());
  const sha512B64 = hexSha512ToUpdaterBase64(rec.sha512);
  const blockMapBytes = Math.floor(Number(rec.blockMapBytes) || 0);
  const r2Key = String(rec.r2Key || '').trim();
  const blockMapKey = String(rec.blockMapR2Key || '').trim();
  /** electron-updater 只认 {installerUrl}.blockmap；键名须为 r2Key + ".blockmap" */
  const blockMapSibling = blockMapBytes > 0 && blockMapKey && blockMapKey === `${r2Key}.blockmap`;
  const lines = [`version: ${yamlScalar(version)}`, 'files:', `  - url: ${yamlScalar(url)}`, `    size: ${size}`];
  if (sha512B64) {
    lines.push(`    sha512: ${sha512B64}`);
  }
  if (blockMapSibling) {
    lines.push(`    blockMapSize: ${blockMapBytes}`);
  }
  lines.push(`path: ${yamlScalar(fileName)}`);
  if (sha512B64) {
    lines.push(`sha512: ${sha512B64}`);
  }
  lines.push(`releaseDate: '${releaseDate.replace(/'/g, "''")}'`);
  return `${lines.join('\n')}\n`;
}

/** @param {string} body */
export function isElectronUpdaterYamlBody(body) {
  const t = String(body || '');
  if (!/^\s*version\s*:/m.test(t)) return false;
  if (/^\s*#\s*error:/m.test(t)) return false;
  return /^\s*files\s*:/m.test(t);
}

/**
 * 将 electron-updater generic 用 YAML 写入 HTTP 响应（Path A / legacy 共用）。
 * @param {import('http').ServerResponse} res
 * @param {object | null | undefined} latest pickLatestArtifact 结果
 */
export function writeCompanionElectronUpdaterYamlResponse(res, latest) {
  const yamlType = 'text/yaml; charset=utf-8';
  const plainType = 'text/plain; charset=utf-8';
  const publicBase = companionDistPublicHttpBase();
  if (!publicBase) {
    res.statusCode = 503;
    res.setHeader('Content-Type', plainType);
    res.end(
      '# error: 未配置 COMPANION_DIST_PUBLIC_HTTP_BASE 或 R2_PUBLIC_BASE_URL（公网可访问的文件 URL 前缀，无尾部斜杠）\n',
    );
    return;
  }
  if (!latest) {
    res.statusCode = 404;
    res.setHeader('Content-Type', plainType);
    res.end('# error: 无匹配的发行记录\n');
    return;
  }
  try {
    const yaml = buildElectronAppUpdateYaml(latest, publicBase);
    res.statusCode = 200;
    res.setHeader('Content-Type', yamlType);
    res.setHeader('Cache-Control', 'no-store');
    res.end(yaml);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', plainType);
    res.end(`# error: ${message}\n`);
  }
}
