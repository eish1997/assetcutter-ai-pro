/**
 * Gemini 代理公平排队 / 每用户限流（内存态，单副本有效）。
 * 规格：docs/Gemini代理-公平排队与每用户限流.md
 *
 * 持久化：Postgres（R3，推荐）或磁盘 JSON；约每 3s 重读。见 `gemini-fairness-config-store.js`。
 */
import crypto from 'crypto';
import {
  geminiFairnessDiskPath,
  getGeminiFairnessConfigCacheSnapshot,
  resolveGeminiFairnessConfigSource,
  touchGeminiFairnessConfigCacheIfStale,
} from './gemini-fairness-config-store.js';

const FALSEY = new Set(['', '0', 'false', 'no', 'off']);

function envBool(name, defaultTrue = false) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return defaultTrue;
  if (FALSEY.has(v)) return false;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function persistedConfigSnapshot() {
  touchGeminiFairnessConfigCacheIfStale();
  if (resolveGeminiFairnessConfigSource() === 'env_only') return {};
  return getGeminiFairnessConfigCacheSnapshot();
}

/**
 * 数值：持久化配置优先，其次 process.env[name]，最后 fallback，并 clamp。
 */
export function getDiskOverrideInt(name, fallback, min, max) {
  const cache = persistedConfigSnapshot();
  const fromPersisted = cache[name];
  const fromEnv = process.env[name];
  const raw = fromPersisted != null && fromPersisted !== '' ? fromPersisted : fromEnv;
  const n = Number(raw);
  const base = Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.min(max, Math.max(min, base));
}

function trustClientFairnessKeyHeader() {
  return envBool('GEMINI_FAIRNESS_TRUST_CLIENT_KEY_HEADER', false);
}

export function isFairnessEnabled() {
  return envBool('GEMINI_FAIRNESS_ENABLED', false);
}

function isStrict() {
  return envBool('GEMINI_FAIRNESS_STRICT', false);
}

function trustXForwarded() {
  return envBool('GEMINI_FAIRNESS_TRUST_X_FORWARDED', false);
}

function hmacSecret() {
  return String(process.env.GEMINI_PROXY_FAIRNESS_HMAC_SECRET || '').trim();
}

function keyMaxLen() {
  return getDiskOverrideInt('GEMINI_FAIRNESS_KEY_MAX_LEN', 256, 8, 512);
}

function hmacSkewMs() {
  const sec = getDiskOverrideInt('GEMINI_FAIRNESS_HMAC_SKEW_SEC', 120, 10, 600);
  return Math.min(600_000, Math.max(10_000, sec * 1000));
}

function isAnonKey(key) {
  return String(key || '').startsWith('anon:');
}

function limitsForKey(key) {
  const anon = isAnonKey(key);
  return {
    maxInFlight: anon
      ? getDiskOverrideInt('GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT', 1, 1, 32)
      : getDiskOverrideInt('GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT', 2, 1, 32),
    maxQueued: anon
      ? getDiskOverrideInt('GEMINI_FAIRNESS_ANON_MAX_QUEUED', 2, 1, 100)
      : getDiskOverrideInt('GEMINI_FAIRNESS_USER_MAX_QUEUED', 5, 1, 200),
    submitRpm: anon
      ? getDiskOverrideInt('GEMINI_FAIRNESS_ANON_SUBMIT_RPM', 10, 1, 500)
      : getDiskOverrideInt('GEMINI_FAIRNESS_USER_SUBMIT_RPM', 30, 1, 500),
  };
}

function globalQueueMax() {
  return getDiskOverrideInt('GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX', 500, 10, 5000);
}

/** 单连接远端是否视为内网可信转发（可信任 X-AC-Fairness-Key / X-AC-Client-Ip） */
function isTrustedRelayAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  if (a.startsWith('10.')) return true;
  if (a.startsWith('192.168.')) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

