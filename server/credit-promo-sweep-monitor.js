/**
 * 活动积分到期 sweep 运行态监控 + 失败告警。
 */
import { isPromoLotsEnabled } from './credit-store.js';
import { maybeNotifyPromoSweepFailure } from './admin-alert-webhook.js';

const ALERT_FAIL_THRESHOLD = Math.max(
  1,
  Math.floor(Number(process.env.CREDITS_PROMO_SWEEP_ALERT_FAILS) || 3)
);

/** @type {{ enabled: boolean, lastRunAt: string | null, lastOk: boolean | null, consecutiveFailures: number, lastError: string | null, lastExpiredLots: number, lastCreditsExpired: number, alertThreshold: number }} */
const state = {
  enabled: false,
  lastRunAt: null,
  lastOk: null,
  consecutiveFailures: 0,
  lastError: null,
  lastExpiredLots: 0,
  lastCreditsExpired: 0,
  alertThreshold: ALERT_FAIL_THRESHOLD,
};

export function getPromoSweepMonitorState() {
  return {
    ...state,
    enabled: isPromoLotsEnabled(),
  };
}

/**
 * @param {{ expiredLots?: number, creditsExpired?: number }} result
 */
export function recordPromoSweepSuccess(result = {}) {
  state.enabled = isPromoLotsEnabled();
  state.lastRunAt = new Date().toISOString();
  state.lastOk = true;
  state.consecutiveFailures = 0;
  state.lastError = null;
  state.lastExpiredLots = Math.max(0, Math.floor(Number(result.expiredLots) || 0));
  state.lastCreditsExpired = Math.max(0, Math.floor(Number(result.creditsExpired) || 0));
}

/**
 * @param {unknown} err
 */
export async function recordPromoSweepFailure(err) {
  state.enabled = isPromoLotsEnabled();
  state.lastRunAt = new Date().toISOString();
  state.lastOk = false;
  state.consecutiveFailures += 1;
  state.lastError = err instanceof Error ? err.message : String(err);
  const msg = `[credit-promo-sweep] FAILED (${state.consecutiveFailures}/${ALERT_FAIL_THRESHOLD}): ${state.lastError}`;
  console.error(msg);
  if (state.consecutiveFailures >= ALERT_FAIL_THRESHOLD) {
    console.error('[credit-promo-sweep] ALERT consecutive sweep failures — check PG / credit_promo_lots');
    try {
      await maybeNotifyPromoSweepFailure({
        consecutiveFailures: state.consecutiveFailures,
        threshold: ALERT_FAIL_THRESHOLD,
        error: state.lastError,
        lastRunAt: state.lastRunAt,
      });
    } catch (notifyErr) {
      console.warn(
        '[credit-promo-sweep] alert webhook failed:',
        notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
      );
    }
  }
}
