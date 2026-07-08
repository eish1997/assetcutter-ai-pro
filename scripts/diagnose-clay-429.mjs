/**
 * 系统排查「白模」429 / Too Many Requests：逐步探测 auth 中继链上各节点。
 * 用法：$env:VERIFY_USER='maoer'; $env:VERIFY_PASS='***'; node --env-file=.env.local scripts/diagnose-clay-429.mjs
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const AUTH = 'https://assetcutter-auth-api.onrender.com';
const PROXY = 'https://assetcutter-gemini-proxy.onrender.com';
const ORIGIN = process.env.DIAG_ORIGIN || 'https://assetcutter-ai-pro.vercel.app';
const USER = String(process.env.VERIFY_USER || 'maoer').trim();
const PASS = String(process.env.VERIFY_PASS || '').trim();

const proxy = String(process.env.HTTPS_PROXY || process.env.TRIPO_PROXY || '').trim();
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
const fo = dispatcher ? { dispatcher } : {};

function cookies(res) {
  const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return lines.map((l) => l.split(';')[0].trim()).join('; ');
}

function summarize(label, res, bodyText) {
  const ct = res.headers.get('content-type') || '';
  const snippet = (bodyText || '').slice(0, 280).replace(/\s+/g, ' ');
  console.log(`\n--- ${label} ---`);
  console.log(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  console.log(`content-type: ${ct}`);
  console.log(`body: ${snippet || '(empty)'}`);
  return res.status;
}

async function main() {
  if (!PASS) {
    console.error('请设置 VERIFY_PASS');
    process.exit(1);
  }

  console.log(`\n=== 白模链路诊断 Origin=${ORIGIN} ===\n`);

  // 1. 健康检查
  for (const [name, url] of [
    ['gemini-proxy /healthz', `${PROXY}/healthz`],
    ['auth relay /api/gemini-proxy/healthz', `${AUTH}/api/gemini-proxy/healthz`],
  ]) {
    const res = await undiciFetch(url, fo);
    const t = await res.text();
    summarize(name, res, t);
  }

  const loginRes = await undiciFetch(`${AUTH}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ identifier: USER, password: PASS }),
    ...fo,
  });
  const cookie = cookies(loginRes);
  if (!loginRes.ok || !cookie.includes('ac_session=')) {
    summarize('login', loginRes, await loginRes.text());
    process.exit(1);
  }
  console.log('\n--- login ---\nOK');

  const authHeaders = { Cookie: cookie, Origin: ORIGIN };

  for (const [label, path] of [
    ['credits/balance', '/api/credits/balance'],
    ['usage/quote', '/api/usage/quote?jobKinds=workflow_text_to_image'],
  ]) {
    const res = await undiciFetch(`${AUTH}${path}`, { headers: authHeaders, ...fo });
    summarize(label, res, await res.text());
  }

  const bundleRes = await undiciFetch(`${AUTH}/api/auth/credits-proxy-bundle?estimatedCredits=134`, {
    headers: authHeaders,
    ...fo,
  });
  const bundleText = await bundleRes.text();
  summarize('credits-proxy-bundle', bundleRes, bundleText);
  let bundle = {};
  try {
    bundle = JSON.parse(bundleText);
  } catch {
    /* ignore */
  }

  const relayHeaders = {
    'Content-Type': 'application/json',
    ...authHeaders,
    ...(bundle.headers || {}),
  };

  // 2. 理解步（同步 generate-content，白模默认走理解）
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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
  });

  for (const [label, url] of [
    ['relay POST generate-content (理解)', `${AUTH}/api/gemini-proxy/proxy/gemini/generate-content`],
    ['direct POST generate-content (理解)', `${PROXY}/proxy/gemini/generate-content`],
  ]) {
    const res = await undiciFetch(url, {
      method: 'POST',
      headers: label.startsWith('relay') ? relayHeaders : { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: understandBody,
      ...fo,
    });
    summarize(label, res, await res.text());
  }

  // 3. 生图 async create（白模 image_to_image）
  const createBody = JSON.stringify({
    model: 'gemini-3-pro-image-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: tinyPng } },
          { text: '将图片转成传统3D游戏影视流程中的白模效果图，灰色背景。' },
        ],
      },
    ],
    config: { responseModalities: ['IMAGE'] },
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
  summarize('relay POST async create (生图)', createRes, createText);

  let jobId = '';
  try {
    jobId = JSON.parse(createText).jobId || '';
  } catch {
    /* ignore */
  }

  if (jobId) {
    for (let i = 0; i < 8; i += 1) {
      await new Promise((r) => setTimeout(r, 2500));
      const pollRes = await undiciFetch(
        `${AUTH}/api/gemini-proxy/proxy/gemini/async/${encodeURIComponent(jobId)}`,
        { headers: authHeaders, ...fo }
      );
      const pollText = await pollRes.text();
      const st = summarize(`poll #${i + 1}`, pollRes, pollText);
      if (pollText.includes('"status":"completed"') || pollText.includes('"status":"failed"')) break;
      if (st === 429) break;
    }
  }

  // 4. 用量上报是否触发 auth 429
  const usageBurst = [];
  for (let i = 0; i < 5; i += 1) {
    usageBurst.push(
      undiciFetch(`${AUTH}/api/usage/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ events: [] }),
        ...fo,
      })
    );
  }
  const usageResults = await Promise.all(usageBurst);
  for (let i = 0; i < usageResults.length; i += 1) {
    const t = await usageResults[i].text();
    summarize(`usage/events burst #${i + 1}`, usageResults[i], t);
  }

  console.log('\n=== 诊断完成 ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
