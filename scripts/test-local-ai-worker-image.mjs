/**
 * 本地生图链路冒烟：Vite __ac-ai-worker-forward、auth-api 积分预扣、ai-worker-proxy 准入。
 * 用法：node scripts/test-local-ai-worker-image.mjs
 */
const VITE = 'http://127.0.0.1:3000';
const AUTH = 'http://127.0.0.1:9100';
const LOCAL_PROXY = 'http://127.0.0.1:9002';

const MINIMAL_ASYNC_BODY = JSON.stringify({
  model: 'gemini-2.5-flash-image',
  contents: [{ role: 'user', parts: [{ text: 'local smoke test red circle' }] }],
  estimatedCredits: 50,
});

function ok(label, detail = '') {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function fetchText(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { res, text };
}

async function main() {
  console.log('\n=== 本地生图链路测试 ===\n');

  // 1. 服务健康
  console.log('1) 服务健康');
  for (const [name, url] of [
    ['Vite dev', `${VITE}/`],
    ['auth-api', `${AUTH}/healthz`],
    ['ai-worker-proxy 本机', `${LOCAL_PROXY}/healthz`],
    ['Vite AI Worker Proxy forward → Render', `${VITE}/__ac-ai-worker-forward/0/healthz`],
    ['Vite /api/ai-worker-proxy 中继', `${VITE}/api/ai-worker-proxy/healthz`],
  ]) {
    try {
      const { res, text } = await fetchText(url, { cache: 'no-store' });
      if (res.ok && /"ok"\s*:\s*true|"service"/.test(text)) ok(name, `HTTP ${res.status}`);
      else fail(name, `HTTP ${res.status} ${text.slice(0, 120)}`);
    } catch (e) {
      fail(name, e instanceof Error ? e.message : String(e));
    }
  }

  // 2. 积分预扣（未登录应 401，不应 fetch failed）
  console.log('\n2) 积分预扣 credits-proxy-bundle（未登录）');
  try {
    const { res, text } = await fetchText(
      `${VITE}/api/auth/credits-proxy-bundle?estimatedCredits=50`,
      { credentials: 'include', cache: 'no-store' }
    );
    if (res.status === 401) ok('未登录拒绝', 'HTTP 401（auth-api 可达，非 fetch failed）');
    else if (res.ok) warn('意外成功', text.slice(0, 120));
    else fail('异常状态', `HTTP ${res.status} ${text.slice(0, 120)}`);
  } catch (e) {
    fail('网络失败', e instanceof Error ? e.message : String(e));
  }

  // 3. AI Worker Proxy forward POST（无积分头：应 HTTP 401/403，证明转发通）
  console.log('\n3) __ac-ai-worker-forward POST /proxy/gemini/async（无登录/无 reserve）');
  try {
    const { res, text } = await fetchText(`${VITE}/__ac-ai-worker-forward/0/proxy/gemini/async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: MINIMAL_ASYNC_BODY,
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) {
      ok('代理可达 + 积分闸门拦截', `HTTP ${res.status}（非 fetch failed）`);
      try {
        const j = JSON.parse(text);
        if (j.error) console.log(`     响应: ${j.error}`);
      } catch {
        /* ignore */
      }
    } else if (res.ok) {
      ok('任务创建成功', text.slice(0, 160));
    } else {
      warn('其它 HTTP 状态', `HTTP ${res.status} ${text.slice(0, 160)}`);
    }
  } catch (e) {
    fail('fetch failed / 网络错误', e instanceof Error ? e.message : String(e));
  }

  // 4. 本机 ai-worker-proxy 同源（经 Vite /proxy/gemini 若配置 same-origin 时用；此处直打 9002）
  console.log('\n4) 本机 ai-worker-proxy POST（无 reserve，预期 401）');
  try {
    const { res, text } = await fetchText(`${LOCAL_PROXY}/proxy/gemini/async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: MINIMAL_ASYNC_BODY,
    });
    if (res.status === 401 || res.status === 403) ok('本机 proxy 积分闸门', `HTTP ${res.status}`);
    else if (res.ok) ok('本机 proxy 创建成功', text.slice(0, 120));
    else warn('本机 proxy', `HTTP ${res.status} ${text.slice(0, 120)}`);
  } catch (e) {
    fail('本机 proxy 不可达', e instanceof Error ? e.message : String(e));
  }

  console.log('\n=== 结论 ===');
  console.log(
    '若 1) AI Worker Proxy forward 与 auth-api 均 ✅，且 3) 为 HTTP 401/403（非 fetch failed），说明本地网络链路正常。'
  );
  console.log('工作区生图还需：浏览器已登录 + 积分足够 + credits-proxy-bundle 成功返回 reserveKey。\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
