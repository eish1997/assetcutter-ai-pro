import type { CreditBalance, CreditLedgerEntry } from '../shared/credits';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type CreditLedgerResponse = {
  entries: CreditLedgerEntry[];
  nextCursor: string | null;
  limit: number;
};

export async function fetchCreditBalance() {
  return requestJson<CreditBalance & { userId?: string }>(apiUrl('/api/credits/balance'), { cache: 'no-store' });
}

export async function fetchCreditLedger(opts?: { limit?: number; cursor?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return requestJson<CreditLedgerResponse>(apiUrl(`/api/credits/ledger${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
  });
}
