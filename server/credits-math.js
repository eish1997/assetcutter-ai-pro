/** 与 shared/credits.ts 保持数值一致 */

export const CREDITS_PER_USD = 1000;

export const CREDITS_EXCEEDED_CODE = 'CREDITS_EXCEEDED';

export function usdEstToCredits(costUsdEst) {
  if (costUsdEst == null || !Number.isFinite(Number(costUsdEst)) || Number(costUsdEst) <= 0) return 0;
  return Math.ceil(Number(costUsdEst) * CREDITS_PER_USD);
}

export class CreditsExceededError extends Error {
  /**
   * @param {number} balance
   * @param {number} required
   */
  constructor(balance, required) {
    super('积分不足，请联系管理员补充额度');
    this.name = 'CreditsExceededError';
    this.code = CREDITS_EXCEEDED_CODE;
    this.balance = balance;
    this.required = required;
  }
}
