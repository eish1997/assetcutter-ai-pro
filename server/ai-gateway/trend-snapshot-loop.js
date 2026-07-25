/**
 * B9: 每日趋势快照定时落库（今日滚动更新 + 昨日封存）。
 * Admin GET /api/admin/ai-gateway/trends 已可读历史日 snapshots。
 */
import { refreshAiGatewayTrendSnapshot } from './trend-report.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

let snapshotTimer = null;
/** @type {string} 本进程已封存的昨天 YYYY-MM-DD，避免每小时重算昨日 */
let sealedYesterdayDay = '';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function isAiGatewayTrendSnapshotLoopEnabled() {
  const raw = String(process.env.AI_GATEWAY_TREND_SNAPSHOT_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

export function aiGatewayTrendSnapshotIntervalMs(options = {}) {
  const n = Math.floor(Number(options.intervalMs ?? process.env.AI_GATEWAY_TREND_SNAPSHOT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS));
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_INTERVAL_MS;
  return Math.min(24 * DAY_MS, n);
}

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

/**
 * 刷新今日快照；若昨日尚未在本进程封存则一并刷新昨日。
 * @param {{ now?: Date, forceYesterday?: boolean, refresh?: typeof refreshAiGatewayTrendSnapshot }} [options]
 */
export async function runAiGatewayTrendSnapshotTick(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const refresh = typeof options.refresh === 'function' ? options.refresh : refreshAiGatewayTrendSnapshot;
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY_MS));

  const todaySnapshot = await refresh({ day: today }, { now });
  let yesterdaySnapshot = null;
  const forceYesterday = options.forceYesterday === true;
  if (forceYesterday || sealedYesterdayDay !== yesterday) {
    const endOfYesterday = new Date(`${yesterday}T23:59:59.999Z`);
    yesterdaySnapshot = await refresh({ day: yesterday }, { now: endOfYesterday });
    sealedYesterdayDay = yesterday;
  }

  return {
    today: today,
    yesterday,
    todaySnapshot,
    yesterdaySnapshot,
    sealedYesterdayDay,
  };
}

/** 测试用：重置进程内昨日封存标记 */
export function resetAiGatewayTrendSnapshotLoopStateForTests() {
  sealedYesterdayDay = '';
}

export function startAiGatewayTrendSnapshotLoop(options = {}) {
  if (snapshotTimer) return snapshotTimer;
  if (!isAiGatewayTrendSnapshotLoopEnabled()) {
    console.log('[ai-gateway-trend-snapshot] disabled');
    return null;
  }
  const intervalMs = aiGatewayTrendSnapshotIntervalMs(options);
  const tick = async () => {
    try {
      const result = await runAiGatewayTrendSnapshotTick(options);
      const y = result.yesterdaySnapshot ? ` yesterday=${result.yesterday}` : '';
      console.log(`[ai-gateway-trend-snapshot] saved today=${result.today}${y}`);
    } catch (error) {
      console.warn(
        '[ai-gateway-trend-snapshot] failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  };
  snapshotTimer = setInterval(tick, intervalMs);
  if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
  void tick();
  console.log(`[ai-gateway-trend-snapshot] interval=${intervalMs}ms`);
  return snapshotTimer;
}

export function stopAiGatewayTrendSnapshotLoop() {
  if (!snapshotTimer) return;
  clearInterval(snapshotTimer);
  snapshotTimer = null;
}

export function aiGatewayTrendSnapshotLoopStatus() {
  return {
    running: Boolean(snapshotTimer),
    enabled: isAiGatewayTrendSnapshotLoopEnabled(),
    sealedYesterdayDay: nonEmptyString(sealedYesterdayDay) || null,
  };
}
