/**
 * 系统排查生图链路：固定 6 步，支持从第 N 步跑到第 6 步（后缀截断测试）。
 *
 * ## 6 步定义
 * | 步 | 名称 | 内容 |
 * |----|------|------|
 * | 1 | auth | 登录 + balance + usage/quote |
 * | 2 | bundle | credits-proxy-bundle 预扣 |
 * | 3 | understand | relay POST generate-content（理解/sync） |
 * | 4 | image_create | relay POST async create（生图） |
 * | 5 | image_poll | GET async/:jobId 轮询至终态 |
 * | 6 | release | POST credits-release 释放预扣 |
 *
 * ## 用法
 * ```powershell
 * $env:VERIFY_USER='maoer'
 * $env:VERIFY_PASS='***'
 * $env:DIAG_FROM_STEP='3'   # 从第 3 步跑到第 6 步（须已有 cookie 或从 1 登录）
 * node --env-file=.env.local scripts/diagnose-clay-429.mjs
 * ```
 *
 * 环境变量：
 * - `DIAG_FROM_STEP` / `DIAG_TO_STEP`：1～6，默认 1～6
 * - `DIAG_SKIP_UNDERSTAND=1`：跳过第 3 步（对齐 P0 预设直发，只测生图）
 * - `DIAG_AUTH` / `DIAG_PROXY`：覆盖 auth-api / gemini-proxy 根地址
 * - `DIAG_COOKIE`：跳过登录，直接带 Cookie（从第 2 步起）
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH = String(process.env.DIAG_AUTH || 'https://assetcutter-auth-api.onrender.com').replace(/\/$/, '');
const PROXY = String(process.env.DIAG_PROXY || 'https://assetcutter-gemini-proxy.onrender.com').replace(/\/$/, '');
const ORIGIN = process.env.DIAG_ORIGIN || 'https://assetcutter-ai-pro.vercel.app';
const USER = String(process.env.VERIFY_USER || 'maoer').trim();
const PASS = String(process.env.VERIFY_PASS || '').trim();
const FROM_STEP = clampStep(process.env.DIAG_FROM_STEP, 1);
const TO_STEP = clampStep(process.env.DIAG_TO_STEP, 6);
const SKIP_UNDERSTAND = String(process.env.DIAG_SKIP_UNDERSTAND || '1').trim() === '1';
const DIAG_COOKIE = String(process.env.DIAG_COOKIE || '').trim();

const proxy = String(process.env.HTTPS_PROXY || process.env.TRIPO_PROXY || '').trim();
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
const fo = dispatcher ? { dispatcher } : {};

const STEP_NAMES = {
  1: 'auth',
  2: 'bundle',
  3: 'understand',
  4: 'image_create',
  5: 'image_poll',
  6: 'release',
};

/** @type {Record<number, { ok: boolean; status?: number; label: string }>} */
const stepResults = {};

function clampStep(raw, fallback) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(6, Math.max(1, n));
}

function cookies(res) {
  const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return lines.map((l) => l.split(';')[0].trim()).join('; ');
}

function recordStep(stepNum, label, ok, status) {
  stepResults[stepNum] = { ok, status, label };
}

