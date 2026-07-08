/**
 * 检查 Vercel 构建产物是否包含 auth 中继 / gemini-proxy 地址。
 * 用法：node scripts/inspect-vercel-bundle.mjs [siteUrl]
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const SITE = String(process.argv[2] || 'https://assetcutter-ai-pro.vercel.app').replace(/\/+$/, '');
const proxy = String(process.env.HTTPS_PROXY || process.env.TRIPO_PROXY || '').trim();
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
const fetchOpts = dispatcher ? { dispatcher } : {};

async function main() {
  const html = await undiciFetch(`${SITE}/`, fetchOpts).then((r) => r.text());
  const assets = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  console.log(`site=${SITE} js chunks=${assets.length}`);
  const needles = [
    'assetcutter-auth-api.onrender.com',
    'assetcutter-gemini-proxy.onrender.com',
    '/api/gemini-proxy',
    'same-origin',
  ];
  const hits = Object.fromEntries(needles.map((n) => [n, false]));
  for (const path of assets.slice(0, 8)) {
    const js = await undiciFetch(`${SITE}${path}`, fetchOpts).then((r) => r.text());
    for (const n of needles) {
      if (js.includes(n)) hits[n] = true;
    }
  }
  for (const [k, v] of Object.entries(hits)) console.log(`${v ? '✅' : '❌'} ${k}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
