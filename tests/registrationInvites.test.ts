import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  normalizeRegistrationInviteCode,
  formatRegistrationInviteCode,
  registrationInviteErrorMessage,
  getRegistrationMode,
  createRegistrationInvite,
  peekRegistrationInviteCode,
  consumeRegistrationInviteCode,
  revokeRegistrationInvite,
} from '../server/registration-invites.js';

const DATA_PATH = path.resolve(process.cwd(), 'server/data/registration-invites.json');

function backupStore(): string | null {
  if (!fs.existsSync(DATA_PATH)) return null;
  return fs.readFileSync(DATA_PATH, 'utf8');
}

function restoreStore(backup: string | null) {
  if (backup === null) {
    if (fs.existsSync(DATA_PATH)) fs.unlinkSync(DATA_PATH);
    return;
  }
  fs.writeFileSync(DATA_PATH, backup, 'utf8');
}

describe('registration-invites helpers', () => {
  it('normalizes and formats invite codes', () => {
    expect(normalizeRegistrationInviteCode('ac-abcd-efgh')).toBe('ACABCDEFGH');
    expect(formatRegistrationInviteCode('ACABCDEFGH')).toBe('AC-ABCD-EFGH');
  });

  it('maps error reasons to messages', () => {
    expect(registrationInviteErrorMessage('used')).toContain('已使用');
    expect(registrationInviteErrorMessage('required')).toContain('邀请码');
  });

  it('reads registration mode from env', () => {
    const prevMode = process.env.REGISTRATION_MODE;
    delete process.env.REGISTRATION_MODE;
    expect(getRegistrationMode()).toBe('invite_only');
    process.env.REGISTRATION_MODE = 'invite_only';
    expect(getRegistrationMode()).toBe('invite_only');
    process.env.REGISTRATION_MODE = 'open';
    expect(getRegistrationMode()).toBe('open');
    if (prevMode === undefined) delete process.env.REGISTRATION_MODE;
    else process.env.REGISTRATION_MODE = prevMode;
  });
});

describe('registration-invites store', () => {
  let backup: string | null;

  beforeEach(() => {
    backup = backupStore();
    fs.writeFileSync(DATA_PATH, JSON.stringify({ invites: [] }, null, 2), 'utf8');
  });

  afterEach(() => {
    restoreStore(backup);
  });

  it('create → peek → consume once', async () => {
    const created = await createRegistrationInvite({
      note: 'test',
      ttlDays: 7,
      actor: { userId: 'admin-1', identifier: 'admin' },
    });
    expect(created.code).toMatch(/^AC-/);

    const peek = await peekRegistrationInviteCode(created.code);
    expect(peek.ok).toBe(true);

    const userId = 'user-reg-invite-1';
    const consumed = await consumeRegistrationInviteCode(created.code, userId, { username: 'u1' });
    expect(consumed.ok).toBe(true);

    const peekAfter = await peekRegistrationInviteCode(created.code);
    expect(peekAfter.ok).toBe(false);
    expect(peekAfter.reason).toBe('used');

    const again = await consumeRegistrationInviteCode(created.code, 'user-2', { username: 'u2' });
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('used');
  });

  it('revoke blocks peek', async () => {
    const created = await createRegistrationInvite({
      note: '',
      ttlDays: 3,
      actor: { userId: 'admin-1', identifier: 'admin' },
    });
    await revokeRegistrationInvite(created.invite.id);
    const peek = await peekRegistrationInviteCode(created.code);
    expect(peek.ok).toBe(false);
    expect(peek.reason).toBe('revoked');
  });
});