function normalizeClientIp(raw) {
  const s = String(raw || '').trim().slice(0, 128);
  if (!s) return '';
  if (s.length > 128) return '';
  return s.replace(/\s+/g, '');
}

function clientIpForFairness(req) {
  const sock = req.socket?.remoteAddress || '';
  const trusted = isTrustedRelayAddress(sock);
  const fromHeader = normalizeClientIp(req.headers['x-ac-client-ip']);
  if (trusted && fromHeader) return fromHeader;
  if (trustXForwarded()) {
    const xff = String(req.headers['x-forwarded-for'] || '').trim();
    if (xff) {
      const first = normalizeClientIp(xff.split(',')[0]);
      if (first) return first;
    }
  }
  return normalizeClientIp(sock.replace(/^::ffff:/i, '')) || 'unknown';
}

const FAIRNESS_KEY_RE = /^[a-z0-9:_.\-]+$/i;

function validateFairnessKeyShape(key) {
  const k = String(key || '').trim();
  const max = keyMaxLen();
  if (!k || k.length > max) return { ok: false, error: 'Invalid fairness key length' };
  if (!FAIRNESS_KEY_RE.test(k)) return { ok: false, error: 'Invalid fairness key characters' };
  return { ok: true, key: k };
}

function verifyHmacSignature(key, sigHeader) {
  const secret = hmacSecret();
  if (!secret) return { ok: true };
  const raw = String(sigHeader || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, error: 'fairness_auth_failed' };
  const ts = Number(parts[0]);
  const hex = parts[1];
  if (!Number.isFinite(ts) || !/^[a-f0-9]+$/i.test(hex)) return { ok: false, error: 'fairness_auth_failed' };
  if (Math.abs(Date.now() - ts) > hmacSkewMs()) return { ok: false, error: 'fairness_auth_failed' };
  const payload = `${key}\n${ts}`;
  const mac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  try {
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(hex, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'fairness_auth_failed' };
  } catch {
    return { ok: false, error: 'fairness_auth_failed' };
  }
  return { ok: true };
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {{ ok: true, key: string } | { ok: false, status: number, error: string, retryAfterSec?: number }}
 */
export function resolveFairnessKey(req) {
  const rawKey = String(req.headers['x-ac-fairness-key'] || '').trim();
  const sock = req.socket?.remoteAddress || '';
  const trustedRelay = isTrustedRelayAddress(sock);
  const secret = hmacSecret();

  if (rawKey) {
    const shape = validateFairnessKeyShape(rawKey);
    if (!shape.ok) return { ok: false, status: 400, error: shape.error };
    if (secret) {
      const sig = verifyHmacSignature(shape.key, req.headers['x-ac-fairness-signature']);
      if (!sig.ok) return { ok: false, status: 401, error: sig.error || 'fairness_auth_failed' };
    } else if (!trustedRelay && !trustClientFairnessKeyHeader()) {
      return {
        ok: false,
        status: 401,
        error:
          'Fairness key requires trusted relay (private IP), or GEMINI_FAIRNESS_TRUST_CLIENT_KEY_HEADER=true, or set GEMINI_PROXY_FAIRNESS_HMAC_SECRET and X-AC-Fairness-Signature',
      };
    }
    return { ok: true, key: shape.key };
  }

  if (isStrict()) {
    return { ok: false, status: 401, error: 'Missing X-AC-Fairness-Key (GEMINI_FAIRNESS_STRICT=true)' };
  }

  const ip = clientIpForFairness(req);
  const anonKey = `anon:${ip}`;
  return { ok: true, key: anonKey };
}

function hashKeyForLog(key) {
  try {
    return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex').slice(0, 16);
  } catch {
    return 'err';
  }
}

/** @typedef {{ queue: string[], submitLog: Array<{ t: number, w: number }>, running: number }} FairKeyState */

/** @type {Map<string, FairKeyState>} */
const keyState = new Map();

/** jobId -> fairnessKey */
const jobFairnessKey = new Map();

/** jobId -> task envelope id（同 envelope 多步共享 1 个用户并发槽） */
const jobEnvelopeId = new Map();

/**
 * envelopeId -> { fairnessKey, active, runningLease, lastTouch }
 * active：任务信封仍开放（步间）；runningLease：已占用 st.running 名额
 */
const envelopeState = new Map();

const ENVELOPE_ID_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const ENVELOPE_TTL_MS = 20 * 60_000;

/** Round-robin: ordered keys with queue.length > 0 */
const ringKeys = [];
const ringIndexRef = { i: 0 };

function getState(key) {
  let s = keyState.get(key);
  if (!s) {
    s = { queue: [], submitLog: [], running: 0 };
    keyState.set(key, s);
  }
  return s;
}

function pruneSubmitLog(s, now) {
  const cutoff = now - 60_000;
  while (s.submitLog.length && s.submitLog[0].t < cutoff) s.submitLog.shift();
}

function submitWeightInWindow(s, now) {
  pruneSubmitLog(s, now);
  let w = 0;
  for (const e of s.submitLog) w += e.w;
  return w;
}

function totalGlobalQueued() {
  let n = 0;
  for (const s of keyState.values()) n += s.queue.length;
  for (const s of keyState.values()) n += s.running;
  return n;
}

function ensureKeyInRing(key) {
  if (!ringKeys.includes(key)) ringKeys.push(key);
}

function removeKeyFromRingIfEmpty(key) {
  const s = keyState.get(key);
  if (s && s.queue.length === 0) {
    const idx = ringKeys.indexOf(key);
    if (idx >= 0) ringKeys.splice(idx, 1);
    if (ringIndexRef.i >= ringKeys.length) ringIndexRef.i = 0;
  }
}

function normalizeTaskEnvelopeId(raw) {
  const id = String(raw || '').trim();
  if (!id || id.length > 128) return null;
  if (!ENVELOPE_ID_RE.test(id)) return null;
  return id;
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string | null}
 */
export function parseFairnessTaskEnvelope(req) {
  if (!req || !req.headers) return null;
  return normalizeTaskEnvelopeId(req.headers['x-ac-task-envelope']);
}

function sweepStaleEnvelopes(now = Date.now()) {
  for (const [id, rec] of envelopeState.entries()) {
    if (now - rec.lastTouch > ENVELOPE_TTL_MS) envelopeState.delete(id);
  }
}

function getEnvelopeRec(envelopeId) {
  if (!envelopeId) return null;
  return envelopeState.get(envelopeId) || null;
}

function isEnvelopeContinuation(envelopeId, fairnessKey) {
  const rec = getEnvelopeRec(envelopeId);
  return Boolean(rec && rec.active && rec.fairnessKey === fairnessKey);
}

function envelopeTouch(envelopeId, fairnessKey) {
  const now = Date.now();
  sweepStaleEnvelopes(now);
  let rec = envelopeState.get(envelopeId);
  if (!rec) {
    rec = { fairnessKey, active: true, runningLease: false, lastTouch: now };
    envelopeState.set(envelopeId, rec);
    return rec;
  }
  if (rec.fairnessKey !== fairnessKey) return null;
  rec.active = true;
  rec.lastTouch = now;
  return rec;
}

function envelopeEndTask(envelopeId) {
  if (!envelopeId) return;
  envelopeState.delete(envelopeId);
}

function envelopeClearRunningLease(envelopeId, keepActive = true) {
  const rec = getEnvelopeRec(envelopeId);
  if (!rec) return false;
  const had = rec.runningLease;
  rec.runningLease = false;
  if (!keepActive) rec.active = false;
  rec.lastTouch = Date.now();
  if (!rec.active && !rec.runningLease) envelopeState.delete(envelopeId);
  return had;
}

function envelopeSetRunningLease(envelopeId, fairnessKey) {
  const rec = envelopeTouch(envelopeId, fairnessKey);
  if (!rec) return false;
  rec.runningLease = true;
  return true;
}

function envelopeHasRunningLease(envelopeId, fairnessKey) {
  const rec = getEnvelopeRec(envelopeId);
  return Boolean(rec && rec.fairnessKey === fairnessKey && rec.runningLease);
}

/**
 * 提交前：RPM + 排队深度 + 全站队列上限。通过则入队并记 submitLog。
 * 同 task envelope 的后续步跳过 RPM / 用户排队深度（共享整包 1 槽）。
 * @returns {{ ok: true } | { ok: false, status: number, error: string, retryAfterSec?: number }}
 */
export function fairnessTryEnqueue(jobId, fairnessKey, costWeight = 1, envelopeId = null) {
  if (!isFairnessEnabled()) return { ok: true };

  const envId = normalizeTaskEnvelopeId(envelopeId);
  const continuation = envId ? isEnvelopeContinuation(envId, fairnessKey) : false;

  const w = Math.max(1, Math.min(20, Number(costWeight) || 1));
  const now = Date.now();
  const lim = limitsForKey(fairnessKey);
  const st = getState(fairnessKey);

  if (!continuation) {
    pruneSubmitLog(st, now);
    const rpmUsed = submitWeightInWindow(st, now);
    if (rpmUsed + w > lim.submitRpm) {
      return { ok: false, status: 429, error: 'rate_limited', retryAfterSec: 12, reason: 'user_rpm' };
    }

    const depth = st.queue.length + st.running;
    if (depth >= lim.maxQueued) {
      return { ok: false, status: 429, error: 'rate_limited', retryAfterSec: 5, reason: 'user_queue_depth' };
    }
  }

  if (totalGlobalQueued() >= globalQueueMax()) {
    return { ok: false, status: 503, error: 'queue_overflow', retryAfterSec: 30, reason: 'global_queue_overflow' };
  }

  if (!continuation) {
    st.submitLog.push({ t: now, w });
  }
  if (envId) envelopeTouch(envId, fairnessKey);
  st.queue.push(jobId);
  jobFairnessKey.set(jobId, fairnessKey);
  if (envId) jobEnvelopeId.set(jobId, envId);
  ensureKeyInRing(fairnessKey);

  console.log(
    JSON.stringify({
      event: 'fairness_enqueue',
      jobId,
      fairnessKeyHash: hashKeyForLog(fairnessKey),
      taskEnvelope: envId || undefined,
      continuation: continuation || undefined,
      reason: 'ok',
      globalQueuedApprox: totalGlobalQueued(),
    })
  );

  return { ok: true };
}

/** 若 map 写入失败等，撤销 tryEnqueue 入队（不调整 running；简单 pop 最后一条 submitLog） */
export function fairnessAbandonEnqueue(jobId) {
  if (!isFairnessEnabled()) return;
  const key = jobFairnessKey.get(jobId);
  if (!key) return;
  const st = keyState.get(key);
  if (st) {
    const qi = st.queue.indexOf(jobId);
    if (qi >= 0) st.queue.splice(qi, 1);
    if (st.submitLog.length) st.submitLog.pop();
  }
  jobFairnessKey.delete(jobId);
  jobEnvelopeId.delete(jobId);
  if (st) removeKeyFromRingIfEmpty(key);
}

/**
 * 从 RR 环上 dequeue 一个可运行的 job：该 key running < maxInFlight，且 job 仍存在于调用方 Map。
 * @param {(jobId: string) => boolean} jobExists
 * @returns {{ jobId: string, key: string } | null}
 */
export function fairnessDequeueForRun(jobExists) {
  if (!isFairnessEnabled()) return null;
  const maxPasses = 500;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (!ringKeys.length) return null;
    const n = ringKeys.length;
    let progressed = false;
    for (let k = 0; k < n; k++) {
      const idx = (ringIndexRef.i + k) % n;
      const key = ringKeys[idx];
      const st = keyState.get(key);
      if (!st || !st.queue.length) continue;
      const lim = limitsForKey(key);
      if (st.running >= lim.maxInFlight) continue;

      const jobId = st.queue[0];
      if (!jobExists(jobId)) {
        st.queue.shift();
        jobFairnessKey.delete(jobId);
        removeKeyFromRingIfEmpty(key);
        if (st.queue.length) ensureKeyInRing(key);
        progressed = true;
        break;
      }

      st.queue.shift();
      st.running += 1;
      ringIndexRef.i = (idx + 1) % Math.max(1, ringKeys.length);
      removeKeyFromRingIfEmpty(key);
      if (st.queue.length) ensureKeyInRing(key);

      console.log(
        JSON.stringify({
          event: 'fairness_start_run',
          jobId,
          fairnessKeyHash: hashKeyForLog(key),
          runningForKey: st.running,
        })
      );
      return { jobId, key };
    }
    if (!progressed) return null;
  }
  return null;
}

