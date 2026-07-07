/**
 * 火山引擎 Visual API HMAC-SHA256 签名（纯函数）。
 * region=cn-north-1, service=cv, version=2022-08-31
 */
import crypto from 'crypto';

const ALGORITHM = 'HMAC-SHA256';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key, data) {
  const k = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  return crypto.createHmac('sha256', k).update(data, 'utf8').digest();
}

/** RFC3986 风格编码（火山 Query 规范化） */
export function volcUriEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** UTC ISO8601：YYYYMMDD'T'HHMMSS'Z' */
export function formatVolcXDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function shortDateFromXDate(xDate) {
  return String(xDate || '').slice(0, 8);
}

function buildCanonicalQueryString(query) {
  if (!query || typeof query !== 'object') return '';
  const keys = Object.keys(query).sort();
  return keys
    .map((key) => `${volcUriEncode(key)}=${volcUriEncode(String(query[key]))}`)
    .join('&');
}

function buildCanonicalHeaders(headerMap, signedHeaderNames) {
  const names = [...signedHeaderNames].map((h) => h.toLowerCase()).sort();
  const lines = names.map((name) => `${name}:${String(headerMap[name] ?? '').trim()}\n`);
  return { canonicalHeaders: lines.join(''), signedHeaders: names.join(';') };
}

function deriveSigningKey(secretAccessKey, shortDate, region, service) {
  const kDate = hmacSha256(secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'request');
}

/**
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.host
 * @param {string} [opts.path]
 * @param {Record<string, string>} opts.query
 * @param {string} [opts.body]
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {string} [opts.region]
 * @param {string} [opts.service]
 * @param {Date} [opts.now]
 */
export function signVolcengineRequest({
  method = 'POST',
  host,
  path: uriPath = '/',
  query = {},
  body = '',
  accessKeyId,
  secretAccessKey,
  region = 'cn-north-1',
  service = 'cv',
  now = new Date(),
}) {
  const xDate = formatVolcXDate(now);
  const shortDate = shortDateFromXDate(xDate);
  const payloadHash = sha256Hex(body);
  const contentType = 'application/json';

  const headerMap = {
    host: String(host).trim(),
    'content-type': contentType,
    'x-date': xDate,
    'x-content-sha256': payloadHash,
  };
  const signedHeaderNames = ['content-type', 'host', 'x-content-sha256', 'x-date'];
  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headerMap, signedHeaderNames);

  const canonicalRequest = [
    String(method || 'POST').toUpperCase(),
    uriPath || '/',
    buildCanonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [ALGORITHM, xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = deriveSigningKey(secretAccessKey, shortDate, region, service);
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');
  const authorization = `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    xDate,
    xContentSha256: payloadHash,
    contentType,
    host: headerMap.host,
    canonicalRequest,
    stringToSign,
    signature,
  };
}

export { sha256Hex };
