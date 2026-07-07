/**
 * 账号级积分余额与流水 — Postgres 或 auth-db.json 镜像。
 */
import crypto from 'crypto';
import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from './auth-store.js';
import { CreditsExceededError, usdEstToCredits, CREDITS_EXCEEDED_CODE } from './credits-math.js';
import { priceUsageQuote } from './pricing-engine.js';

export { CreditsExceededError, usdEstToCredits, CREDITS_EXCEEDED_CODE };

const MAX_JSON_LEDGER = 50000;
const MAX_JSON_RESERVES = 20000;
const LEDGER_KINDS = new Set(['grant', 'admin_deduct', 'consume', 'refund']);
const RESERVE_STATUSES = new Set(['active', 'precharged', 'finalized', 'released']);
const RESERVE_TTL_MS = Math.min(
  3_600_000,
  Math.max(60_000, Number(process.env.CREDITS_RESERVE_TTL_MS || 15 * 60 * 1000))
);

export function isCreditsBillingEnabled() {
  const raw = String(process.env.CREDITS_BILLING_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBalance() {
  return { balance: 0, reserved: 0, available: 0, lifetimeGranted: 0, lifetimeSpent: 0, updatedAt: nowIso() };
}

function normalizeBalanceRow(row) {
  if (!row || typeof row !== 'object') return emptyBalance();
  const balance = Math.max(0, Math.floor(Number(row.balance) || 0));
  const reserved = Math.max(0, Math.floor(Number(row.reserved) || 0));
  return {
    balance,
    reserved,
    available: Math.max(0, balance - reserved),
    lifetimeGranted: Math.max(0, Math.floor(Number(row.lifetimeGranted ?? row.lifetime_granted) || 0)),
    lifetimeSpent: Math.max(0, Math.floor(Number(row.lifetimeSpent ?? row.lifetime_spent) || 0)),
    updatedAt: row.updatedAt ?? row.updated_at ?? nowIso(),
  };
}

function mapLedgerRow(r) {
  return {
    id: r.id,
    userId: r.user_id ?? r.userId,
    delta: Number(r.delta),
    balanceAfter: Number(r.balance_after ?? r.balanceAfter),
    kind: r.kind,
    refType: r.ref_type ?? r.refType ?? null,
    refId: r.ref_id ?? r.refId ?? null,
    idempotencyKey: r.idempotency_key ?? r.idempotencyKey ?? null,
    note: r.note ?? null,
    createdBy: r.created_by ?? r.createdBy ?? null,
    createdAt: r.created_at ?? r.createdAt,
  };
}

export async function ensureCreditStore() {
  if (!USE_POSTGRES) return;
  await ensurePostgres();
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_credit_balances (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
      lifetime_granted BIGINT NOT NULL DEFAULT 0,
      lifetime_spent BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta BIGINT NOT NULL,
      balance_after BIGINT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('grant', 'admin_deduct', 'consume', 'refund')),
      ref_type TEXT NULL,
      ref_id TEXT NULL,
      idempotency_key TEXT NULL UNIQUE,
      note TEXT NULL,
      created_by TEXT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_credit_ledger_ref ON credit_ledger(ref_type, ref_id) WHERE ref_id IS NOT NULL;`
  );
  await p.query(`ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS credits_charged BIGINT NULL;`);
  await p.query(`ALTER TABLE user_credit_balances ADD COLUMN IF NOT EXISTS reserved BIGINT NOT NULL DEFAULT 0;`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS credit_reserves (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'precharged', 'finalized', 'released')),
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_credit_reserves_user_status ON credit_reserves(user_id, status);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_credit_reserves_expires ON credit_reserves(expires_at) WHERE status IN ('active', 'precharged');`
  );
  await p.query(`ALTER TABLE credit_reserves ADD COLUMN IF NOT EXISTS allocated BIGINT NOT NULL DEFAULT 0;`);
  try {
    await p.query(`ALTER TABLE credit_reserves DROP CONSTRAINT IF EXISTS credit_reserves_status_check;`);
    await p.query(
      `ALTER TABLE credit_reserves ADD CONSTRAINT credit_reserves_status_check CHECK (status IN ('active', 'precharged', 'finalized', 'released'));`
    );
  } catch {
    /* ignore if already applied */
  }
}

async function ensureBalanceRowPg(client, userId) {
  await client.query(
    `INSERT INTO user_credit_balances (user_id, balance, lifetime_granted, lifetime_spent, updated_at)
     VALUES ($1, 0, 0, 0, now())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

function ensureBalanceRowJson(db, userId) {
  if (!db.creditBalances || typeof db.creditBalances !== 'object') db.creditBalances = {};
  if (!db.creditBalances[userId]) {
    db.creditBalances[userId] = emptyBalance();
  }
  return db.creditBalances[userId];
}

/**
 * @param {string} userId
 */
export async function getCreditBalance(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return emptyBalance();

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    await ensureBalanceRowPg(p, uid);
    await cleanupExpiredCreditReserves(uid);
    const res = await p.query(
      `SELECT balance, reserved, lifetime_granted, lifetime_spent, updated_at FROM user_credit_balances WHERE user_id = $1`,
      [uid]
    );
    const row = res.rows[0];
    return normalizeBalanceRow({
      balance: row?.balance,
      reserved: row?.reserved,
      lifetimeGranted: row?.lifetime_granted,
      lifetimeSpent: row?.lifetime_spent,
      updatedAt: row?.updated_at,
    });
  }

  const db = readDb();
  return normalizeBalanceRow(ensureBalanceRowJson(db, uid));
}

/**
 * @param {string[]} userIds
 */
export async function getCreditBalancesForUsers(userIds) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = emptyBalance();
  if (!ids.length) return out;

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    for (const uid of ids) await ensureBalanceRowPg(p, uid);
    const res = await p.query(
      `SELECT user_id, balance, reserved, lifetime_granted, lifetime_spent, updated_at
       FROM user_credit_balances WHERE user_id = ANY($1::text[])`,
      [ids]
    );
    for (const row of res.rows) {
      out[row.user_id] = normalizeBalanceRow({
        balance: row.balance,
        reserved: row.reserved,
        lifetimeGranted: row.lifetime_granted,
        lifetimeSpent: row.lifetime_spent,
        updatedAt: row.updated_at,
      });
    }
    return out;
  }

  const db = readDb();
  for (const uid of ids) {
    out[uid] = normalizeBalanceRow(ensureBalanceRowJson(db, uid));
  }
  return out;
}

/**
 * @param {string} userId
 * @param {number} estimatedCredits
 */
export async function precheckCredits(userId, estimatedCredits = 1) {
  const required = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  const bal = await getCreditBalance(userId);
  const available = bal.available ?? Math.max(0, bal.balance - (bal.reserved || 0));
  return {
    ok: available >= required,
    balance: bal.balance,
    available,
    reserved: bal.reserved || 0,
    required,
  };
}

function reserveExpiresAtIso() {
  return new Date(Date.now() + RESERVE_TTL_MS).toISOString();
}

function ensureReservesJson(db) {
  if (!Array.isArray(db.creditReserves)) db.creditReserves = [];
}

async function releaseReserveRowPg(client, reserveRow, opts = {}) {
  if (!reserveRow) return false;
  const status = String(reserveRow.status || '');
  if (status === 'precharged') {
    return refundPrechargeRowPg(client, reserveRow, opts);
  }
  if (status !== 'active') return false;
  await client.query(`UPDATE credit_reserves SET status = 'released' WHERE id = $1 AND status = 'active'`, [
    reserveRow.id,
  ]);
  await client.query(
    `UPDATE user_credit_balances
     SET reserved = GREATEST(0, reserved - $2), updated_at = now()
     WHERE user_id = $1`,
    [reserveRow.user_id ?? reserveRow.userId, Number(reserveRow.amount)]
  );
  return true;
}

async function refundPrechargeRowPg(client, reserveRow, opts = {}) {
  const fullVoid = Boolean(opts.fullVoid);
  const status = String(reserveRow.status || '');
  if (status !== 'precharged') return false;
  const uid = reserveRow.user_id ?? reserveRow.userId;
  const total = Math.max(0, Math.floor(Number(reserveRow.amount) || 0));
  const allocated = Math.max(0, Math.floor(Number(reserveRow.allocated) || 0));
  const refund = fullVoid ? total : Math.max(0, total - allocated);
  await client.query(`UPDATE credit_reserves SET status = 'released' WHERE id = $1 AND status = 'precharged'`, [
    reserveRow.id,
  ]);
  if (fullVoid && allocated > 0) {
    await client.query(
      `UPDATE user_credit_balances
       SET lifetime_spent = GREATEST(0, lifetime_spent - $2), updated_at = now()
       WHERE user_id = $1`,
      [uid, allocated]
    );
  }
  if (refund > 0) {
    await client.query(
      `UPDATE user_credit_balances SET balance = balance + $2, updated_at = now() WHERE user_id = $1`,
      [uid, refund]
    );
    const balRes = await client.query(`SELECT balance FROM user_credit_balances WHERE user_id = $1`, [uid]);
    const balanceAfter = Number(balRes.rows[0]?.balance ?? 0);
    const ledgerId = crypto.randomUUID();
    const note = fullVoid ? '任务失败全额退还预扣' : '预扣未用退还';
    const idemKey = fullVoid
      ? `void:${reserveRow.idempotency_key ?? reserveRow.idempotencyKey ?? reserveRow.id}`
      : `refund:${reserveRow.idempotency_key ?? reserveRow.idempotencyKey ?? reserveRow.id}`;
    await client.query(
      `INSERT INTO credit_ledger
       (id, user_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key, note, created_by, created_at)
       VALUES ($1,$2,$3,$4,'refund','precharge',$5,$6,$7,NULL,now())`,
      [
        ledgerId,
        uid,
        refund,
        balanceAfter,
        reserveRow.idempotency_key ?? reserveRow.idempotencyKey ?? null,
        idemKey,
        note,
      ]
    );
  }
  return true;
}

function releaseReserveRowJson(db, reserveRow, opts = {}) {
  if (!reserveRow) return false;
  const status = String(reserveRow.status || '');
  if (status === 'precharged') {
    return refundPrechargeRowJson(db, reserveRow, opts);
  }
  if (status !== 'active') return false;
  reserveRow.status = 'released';
  const uid = String(reserveRow.userId || reserveRow.user_id || '').trim();
  const bal = ensureBalanceRowJson(db, uid);
  bal.reserved = Math.max(0, Math.floor(Number(bal.reserved) || 0) - Number(reserveRow.amount));
  bal.updatedAt = nowIso();
  return true;
}

function refundPrechargeRowJson(db, reserveRow, opts = {}) {
  const fullVoid = Boolean(opts.fullVoid);
  const status = String(reserveRow.status || '');
  if (status !== 'precharged') return false;
  const uid = String(reserveRow.userId || reserveRow.user_id || '').trim();
  const total = Math.max(0, Math.floor(Number(reserveRow.amount) || 0));
  const allocated = Math.max(0, Math.floor(Number(reserveRow.allocated) || 0));
  const refund = fullVoid ? total : Math.max(0, total - allocated);
  reserveRow.status = 'released';
  const bal = ensureBalanceRowJson(db, uid);
  if (fullVoid && allocated > 0) {
    bal.lifetimeSpent = Math.max(0, Math.floor(Number(bal.lifetimeSpent) || 0) - allocated);
  }
  if (refund > 0) {
    bal.balance = Math.max(0, Math.floor(Number(bal.balance) || 0) + refund);
    if (!Array.isArray(db.creditLedger)) db.creditLedger = [];
    const ledgerId = crypto.randomUUID();
    const note = fullVoid ? '任务失败全额退还预扣' : '预扣未用退还';
    const idemKey = fullVoid
      ? `void:${reserveRow.idempotencyKey ?? reserveRow.id}`
      : `refund:${reserveRow.idempotencyKey ?? reserveRow.id}`;
    db.creditLedger.push({
      id: ledgerId,
      userId: uid,
      delta: refund,
      balanceAfter: bal.balance,
      kind: 'refund',
      refType: 'precharge',
      refId: reserveRow.idempotencyKey ?? null,
      idempotencyKey: idemKey,
      note,
      createdBy: null,
      createdAt: nowIso(),
    });
  }
  bal.updatedAt = nowIso();
  return true;
}

/** 清理过期预扣（active → released） */
export async function cleanupExpiredCreditReserves(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return 0;

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query(
        `SELECT id, user_id, amount, allocated, status, idempotency_key FROM credit_reserves
         WHERE user_id = $1 AND status IN ('active', 'precharged') AND expires_at <= now() FOR UPDATE`,
        [uid]
      );
      let n = 0;
      for (const row of expired.rows) {
        if (await releaseReserveRowPg(client, row)) n += 1;
      }
      await client.query('COMMIT');
      return n;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  ensureReservesJson(db);
  const now = Date.now();
  let n = 0;
  for (const row of db.creditReserves) {
    if (String(row.userId) !== uid) continue;
    if (row.status !== 'active' && row.status !== 'precharged') continue;
    if (Date.parse(String(row.expiresAt)) > now) continue;
    if (releaseReserveRowJson(db, row)) n += 1;
  }
  if (n > 0) writeDb(db);
  return n;
}

/**
 * 预扣积分（幂等 idempotencyKey）；available 不足时抛错。
 * @param {string} userId
 * @param {number} amount
 * @param {{ idempotencyKey?: string }} opts
 */
export async function reserveCredits(userId, amount, opts = {}) {
  const uid = String(userId || '').trim();
  const amt = Math.max(1, Math.floor(Number(amount) || 1));
  const idempotencyKey = String(opts.idempotencyKey || `reserve:${crypto.randomUUID()}`)
    .trim()
    .slice(0, 200);
  if (!uid) throw new Error('无效用户');

  await cleanupExpiredCreditReserves(uid);

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const dup = await client.query(`SELECT * FROM credit_reserves WHERE idempotency_key = $1`, [idempotencyKey]);
      if (dup.rows[0]) {
        const existingAmount = Number(dup.rows[0].amount);
        if (existingAmount !== amt) {
          throw new Error(`幂等键冲突：已有预扣 ${existingAmount} 积分，本次请求 ${amt} 积分`);
        }
        await client.query('COMMIT');
        const row = dup.rows[0];
        return {
          reserveKey: row.idempotency_key,
          amount: Number(row.amount),
          status: row.status,
          duplicate: true,
        };
      }
      await ensureBalanceRowPg(client, uid);
      const lock = await client.query(
        `SELECT balance, reserved FROM user_credit_balances WHERE user_id = $1 FOR UPDATE`,
        [uid]
      );
      const prev = normalizeBalanceRow(lock.rows[0]);
      if (prev.available < amt) {
        throw new CreditsExceededError(prev.balance, amt);
      }
      const reserveId = crypto.randomUUID();
      const expiresAt = reserveExpiresAtIso();
      await client.query(
        `INSERT INTO credit_reserves (id, user_id, amount, status, idempotency_key, created_at, expires_at)
         VALUES ($1,$2,$3,'active',$4,now(),$5::timestamptz)`,
        [reserveId, uid, amt, idempotencyKey, expiresAt]
      );
      await client.query(
        `UPDATE user_credit_balances SET reserved = reserved + $2, updated_at = now() WHERE user_id = $1`,
        [uid, amt]
      );
      await client.query('COMMIT');
      return { reserveKey: idempotencyKey, amount: amt, status: 'active', duplicate: false };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  ensureReservesJson(db);
  const existing = db.creditReserves.find((r) => r.idempotencyKey === idempotencyKey);
  if (existing) {
    const existingAmount = Number(existing.amount);
    if (existingAmount !== amt) {
      throw new Error(`幂等键冲突：已有预扣 ${existingAmount} 积分，本次请求 ${amt} 积分`);
    }
    return {
      reserveKey: existing.idempotencyKey,
      amount: Number(existing.amount),
      status: existing.status,
      duplicate: true,
    };
  }
  const prev = normalizeBalanceRow(ensureBalanceRowJson(db, uid));
  if (prev.available < amt) {
    throw new CreditsExceededError(prev.balance, amt);
  }
  const reserveId = crypto.randomUUID();
  const expiresAt = reserveExpiresAtIso();
  db.creditReserves.push({
    id: reserveId,
    userId: uid,
    amount: amt,
    status: 'active',
    idempotencyKey,
    createdAt: nowIso(),
    expiresAt,
  });
  db.creditBalances[uid] = {
    ...prev,
    reserved: (prev.reserved || 0) + amt,
    updatedAt: nowIso(),
  };
  if (db.creditReserves.length > MAX_JSON_RESERVES) {
    db.creditReserves = db.creditReserves
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_JSON_RESERVES);
  }
  writeDb(db);
  return { reserveKey: idempotencyKey, amount: amt, status: 'active', duplicate: false };
}

/**
 * 先预扣费：立即从 balance 扣除，后续 L2 从预扣池 allocate；失败/未用部分可 refund。
 * @param {string} userId
 * @param {number} amount
 * @param {{ idempotencyKey?: string }} opts
 */
export async function prechargeCredits(userId, amount, opts = {}) {
  const uid = String(userId || '').trim();
  const amt = Math.max(1, Math.floor(Number(amount) || 1));
  const idempotencyKey = String(opts.idempotencyKey || `precharge:${crypto.randomUUID()}`)
    .trim()
    .slice(0, 200);
  if (!uid) throw new Error('无效用户');

  await cleanupExpiredCreditReserves(uid);

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM credit_reserves WHERE idempotency_key = $1 AND status = 'released'`,
        [idempotencyKey]
      );
      const dup = await client.query(
        `SELECT * FROM credit_reserves WHERE idempotency_key = $1 AND status IN ('active', 'precharged')`,
        [idempotencyKey]
      );
      if (dup.rows[0]) {
        const row = dup.rows[0];
        const existingAmount = Number(row.amount);
        const allocated = Math.max(0, Math.floor(Number(row.allocated) || 0));
        if (existingAmount !== amt) {
          if (
            !opts._retryAfterAmountMismatch &&
            allocated === 0 &&
            String(row.status) === 'precharged'
          ) {
            await client.query('ROLLBACK');
            client.release();
            await releaseCreditReserve(uid, idempotencyKey, { fullVoid: true });
            return prechargeCredits(userId, amount, { ...opts, _retryAfterAmountMismatch: true });
          }
          throw new Error(`幂等键冲突：已有预扣 ${existingAmount} 积分，本次请求 ${amt} 积分`);
        }
        await client.query('COMMIT');
        return {
          prechargeKey: row.idempotency_key,
          reserveKey: row.idempotency_key,
          amount: Number(row.amount),
          allocated,
          remaining: Math.max(0, Number(row.amount) - allocated),
          status: row.status,
          duplicate: true,
        };
      }
      await ensureBalanceRowPg(client, uid);
      const lock = await client.query(
        `SELECT balance, reserved FROM user_credit_balances WHERE user_id = $1 FOR UPDATE`,
        [uid]
      );
      const prev = normalizeBalanceRow(lock.rows[0]);
      if (prev.balance < amt) {
        throw new CreditsExceededError(prev.balance, amt);
      }
      const reserveId = crypto.randomUUID();
      const expiresAt = reserveExpiresAtIso();
      await client.query(
        `INSERT INTO credit_reserves (id, user_id, amount, allocated, status, idempotency_key, created_at, expires_at)
         VALUES ($1,$2,$3,0,'precharged',$4,now(),$5::timestamptz)`,
        [reserveId, uid, amt, idempotencyKey, expiresAt]
      );
      await client.query(
        `UPDATE user_credit_balances SET balance = balance - $2, updated_at = now() WHERE user_id = $1`,
        [uid, amt]
      );
      await client.query('COMMIT');
      return {
        prechargeKey: idempotencyKey,
        reserveKey: idempotencyKey,
        amount: amt,
        allocated: 0,
        remaining: amt,
        status: 'precharged',
        duplicate: false,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  ensureReservesJson(db);
  db.creditReserves = db.creditReserves.filter(
    (r) => !(r.idempotencyKey === idempotencyKey && r.status === 'released')
  );
  const existing = db.creditReserves.find(
    (r) =>
      r.idempotencyKey === idempotencyKey &&
      (r.status === 'active' || r.status === 'precharged')
  );
  if (existing) {
    const existingAmount = Number(existing.amount);
    const allocated = Math.max(0, Math.floor(Number(existing.allocated) || 0));
    if (existingAmount !== amt) {
      if (
        !opts._retryAfterAmountMismatch &&
        allocated === 0 &&
        String(existing.status) === 'precharged'
      ) {
        releaseReserveRowJson(db, existing, { fullVoid: true });
        writeDb(db);
        return prechargeCredits(userId, amount, { ...opts, _retryAfterAmountMismatch: true });
      }
      throw new Error(`幂等键冲突：已有预扣 ${existingAmount} 积分，本次请求 ${amt} 积分`);
    }
    return {
      prechargeKey: existing.idempotencyKey,
      reserveKey: existing.idempotencyKey,
      amount: existingAmount,
      allocated,
      remaining: Math.max(0, existingAmount - allocated),
      status: existing.status,
      duplicate: true,
    };
  }
  const prev = normalizeBalanceRow(ensureBalanceRowJson(db, uid));
  if (prev.balance < amt) {
    throw new CreditsExceededError(prev.balance, amt);
  }
  const reserveId = crypto.randomUUID();
  const expiresAt = reserveExpiresAtIso();
  db.creditReserves.push({
    id: reserveId,
    userId: uid,
    amount: amt,
    allocated: 0,
    status: 'precharged',
    idempotencyKey,
    createdAt: nowIso(),
    expiresAt,
  });
  db.creditBalances[uid] = {
    ...prev,
    balance: prev.balance - amt,
    updatedAt: nowIso(),
  };
  if (db.creditReserves.length > MAX_JSON_RESERVES) {
    db.creditReserves = db.creditReserves
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_JSON_RESERVES);
  }
  writeDb(db);
  return {
    prechargeKey: idempotencyKey,
    reserveKey: idempotencyKey,
    amount: amt,
    allocated: 0,
    remaining: amt,
    status: 'precharged',
    duplicate: false,
  };
}

/**
 * @param {string} userId
 * @param {string} reserveKey
 * @param {number} [minAmount]
 */
export async function validateActiveCreditReserve(userId, reserveKey, minAmount = 1) {
  const uid = String(userId || '').trim();
  const key = String(reserveKey || '').trim();
  const min = Math.max(1, Math.floor(Number(minAmount) || 1));
  if (!uid || !key) return { ok: false, error: 'invalid reserve' };

  await cleanupExpiredCreditReserves(uid);

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const res = await p.query(
      `SELECT amount, allocated, status, expires_at FROM credit_reserves
       WHERE user_id = $1 AND idempotency_key = $2`,
      [uid, key]
    );
    const row = res.rows[0];
    if (!row) return { ok: false, error: 'reserve not active' };
    const status = String(row.status || '');
    if (status !== 'active' && status !== 'precharged') return { ok: false, error: 'reserve not active' };
    if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, error: 'reserve expired' };
    if (status === 'precharged') {
      const remaining = Math.max(0, Number(row.amount) - Math.floor(Number(row.allocated) || 0));
      if (remaining < min) return { ok: false, error: 'precharge remaining insufficient' };
      return { ok: true, amount: Number(row.amount), remaining, precharged: true };
    }
    if (Number(row.amount) < min) return { ok: false, error: 'reserve amount insufficient' };
    return { ok: true, amount: Number(row.amount), precharged: false };
  }

  const db = readDb();
  ensureReservesJson(db);
  const row = db.creditReserves.find((r) => String(r.userId) === uid && r.idempotencyKey === key);
  if (!row) return { ok: false, error: 'reserve not active' };
  const status = String(row.status || '');
  if (status !== 'active' && status !== 'precharged') return { ok: false, error: 'reserve not active' };
  if (Date.parse(String(row.expiresAt)) <= Date.now()) return { ok: false, error: 'reserve expired' };
  if (status === 'precharged') {
    const remaining = Math.max(0, Number(row.amount) - Math.floor(Number(row.allocated) || 0));
    if (remaining < min) return { ok: false, error: 'precharge remaining insufficient' };
    return { ok: true, amount: Number(row.amount), remaining, precharged: true };
  }
  if (Number(row.amount) < min) return { ok: false, error: 'reserve amount insufficient' };
  return { ok: true, amount: Number(row.amount), precharged: false };
}