/** 异步任务彻底结束（成功/失败/不再重试）时释放 running 计数 */
export function fairnessOnAsyncJobFinished(jobId) {
  if (!isFairnessEnabled()) return;
  const key = jobFairnessKey.get(jobId);
  if (!key) return;
  const envId = jobEnvelopeId.get(jobId);
  jobFairnessKey.delete(jobId);
  jobEnvelopeId.delete(jobId);
  const st = keyState.get(key);
  if (!st) return;
  st.running = Math.max(0, st.running - 1);
  removeKeyFromRingIfEmpty(key);
  if (envId) envelopeEndTask(envId);

  console.log(
    JSON.stringify({
      event: 'fairness_release',
      jobId,
      fairnessKeyHash: hashKeyForLog(key),
      taskEnvelope: envId || undefined,
      runningForKey: st.running,
    })
  );
}

/** TTL 等删除 job 时：若仍在排队则移出队列；不扣 running（未启动） */
export function fairnessOnJobEvicted(jobId) {
  if (!isFairnessEnabled()) return;
  const key = jobFairnessKey.get(jobId);
  if (!key) return;
  const st = keyState.get(key);
  if (!st) {
    jobFairnessKey.delete(jobId);
    return;
  }
  const qi = st.queue.indexOf(jobId);
  if (qi >= 0) {
    st.queue.splice(qi, 1);
    jobFairnessKey.delete(jobId);
    removeKeyFromRingIfEmpty(key);
    console.log(
      JSON.stringify({
        event: 'fairness_evict_queue',
        jobId,
        fairnessKeyHash: hashKeyForLog(key),
      })
    );
    return;
  }
  // 若 running 中仍持有 id（极少：应在 finished 先处理），保守递减
  if (jobFairnessKey.has(jobId)) {
    jobFairnessKey.delete(jobId);
    st.running = Math.max(0, st.running - 1);
    removeKeyFromRingIfEmpty(key);
  }
}