function summarize(label, res, bodyText) {
  const ct = res.headers.get('content-type') || '';
  const snippet = (bodyText || '').slice(0, 280).replace(/\s+/g, ' ');
  const ok = res.ok;
  console.log(`\n--- ${label} ---`);
  console.log(`${ok ? 'PASS' : 'FAIL'} · HTTP ${res.status} ${res.statusText || ''}`.trim());
  console.log(`content-type: ${ct}`);
  console.log(`body: ${snippet || '(empty)'}`);
  return { status: res.status, ok, body: bodyText || '' };
}

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function step1Auth() {
  console.log('\n[Step 1/6] auth — 登录 + balance + quote');
  if (DIAG_COOKIE.includes('ac_session=')) {
    console.log('使用 DIAG_COOKIE，跳过登录');
    return { cookie: DIAG_COOKIE, authHeaders: { Cookie: DIAG_COOKIE, Origin: ORIGIN } };
  }
  if (!PASS) {
    console.error('请设置 VERIFY_PASS，或 DIAG_COOKIE 从第 2 步起');
    process.exit(1);
  }
  const loginRes = await undiciFetch(`${AUTH}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ identifier: USER, password: PASS }),
    ...fo,
  });
  const loginText = await loginRes.text();
  const cookie = cookies(loginRes);
  if (!loginRes.ok || !cookie.includes('ac_session=')) {
    summarize('login', loginRes, loginText);
    recordStep(1, 'auth', false, loginRes.status);
    process.exit(1);
  }
  console.log('\n--- login ---\nPASS · OK');
  const authHeaders = { Cookie: cookie, Origin: ORIGIN };
  let allOk = true;
  for (const [label, path] of [
    ['credits/balance', '/api/credits/balance'],
    ['usage/quote', '/api/usage/quote?jobKinds=workflow_text_to_image'],
  ]) {
    const res = await undiciFetch(`${AUTH}${path}`, { headers: authHeaders, ...fo });
    const t = await res.text();
    const s = summarize(label, res, t);
    if (!s.ok) allOk = false;
  }
  recordStep(1, 'auth', allOk, allOk ? 200 : 0);
  return { cookie, authHeaders };
}

async function step2Bundle(authHeaders) {
  console.log('\n[Step 2/6] bundle — credits-proxy-bundle');
  const bundleRes = await undiciFetch(`${AUTH}/api/auth/credits-proxy-bundle?estimatedCredits=134`, {
    headers: authHeaders,
    ...fo,
  });
  const bundleText = await bundleRes.text();
  const s = summarize('credits-proxy-bundle', bundleRes, bundleText);
  let bundle = {};
  try {
    bundle = JSON.parse(bundleText);
  } catch {
    /* ignore */
  }
  recordStep(2, 'bundle', s.ok, s.status);
  const relayHeaders = {
    'Content-Type': 'application/json',
    ...authHeaders,
    ...(bundle.headers || {}),
  };
  return { bundle, relayHeaders, reserveKey: bundle.reserveKey || bundle.headers?.['X-AC-Credits-Reserve'] || '' };
}

async function step3Understand(relayHeaders) {
  console.log('\n[Step 3/6] understand — generate-content (sync)');
  const understandBody = JSON.stringify({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: tinyPng } },
          {
            text: 'User request: 白模测试\n\nOutput only a valid JSON object with "instruction" (required), optional "summary", and "shouldGenerateImage" (required, true only when user wants to edit/generate a new image):',
          },
        ],
      },
    ],
    config: { systemInstruction: 'You output JSON only.' },
    aiBackend: 'vertex',
    estimatedCredits: 15,
  });
  const res = await undiciFetch(`${AUTH}/api/gemini-proxy/proxy/gemini/generate-content`, {
    method: 'POST',
    headers: relayHeaders,
    body: understandBody,
    ...fo,
  });
  const t = await res.text();
  const s = summarize('relay POST generate-content (理解)', res, t);
  recordStep(3, 'understand', s.ok, s.status);
  return s;
}

async function step4ImageCreate(relayHeaders) {
  console.log('\n[Step 4/6] image_create — async create');
  const createBody = JSON.stringify({
    model: 'gemini-3.1-flash-image',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: tinyPng } },
          { text: '将图片转成传统3D游戏影视流程中的白模效果图，灰色背景。' },
        ],
      },
    ],
    config: { responseModalities: ['TEXT', 'IMAGE'] },
    estimatedCredits: 134,
    aiBackend: 'vertex',
  });
  const createRes = await undiciFetch(`${AUTH}/api/gemini-proxy/proxy/gemini/async`, {
    method: 'POST',
    headers: relayHeaders,
    body: createBody,
    ...fo,
  });
  const createText = await createRes.text();
  const s = summarize('relay POST async create (生图)', createRes, createText);
  recordStep(4, 'image_create', s.ok, s.status);
  let jobId = '';
  try {
    jobId = JSON.parse(createText).jobId || '';
  } catch {
    /* ignore */
  }
  return { jobId, ok: s.ok, status: s.status };
}

async function step5ImagePoll(authHeaders, jobId) {
  console.log('\n[Step 5/6] image_poll — async poll');
  if (!jobId) {
    console.log('SKIP · 无 jobId');
    recordStep(5, 'image_poll', false, 0);
    return { ok: false };
  }
  let finalOk = false;
  let lastStatus = 0;
  for (let i = 0; i < 8; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const pollRes = await undiciFetch(
      `${AUTH}/api/gemini-proxy/proxy/gemini/async/${encodeURIComponent(jobId)}`,
      { headers: authHeaders, ...fo }
    );
    const pollText = await pollRes.text();
    const s = summarize(`poll #${i + 1}`, pollRes, pollText);
    lastStatus = s.status;
    if (pollText.includes('"status":"completed"')) {
      finalOk = true;
      break;
    }
    if (pollText.includes('"status":"failed"')) break;
    if (s.status === 429) break;
  }
  recordStep(5, 'image_poll', finalOk, lastStatus);
  return { ok: finalOk };
}