export async function releaseCreditReserve(userId, reserveKey, opts = {}) {
  const uid = String(userId || '').trim();
  const key = String(reserveKey || '').trim();
  if (!uid || !key) return { released: false };

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `SELECT * FROM credit_reserves WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [uid, key]
      );
      const row = res.rows[0];
      const released = row ? await releaseReserveRowPg(client, row, opts) : false;
      await client.query('COMMIT');
      return { released, fullVoid: Boolean(opts.fullVoid) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  ensureReservesJson(db);
  const row = db.creditReserves.find((r) => String(r.userId) === uid && r.idempotencyKey === key);
  const released = row ? releaseReserveRowJson(db, row, opts) : false;
  if (released) writeDb(db);
  return { released, fullVoid: Boolean(opts.fullVoid) };
}

/**
 * JSON 模式释放预扣（与 usage insert 共用同一 db 对象，避免 writeDb 覆盖）。
 */
export function releaseCreditReserveJson(db, userId, reserveKey) {
  const uid = String(userId || '').trim();
  const key = String(reserveKey || '').trim();
  if (!uid || !key) return { released: false };
  ensureReservesJson(db);
  const row = db.creditReserves.find((r) => String(r.userId) === uid && r.idempotencyKey === key);
  const released = row ? releaseReserveRowJson(db, row) : false;
  return { released };
}

export async function releaseCreditReserveInTx(client, userId, reserveKey) {
  const uid = String(userId || '').trim();
  const key = String(reserveKey || '').trim();
  if (!uid || !key) return;
  const res = await client.query(
    `SELECT * FROM credit_reserves WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
    [uid, key]
  );
  const row = res.rows[0];
  if (row) await releaseReserveRowPg(client, row);
}

