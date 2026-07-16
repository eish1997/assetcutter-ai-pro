/**
 * 经 auth-api /api/ai-worker-proxy 中继到 Render（生产 Key），验证本地 session + 积分 + relay。
 */
import crypto from 'crypto';
import { createSession } from '../server/auth-store.js';

const VITE = 'http://127.0.0.1:3000';
const USER_ID = 'd93ce5f5-38f9-4b66-8f40-b64028b53fae';
const POLL_MS = 2000;
const POLL_MAX_MS = 180_000;

async function main() {
  const token = crypto.randomBytes(32).toString('hex');
  await createSession({ userId: USER_ID, token, maxAgeMs: 3600_000, userAgent: 'relay-e2e', ip: '127.0.0.1' });
  const cookie = `ac_session=${token}`;

  const bundleRes = await fetch(`${VITE}/api/auth/credits-proxy-bundle?estimatedCredits=134`, {
    headers: { Cookie: cookie },
  });
  const bundle = await bundleRes.json();
  if (!bundleRes.ok || !bundle.reserveKey) {
    console.error('bundle fail', bundleRes.status, bundle);
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    Origin: VITE,
    ...(bundle.headers || {}),
    'X-AC-Credits-Reserve': bundle.reserveKey,
    'X-AC-Fairness-Key': `user:${USER_ID}`,
  };

  const createUrl = `${VITE}/api/ai-worker-proxy/proxy/gemini/async`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: 'A single small red circle on white background.' }] }],
      estimatedCredits: 134,
    }),
  });
  const createText = await createRes.text();
  console.log('create', createRes.status, createText.slice(0, 200));
  if (!createRes.ok) process.exit(1);

  const jobId = JSON.parse(createText).jobId;
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const pollRes = await fetch(`${VITE}/api/ai-worker-proxy/proxy/gemini/async/${encodeURIComponent(jobId)}`, {
      headers: { Cookie: cookie, Origin: VITE, ...(bundle.headers || {}) },
    });
    const pollText = await pollRes.text();
    const poll = JSON.parse(pollText);
    process.stdout.write(`\r poll status=${poll.status}   `);
    if (poll.status === 'completed') {
      console.log('\n✅ relay E2E completed');
      console.log(pollText.slice(0, 400));
      return;
    }
    if (poll.status === 'failed') {
      console.log('\n❌ failed', poll.error || pollText.slice(0, 400));
      process.exit(1);
    }
  }
  console.log('\n❌ timeout');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