async function step6Release(authHeaders, reserveKey) {
  console.log('\n[Step 6/6] release — credits-release');
  const key = String(reserveKey || '').trim();
  if (!key) {
    console.log('SKIP · 无 reserveKey（可能已在 poll 结算）');
    recordStep(6, 'release', true, 200);
    return { ok: true };
  }
  const res = await undiciFetch(`${AUTH}/api/auth/credits-release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ reserveKey: key }),
    ...fo,
  });
  const t = await res.text();
  const s = summarize('credits-release', res, t);
  recordStep(6, 'release', s.ok, s.status);
  return s;
}

function printSummary(fromStep, toStep) {
  console.log(`\n=== 诊断摘要 (${fromStep}～${toStep}) ===\n`);
  let firstFail = null;
  for (let i = fromStep; i <= toStep; i += 1) {
    if (SKIP_UNDERSTAND && i === 3) {
      console.log(`  Step 3 understand — SKIPPED (DIAG_SKIP_UNDERSTAND=1)`);
      continue;
    }
    const r = stepResults[i];
    if (!r) {
      console.log(`  Step ${i} ${STEP_NAMES[i]} — (未运行)`);
      continue;
    }
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`  Step ${i} ${STEP_NAMES[i]} — ${mark}${r.status ? ` (HTTP ${r.status})` : ''}`);
    if (!r.ok && firstFail == null) firstFail = i;
  }
  if (firstFail != null) {
    console.log(`\n>>> 首次失败：Step ${firstFail} (${STEP_NAMES[firstFail]})`);
  } else {
    console.log('\n>>> 所选步骤全部 PASS');
  }
  console.log('');
}

async function main() {
  const fromStep = Math.min(FROM_STEP, TO_STEP);
  const toStep = Math.max(FROM_STEP, TO_STEP);

  console.log(`\n=== 生图链路诊断 Origin=${ORIGIN} ===`);
  console.log(`范围：Step ${fromStep}～${toStep}${SKIP_UNDERSTAND ? ' · 跳过理解' : ''}\n`);

  if (fromStep === 1) {
    for (const [name, url] of [
      ['gemini-proxy /healthz', `${PROXY}/healthz`],
      ['auth relay /api/gemini-proxy/healthz', `${AUTH}/api/gemini-proxy/healthz`],
    ]) {
      const res = await undiciFetch(url, fo);
      summarize(name, res, await res.text());
    }
  }

  /** @type {{ cookie: string; authHeaders: Record<string, string> } | null} */
  let authCtx = null;
  /** @type {{ relayHeaders: Record<string, string>; reserveKey: string } | null} */
  let bundleCtx = null;
  let jobId = '';

  for (let step = fromStep; step <= toStep; step += 1) {
    if (SKIP_UNDERSTAND && step === 3) continue;

    if (step === 1) {
      authCtx = await step1Auth();
      continue;
    }

    if (!authCtx) {
      if (DIAG_COOKIE) {
        authCtx = { cookie: DIAG_COOKIE, authHeaders: { Cookie: DIAG_COOKIE, Origin: ORIGIN } };
      } else if (fromStep > 1) {
        console.error('从 Step 2 起须设置 DIAG_COOKIE 或先跑 Step 1');
        process.exit(1);
      }
    }

    if (step === 2) {
      bundleCtx = await step2Bundle(authCtx.authHeaders);
      continue;
    }

    if (!bundleCtx) {
      console.error('Step 3+ 需要先完成 Step 2 bundle');
      process.exit(1);
    }

    if (step === 3) {
      await step3Understand(bundleCtx.relayHeaders);
      continue;
    }

    if (step === 4) {
      const created = await step4ImageCreate(bundleCtx.relayHeaders);
      jobId = created.jobId || '';
      continue;
    }

    if (step === 5) {
      await step5ImagePoll(authCtx.authHeaders, jobId);
      continue;
    }

    if (step === 6) {
      await step6Release(authCtx.authHeaders, bundleCtx.reserveKey);
    }
  }

  printSummary(fromStep, toStep);

  try {
    const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'diagnose-clay-429-last.json'),
      JSON.stringify({ fromStep, toStep, skipUnderstand: SKIP_UNDERSTAND, stepResults, at: new Date().toISOString() }, null, 2)
    );
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