/**
 * 轮询 job 时在 `queued` / `running` 态附带排队快照（仅 fairness 开启且 job 已登记时有效）。
 * @returns {null | { userAhead: number, globalQueuedApprox: number, globalRunning: number, userQueued: number, userRunning: number, waitSecEstimate: number }}
 */
export function fairnessQueueMetaForJob(jobId, jobStatus) {
  if (!isFairnessEnabled()) return null;
  const key = jobFairnessKey.get(jobId);
  if (!key) return null;
  const st = keyState.get(key);
  if (!st) return null;

  const status = String(jobStatus || '').trim();
  let userAhead = 0;
  const qi = st.queue.indexOf(jobId);
  if (qi >= 0) userAhead = qi;

  let globalQueued = 0;
  let globalRunning = 0;
  for (const s of keyState.values()) {
    globalQueued += s.queue.length;
    globalRunning += s.running;
  }

  const globalCap = getDiskOverrideInt('GEMINI_ASYNC_PROXY_MAX_CONCURRENT', 4, 1, 64);
  const globalQueuedApprox = globalQueued + globalRunning;
  /** 粗估：每槽约 45s，考虑全站排队超出并发部分 */
  const backlogSlots = Math.max(0, globalQueuedApprox - globalCap);
  let waitSecEstimate = 0;
  if (status === 'queued') {
    waitSecEstimate = Math.ceil(((userAhead + backlogSlots) / Math.max(1, globalCap)) * 45);
    waitSecEstimate = Math.min(3600, Math.max(5, waitSecEstimate));
  }

  return {
    userAhead,
    globalQueuedApprox,
    globalRunning,
    userQueued: st.queue.length,
    userRunning: st.running,
    waitSecEstimate,
  };
}

