import { randomUUID } from 'node:crypto';

type PairingSessionState = {
  sessionId: string | null;
  revocable: boolean;
  revoked: boolean;
  revokedAt: number | null;
  revokeReason: string | null;
};

const state: PairingSessionState = {
  sessionId: process.env.COMPANION_SHARED_TOKEN?.trim() ? randomUUID() : null,
  revocable: true,
  revoked: false,
  revokedAt: null,
  revokeReason: null,
};

export function isPairingRevoked(): boolean {
  return state.revoked;
}

export function getPairingSessionSummary() {
  return {
    sessionId: state.sessionId,
    tokenConfigured: Boolean(process.env.COMPANION_SHARED_TOKEN?.trim()),
    revocable: state.revocable,
    revoked: state.revoked,
    revokedAt: state.revokedAt,
    revokeReason: state.revokeReason,
  };
}

export function revokePairingSession(reason?: string) {
  state.revoked = true;
  state.revokedAt = Date.now();
  state.revokeReason = reason?.trim() || 'manual_revoke';
  return getPairingSessionSummary();
}