async function allocateFromPrechargeInTx(client, userId, prechargeKey, credits, opts = {}) {
  const uid = String(userId || '').trim();
  const key = String(prechargeKey || '').trim();
  const amount = Math.floor(Number(credits));
  const usageEventId = opts.usageEventId ? String(opts.usageEventId) : null;
  const idempotencyKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 200) : null;
  if (!uid || !key || amount <= 0) return null;

  const res = await client.query(
    `SELECT * FROM credit_reserves WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
    [uid, key]
  );
  const row = res.rows[0];
  if (!row || String(row.status) !== 'precharged') return null;

  if (idempotencyKey) {
    const dup = await client.query(`SELECT balance_after FROM credit_ledger WHERE idempotency_key = $1`, [
      idempotencyKey,
    ]);
    if (dup.rows[0]) {
      const balRes = await client.query(`SELECT balance FROM user_credit_balances WHERE user_id = $1`, [uid]);
      return {
        balanceAfter: Number(balRes.rows[0]?.balance ?? 0),
        duplicate: true,
        skipped: false,
        fromPrecharge: true,
      };
    }
  }

  const total = Math.max(0, Math.floor(Number(row.amount) || 0));
  const allocated = Math.max(0, Math.floor(Number(row.allocated) || 0));
  const remaining = Math.max(0, total - allocated);
  if (amount > remaining) {
    throw new CreditsExceededError(remaining, amount);
  }

  const newAllocated = allocated + amount;
  const newStatus = newAllocated >= total ? 'finalized' : 'precharged';
  await client.query(`UPDATE credit_reserves SET allocated = $2, status = $3 WHERE id = $1`, [
    row.id,
    newAllocated,
    newStatus,
  ]);

  await ensureBalanceRowPg(client, uid);
  const lock = await client.query(
    `SELECT balance, lifetime_spent FROM user_credit_balances WHERE user_id = $1 FOR UPDATE`,
    [uid]
  );
  const prev = normalizeBalanceRow(lock.rows[0]);
  const lifetimeSpent = prev.lifetimeSpent + amount;
  await client.query(`UPDATE user_credit_balances SET lifetime_spent = $2, updated_at = now() WHERE user_id = $1`, [
    uid,
    lifetimeSpent,
  ]);

  const ledgerId = crypto.randomUUID();
  await client.query(
    `INSERT INTO credit_ledger
     (id, user_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key, note, created_by, created_at)
     VALUES ($1,$2,$3,$4,'consume','usage_event',$5,$6,NULL,NULL,now())`,
    [ledgerId, uid, -amount, prev.balance, usageEventId, idempotencyKey]
  );

  return {
    balanceAfter: prev.balance,
    ledgerId,
    duplicate: false,
    skipped: false,
    fromPrecharge: true,
    prechargeRemaining: Math.max(0, total - newAllocated),
  };
}

function allocateFromPrechargeJson(db, userId, prechargeKey, credits, opts = {}) {
  const uid = String(userId || '').trim();
  const key = String(prechargeKey || '').trim();
  const amount = Math.floor(Number(credits));
  const usageEventId = opts.usageEventId ? String(opts.usageEventId) : null;
  const idempotencyKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 200) : null;
  if (!uid || !key || amount <= 0) return null;

  ensureReservesJson(db);
  const row = db.creditReserves.find((r) => String(r.userId) === uid && r.idempotencyKey === key);
  if (!row || String(row.status) !== 'precharged') return null;

  if (!Array.isArray(db.creditLedger)) db.creditLedger = [];
  if (idempotencyKey) {
    const dup = db.creditLedger.find((e) => e.idempotencyKey === idempotencyKey);
    if (dup) {
      return {
        balanceAfter: dup.balanceAfter,
        duplicate: true,
        skipped: false,
        fromPrecharge: true,
      };
    }
  }

  const total = Math.max(0, Math.floor(Number(row.amount) || 0));
  const allocated = Math.max(0, Math.floor(Number(row.allocated) || 0));
  const remaining = Math.max(0, total - allocated);
  if (amount > remaining) {
    throw new CreditsExceededError(remaining, amount);
  }

  row.allocated = allocated + amount;
  if (row.allocated >= total) row.status = 'finalized';

  const prev = normalizeBalanceRow(ensureBalanceRowJson(db, uid));
  db.creditBalances[uid] = {
    ...prev,
    lifetimeSpent: prev.lifetimeSpent + amount,
    updatedAt: nowIso(),
  };

  const ledgerId = crypto.randomUUID();
  db.creditLedger.push({
    id: ledgerId,
    userId: uid,
    delta: -amount,
    balanceAfter: prev.balance,
    kind: 'consume',
    refType: 'usage_event',
    refId: usageEventId,
    idempotencyKey,
    note: null,
    createdBy: null,
    createdAt: nowIso(),
  });

  return {
    balanceAfter: prev.balance,
    ledgerId,
    duplicate: false,
    skipped: false,
    fromPrecharge: true,
    prechargeRemaining: Math.max(0, total - row.allocated),
  };
}

/**
 * @param {string} userId
 * @param {number} delta
 * @param {{ note: string, createdBy?: string, idempotencyKey?: string }} opts
 */
export async function adjustCredits(userId, delta, opts = {}) {
  const uid = String(userId || '').trim();
  const d = Math.floor(Number(delta));
  const note = String(opts.note || '').trim();
  const createdBy = opts.createdBy ? String(opts.createdBy).trim() : null;
  const idempotencyKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 200) : null;

  if (!uid) throw new Error('无效用户');
  if (!Number.isFinite(d) || d === 0) throw new Error('调整量须为非零整数');
  if (!note || note.length > 500) throw new Error('备注必填且不超过 500 字');

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      if (idempotencyKey) {
        const dup = await client.query(`SELECT * FROM credit_ledger WHERE idempotency_key = $1`, [idempotencyKey]);
        if (dup.rows[0]) {
          await client.query('COMMIT');
          return { balanceAfter: Number(dup.rows[0].balance_after), ledgerId: dup.rows[0].id, duplicate: true };
        }
      }
      await ensureBalanceRowPg(client, uid);
      const lock = await client.query(
        `SELECT balance, lifetime_granted, lifetime_spent FROM user_credit_balances WHERE user_id = $1 FOR UPDATE`,
        [uid]
      );
      const prev = normalizeBalanceRow(lock.rows[0]);
      const nextBalance = prev.balance + d;
      if (nextBalance < 0) throw new Error('扣回数量不能超过当前余额');
      if (d < 0 && nextBalance < (prev.reserved || 0)) {
        throw new Error('扣回数量不能超过可用余额（已有积分被预扣占用）');
      }

      const kind = d > 0 ? 'grant' : 'admin_deduct';
      const lifetimeGranted = prev.lifetimeGranted + (d > 0 ? d : 0);
      const lifetimeSpent = prev.lifetimeSpent;

      await client.query(
        `UPDATE user_credit_balances
         SET balance = $2, lifetime_granted = $3, lifetime_spent = $4, updated_at = now()
         WHERE user_id = $1`,
        [uid, nextBalance, lifetimeGranted, lifetimeSpent]
      );

      const ledgerId = crypto.randomUUID();
      await client.query(
        `INSERT INTO credit_ledger
         (id, user_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key, note, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,'admin_adjust',NULL,$6,$7,$8,now())`,
        [ledgerId, uid, d, nextBalance, kind, idempotencyKey, note, createdBy]
      );
      await client.query('COMMIT');
      return { balanceAfter: nextBalance, ledgerId, duplicate: false };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  if (!Array.isArray(db.creditLedger)) db.creditLedger = [];
  if (idempotencyKey) {
    const dup = db.creditLedger.find((e) => e.idempotencyKey === idempotencyKey);
    if (dup) return { balanceAfter: dup.balanceAfter, ledgerId: dup.id, duplicate: true };
  }

  const prev = normalizeBalanceRow(ensureBalanceRowJson(db, uid));
  const nextBalance = prev.balance + d;
  if (nextBalance < 0) throw new Error('扣回数量不能超过当前余额');
  if (d < 0 && nextBalance < (prev.reserved || 0)) {
    throw new Error('扣回数量不能超过可用余额（已有积分被预扣占用）');
  }

  const kind = d > 0 ? 'grant' : 'admin_deduct';
  const lifetimeGranted = prev.lifetimeGranted + (d > 0 ? d : 0);
  db.creditBalances[uid] = {
    balance: nextBalance,
    reserved: prev.reserved || 0,
    lifetimeGranted,
    lifetimeSpent: prev.lifetimeSpent,
    updatedAt: nowIso(),
  };

  const ledgerId = crypto.randomUUID();
  db.creditLedger.push({
    id: ledgerId,
    userId: uid,
    delta: d,
    balanceAfter: nextBalance,
    kind,
    refType: 'admin_adjust',
    refId: null,
    idempotencyKey,
    note,
    createdBy,
    createdAt: nowIso(),
  });
  if (db.creditLedger.length > MAX_JSON_LEDGER) {
    db.creditLedger = db.creditLedger
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_JSON_LEDGER);
  }
  writeDb(db);
  return { balanceAfter: nextBalance, ledgerId, duplicate: false };
}

/**
 * 与 usage event 同事务扣积分（Postgres client 由调用方 BEGIN/COMMIT）。
 * @param {import('pg').PoolClient} client
 */
export async function consumeCreditsInTx(client, userId, credits, opts = {}) {
  const uid = String(userId || '').trim();
  const amount = Math.floor(Number(credits));
  const usageEventId = opts.usageEventId ? String(opts.usageEventId) : null;
  const idempotencyKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 200) : null;
  const reserveKey = opts.reserveKey ? String(opts.reserveKey).trim().slice(0, 200) : null;

  if (!uid || amount <= 0) return { balanceAfter: (await getCreditBalance(uid)).balance, skipped: true };

  if (idempotencyKey) {
    const dup = await client.query(`SELECT balance_after FROM credit_ledger WHERE idempotency_key = $1`, [
      idempotencyKey,
    ]);
    if (dup.rows[0]) {
      return { balanceAfter: Number(dup.rows[0].balance_after), duplicate: true, skipped: false };
    }
  }

  if (reserveKey) {
    const fromPre = await allocateFromPrechargeInTx(client, uid, reserveKey, amount, {
      usageEventId,
      idempotencyKey,
    });
    if (fromPre) return fromPre;
    await releaseCreditReserveInTx(client, uid, reserveKey);
  }

  await ensureBalanceRowPg(client, uid);
  const lock = await client.query(
    `SELECT balance, reserved, lifetime_granted, lifetime_spent FROM user_credit_balances WHERE user_id = $1 FOR UPDATE`,
    [uid]
  );
  const prev = normalizeBalanceRow(lock.rows[0]);
  if (prev.balance < amount) {
    throw new CreditsExceededError(prev.balance, amount);
  }

  const nextBalance = prev.balance - amount;
  const lifetimeSpent = prev.lifetimeSpent + amount;

  await client.query(
    `UPDATE user_credit_balances
     SET balance = $2, lifetime_spent = $3, updated_at = now()
     WHERE user_id = $1`,
    [uid, nextBalance, lifetimeSpent]
  );

  const ledgerId = crypto.randomUUID();
  await client.query(
    `INSERT INTO credit_ledger
     (id, user_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key, note, created_by, created_at)
     VALUES ($1,$2,$3,$4,'consume','usage_event',$5,$6,NULL,NULL,now())`,
    [ledgerId, uid, -amount, nextBalance, usageEventId, idempotencyKey]
  );

  return { balanceAfter: nextBalance, ledgerId, duplicate: false, skipped: false };
}

/**
 * JSON 模式扣积分（无 PG 事务，与 usage insert 顺序调用）。
 */
export function consumeCreditsJson(db, userId, credits, opts = {}) {
  const uid = String(userId || '').trim();
  const amount = Math.floor(Number(credits));
  const usageEventId = opts.usageEventId ? String(opts.usageEventId) : null;
  const idempotencyKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 200) : null;
  const reserveKey = opts.reserveKey ? String(opts.reserveKey).trim().slice(0, 200) : null;

  if (!uid || amount <= 0) return { balanceAfter: normalizeBalanceRow(ensureBalanceRowJson(db, uid)).balance, skipped: true };

  if (!Array.isArray(db.creditLedger)) db.creditLedger = [];
  if (idempotencyKey) {
    const dup = db.creditLedger.find((e) => e.idempotencyKey === idempotencyKey);
    if (dup) return { balanceAfter: dup.balanceAfter, duplicate: true, skipped: false };
  }

  if (reserveKey) {
    const fromPre = allocateFromPrechargeJson(db, uid, reserveKey, amount, {
      usageEventId,
      idempotencyKey,
    });
    if (fromPre) return fromPre;
    ensureReservesJson(db);
    const row = db.creditReserves.find((r) => String(r.userId) === uid && r.idempotencyKey === reserveKey);
    if (row) releaseReserveRowJson(db, row);
  }

  const prev = normalizeBalanceRow(ensureBalanceRowJson(db, uid));
  if (prev.balance < amount) {
    throw new CreditsExceededError(prev.balance, amount);
  }

  const nextBalance = prev.balance - amount;
  db.creditBalances[uid] = {
    balance: nextBalance,
    reserved: prev.reserved || 0,
    lifetimeGranted: prev.lifetimeGranted,
    lifetimeSpent: prev.lifetimeSpent + amount,
    updatedAt: nowIso(),
  };

  const ledgerId = crypto.randomUUID();
  db.creditLedger.push({
    id: ledgerId,
    userId: uid,
    delta: -amount,
    balanceAfter: nextBalance,
    kind: 'consume',
    refType: 'usage_event',
    refId: usageEventId,
    idempotencyKey,
    note: null,
    createdBy: null,
    createdAt: nowIso(),
  });

  return { balanceAfter: nextBalance, ledgerId, duplicate: false, skipped: false };
}

/**
 * @param {string} userId
 * @param {{ limit?: number, cursor?: { createdAt: string, id: string } }} query
 */
export async function listCreditLedger(userId, query = {}) {
  const uid = String(userId || '').trim();
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 20)));
  if (!uid) return { entries: [], nextCursor: null, limit };

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const params = [uid];
    let sql = `SELECT * FROM credit_ledger WHERE user_id = $1`;
    if (query.cursor?.createdAt && query.cursor?.id) {
      params.push(query.cursor.createdAt, query.cursor.id);
      sql += ` AND (created_at, id) < ($2::timestamptz, $3)`;
    }
    params.push(limit + 1);
    sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const res = await p.query(sql, params);
    const rows = res.rows.map(mapLedgerRow);
    const entries = rows.slice(0, limit);
    const next =
      rows.length > limit
        ? encodeLedgerCursor(entries[entries.length - 1])
        : null;
    return { entries, nextCursor: next, limit };
  }

  const db = readDb();
  let rows = (db.creditLedger || [])
    .filter((e) => String(e.userId) === uid)
    .map((e) => ({
      id: e.id,
      userId: e.userId,
      delta: Number(e.delta),
      balanceAfter: Number(e.balanceAfter),
      kind: e.kind,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      idempotencyKey: e.idempotencyKey ?? null,
      note: e.note ?? null,
      createdBy: e.createdBy ?? null,
      createdAt: e.createdAt,
    }))
    .sort((a, b) => {
      const c = String(b.createdAt).localeCompare(String(a.createdAt));
      return c !== 0 ? c : String(b.id).localeCompare(String(a.id));
    });

  if (query.cursor?.createdAt && query.cursor?.id) {
    const ca = query.cursor.createdAt;
    const cid = query.cursor.id;
    rows = rows.filter((r) => String(r.createdAt) < ca || (String(r.createdAt) === ca && String(r.id) < cid));
  }

  const entries = rows.slice(0, limit);
  const next = rows.length > limit ? encodeLedgerCursor(entries[entries.length - 1]) : null;
  return { entries, nextCursor: next, limit };
}

function encodeLedgerCursor(entry) {
  if (!entry) return null;
  return Buffer.from(JSON.stringify({ createdAt: entry.createdAt, id: entry.id }), 'utf8').toString('base64url');
}

export function decodeLedgerCursor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** 是否应对该 usage 事件扣积分 */
export function shouldChargeCreditsForEvent(ev) {
  if (!isCreditsBillingEnabled()) return false;
  if (String(ev?.status || 'succeeded') !== 'succeeded') return false;
  let meta = ev?.meta;
  if (typeof ev?.metaJson === 'string') {
    try {
      meta = JSON.parse(ev.metaJson);
    } catch {
      meta = null;
    }
  }
  if (meta?.byok === true) return false;
  return creditsForEvent(ev) > 0;
}

export function creditsForEvent(ev) {
  let meta = ev?.meta;
  if (!meta && typeof ev?.metaJson === 'string') {
    try {
      meta = JSON.parse(ev.metaJson);
    } catch {
      meta = null;
    }
  }
  if (ev?.creditsCharged != null && Number(ev.creditsCharged) > 0) {
    return Math.floor(Number(ev.creditsCharged));
  }
  const quote = priceUsageQuote({
    billingSku: ev?.billingSku,
    meterKind: ev?.meterKind,
    quantityIn: ev?.quantityIn,
    quantityOut: ev?.quantityOut,
    quantity: ev?.quantity,
    usagePart: meta?.usagePart,
    outputKind: meta?.outputKind,
    byok: meta?.byok === true,
  });
  if (quote.creditsCharge > 0) return quote.creditsCharge;
  return usdEstToCredits(ev?.costUsdEst);
}

function aggregateLedgerStats(entries) {
  let balance = 0;
  let lifetimeGranted = 0;
  let lifetimeSpent = 0;
  for (const e of entries) {
    const delta = Math.floor(Number(e.delta) || 0);
    balance += delta;
    if (delta > 0 && (e.kind === 'grant' || e.kind === 'refund')) lifetimeGranted += delta;
    if (e.kind === 'consume') lifetimeSpent += Math.abs(delta);
  }
  return {
    balance: Math.max(0, balance),
    lifetimeGranted,
    lifetimeSpent,
  };
}

async function loadAllLedgerEntries(userId) {
  const all = [];
  let cursor = null;
  for (;;) {
    const page = await listCreditLedger(userId, { limit: 100, cursor });
    all.push(...page.entries);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

async function loadUsageEventsWithCredits(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return [];

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const res = await p.query(
      `SELECT id, idempotency_key, credits_charged, status
       FROM usage_events
       WHERE user_id = $1 AND credits_charged IS NOT NULL AND credits_charged > 0`,
      [uid]
    );
    return res.rows.map((r) => ({
      id: r.id,
      idempotencyKey: r.idempotency_key,
      creditsCharged: Number(r.credits_charged),
      status: r.status,
    }));
  }

  const db = readDb();
  return (db.usageEvents || [])
    .filter((e) => String(e.userId) === uid && Number(e.creditsCharged) > 0)
    .map((e) => ({
      id: e.id,
      idempotencyKey: e.idempotencyKey,
      creditsCharged: Number(e.creditsCharged),
      status: e.status || 'succeeded',
    }));
}

async function collectCreditUserIds() {
  const ids = new Set();

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const res = await p.query(`
      SELECT user_id AS id FROM user_credit_balances
      UNION SELECT DISTINCT user_id AS id FROM credit_ledger
      UNION SELECT DISTINCT user_id AS id FROM usage_events WHERE credits_charged IS NOT NULL AND credits_charged > 0
    `);
    for (const row of res.rows) {
      if (row.id) ids.add(String(row.id));
    }
    return [...ids];
  }

  const db = readDb();
  for (const uid of Object.keys(db.creditBalances || {})) ids.add(uid);
  for (const e of db.creditLedger || []) {
    if (e.userId) ids.add(String(e.userId));
  }
  for (const e of db.usageEvents || []) {
    if (e.userId && Number(e.creditsCharged) > 0) ids.add(String(e.userId));
  }
  return [...ids];
}

async function fixBalanceFromLedger(userId, agg) {
  const uid = String(userId || '').trim();
  if (!uid) return;

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    await ensureBalanceRowPg(p, uid);
    await p.query(
      `UPDATE user_credit_balances
       SET balance = $2, lifetime_granted = $3, lifetime_spent = $4, updated_at = now()
       WHERE user_id = $1`,
      [uid, agg.balance, agg.lifetimeGranted, agg.lifetimeSpent]
    );
    return;
  }

  const db = readDb();
  db.creditBalances[uid] = {
    balance: agg.balance,
    lifetimeGranted: agg.lifetimeGranted,
    lifetimeSpent: agg.lifetimeSpent,
    updatedAt: nowIso(),
  };
  writeDb(db);
}

/**
 * 对账单用户：I2 余额=Σdelta；I3 consume↔usage_events；I6/I7 累计字段。
 * @param {{ fix?: boolean }} opts — fix 仅修复余额表与 ledger 聚合不一致（不自动补 consume）
 */
export async function reconcileCreditsForUser(userId, opts = {}) {
  const fix = Boolean(opts.fix);
  const uid = String(userId || '').trim();
  const issues = [];
  if (!uid) return { userId: uid, issues, fixed: false };

  const bal = await getCreditBalance(uid);
  const entries = await loadAllLedgerEntries(uid);
  const agg = aggregateLedgerStats(entries);

  if (bal.balance !== agg.balance) {
    issues.push({
      code: 'I2_balance',
      message: `balance ${bal.balance} ≠ Σdelta ${agg.balance}`,
    });
  }
  if (bal.lifetimeGranted !== agg.lifetimeGranted) {
    issues.push({
      code: 'I6_granted',
      message: `lifetimeGranted ${bal.lifetimeGranted} ≠ ${agg.lifetimeGranted}`,
    });
  }
  if (bal.lifetimeSpent !== agg.lifetimeSpent) {
    issues.push({
      code: 'I7_spent',
      message: `lifetimeSpent ${bal.lifetimeSpent} ≠ ${agg.lifetimeSpent}`,
    });
  }

  const consumeLedgers = entries.filter((e) => e.kind === 'consume');
  const usageEvents = await loadUsageEventsWithCredits(uid);

  for (const ev of usageEvents) {
    if (String(ev.status) !== 'succeeded') continue;
    const match = consumeLedgers.find(
      (l) => l.refId === ev.id || (l.idempotencyKey && l.idempotencyKey === ev.idempotencyKey)
    );
    if (!match) {
      issues.push({
        code: 'I3_orphan_usage',
        message: `usage ${ev.id} credits=${ev.creditsCharged} 无 consume ledger`,
      });
    } else if (Math.abs(Number(match.delta)) !== ev.creditsCharged) {
      issues.push({
        code: 'I3_mismatch',
        message: `usage ${ev.id} credits ${ev.creditsCharged} ≠ ledger ${Math.abs(Number(match.delta))}`,
      });
    }
  }

  for (const l of consumeLedgers) {
    if (!l.refId) continue;
    const ev = usageEvents.find((e) => e.id === l.refId);
    if (!ev) {
      issues.push({
        code: 'I3_orphan_ledger',
        message: `consume ledger ${l.id} ref ${l.refId} 无 usage`,
      });
    }
  }

  let fixed = false;
  if (
    fix &&
    issues.some((i) => i.code === 'I2_balance' || i.code === 'I6_granted' || i.code === 'I7_spent')
  ) {
    await fixBalanceFromLedger(uid, agg);
    fixed = true;
  }

  return {
    userId: uid,
    issues,
    fixed,
    balance: bal.balance,
    ledgerBalance: agg.balance,
  };
}

/** 对账全部已知积分用户 */
export async function reconcileAllCredits(opts = {}) {
  const userIds = await collectCreditUserIds();
  const users = [];
  for (const uid of userIds) {
    users.push(await reconcileCreditsForUser(uid, opts));
  }
  const issueCount = users.reduce((sum, row) => sum + row.issues.length, 0);
  return { users, issueCount, userCount: users.length };
}