export function fairnessHealthSnapshot() {
  const configSource = resolveGeminiFairnessConfigSource();
  if (!isFairnessEnabled()) {
    return { enabled: false, configSource, diskConfigPath: geminiFairnessDiskPath() };
  }
  let globalQueuedApprox = 0;
  for (const s of keyState.values()) globalQueuedApprox += s.queue.length + s.running;
  touchGeminiFairnessConfigCacheIfStale();
  const cache = getGeminiFairnessConfigCacheSnapshot();
  const persistedKeys = Object.keys(cache).filter((k) => !k.startsWith('_'));
  return {
    enabled: true,
    globalQueuedApprox,
    keysWithQueued: [...keyState.entries()].filter(([, s]) => s.queue.length > 0).length,
    ringKeys: ringKeys.length,
    activeTaskEnvelopes: envelopeState.size,
    configSource,
    diskConfigPath: configSource === 'disk' ? geminiFairnessDiskPath() : null,
    persistedKeysLoaded: persistedKeys.length,
  };
}

/** 同步路径：阻塞直到取得该 key 的一个「运行名额」，与异步共用 running 计数 */
export function fairnessSyncEnter(fairnessKey, envelopeId = null) {
  if (!isFairnessEnabled()) return Promise.resolve({ acquiredRunning: false });
  const envId = normalizeTaskEnvelopeId(envelopeId);
  if (envId && envelopeHasRunningLease(envId, fairnessKey)) {
    return Promise.resolve({ acquiredRunning: false });
  }
  const lim = limitsForKey(fairnessKey);
  const st = getState(fairnessKey);
  return new Promise((resolve) => {
    function tryEnter() {
      if (st.running < lim.maxInFlight) {
        st.running += 1;
        if (envId) envelopeSetRunningLease(envId, fairnessKey);
        console.log(
          JSON.stringify({
            event: 'fairness_sync_enter',
            fairnessKeyHash: hashKeyForLog(fairnessKey),
            taskEnvelope: envId || undefined,
            runningForKey: st.running,
          })
        );
        resolve({ acquiredRunning: true });
        return;
      }
      setTimeout(tryEnter, 25);
    }
    tryEnter();
  });
}

export function fairnessSyncLeave(fairnessKey, envelopeId = null, acquiredRunning = true) {
  if (!isFairnessEnabled()) return;
  const envId = normalizeTaskEnvelopeId(envelopeId);
  const st = keyState.get(fairnessKey);
  if (!st) return;
  if (acquiredRunning) st.running = Math.max(0, st.running - 1);
  if (envId) envelopeClearRunningLease(envId, true);
  console.log(
    JSON.stringify({
      event: 'fairness_sync_leave',
      fairnessKeyHash: hashKeyForLog(fairnessKey),
      taskEnvelope: envId || undefined,
      runningForKey: st.running,
    })
  );
}

/** @internal 单测重置内存态 */
export function resetFairnessStateForTests() {
  keyState.clear();
  jobFairnessKey.clear();
  jobEnvelopeId.clear();
  envelopeState.clear();
  ringKeys.length = 0;
  ringIndexRef.i = 0;
}
