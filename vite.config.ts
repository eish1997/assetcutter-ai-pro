import path from 'path';
import type { IncomingMessage } from 'http';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { collectRemoteBulkOriginsFromEnv } from './services/geminiBulkForwardDevOrigins';

const HOP_BY_HOP_REQ = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'proxy-connection',
  'upgrade',
]);

function forwardRequestHeaders(headers: IncomingMessage['headers']): Headers {
  const h = new Headers();
  for (const [key, val] of Object.entries(headers)) {
    if (!key || HOP_BY_HOP_REQ.has(key.toLowerCase())) continue;
    if (val == null) continue;
    if (Array.isArray(val)) {
      for (const item of val) h.append(key, item);
    } else {
      h.set(key, val);
    }
  }
  return h;
}

/** Vite HMR 偶发 ?t=1782957033.67113 小数后缀，esbuild 会当成 loader 扩展名而 500 */
function fixViteDecimalTimestampQuery(): Plugin {
  return {
    name: 'fix-vite-decimal-timestamp-query',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url;
        if (url && /\?t=\d+\.\d+/.test(url)) {
          req.url = url.replace(/(\?t=\d+)\.\d+([^&]*)/, '$1$2');
        }
        next();
      });
    },
  };
}

async function readRequestBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

/** 本地 Vite 反代出站（OpenAI / VectorEngine 等）：读 OPENAI_PROXY → HTTPS_PROXY → HTTP_PROXY → TRIPO_PROXY */
function resolveDevOutboundProxyUrl(
  ...sources: Array<Record<string, string | undefined> | NodeJS.ProcessEnv>
): string {
  const keys = ['OPENAI_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'TRIPO_PROXY'] as const;
  for (const src of sources) {
    for (const key of keys) {
      const value = String(src[key] ?? '').trim();
      if (value) return value;
    }
  }
  return '';
}

function openAiUpstreamProxyErrorMessage(outboundProxyUrl: string): string {
  if (outboundProxyUrl) {
    return `无法连接 OpenAI 上游（经出站代理 ${outboundProxyUrl} → api.openai.com）。请确认代理已启动且可访问 OpenAI。`;
  }
  return (
    '无法连接 OpenAI 上游（已代理到 api.openai.com）。若本机需翻墙，请在 .env.local 配置 ' +
    'OPENAI_PROXY=http://127.0.0.1:7890（或 HTTPS_PROXY / 已有 TRIPO_PROXY），保存后重启 npm run dev。'
  );
}

/** 开发服务器将 `/__ac-bulk-forward/{i}/...` 转发到 `origins[i]`，与 `services/geminiBulkForwardDevOrigins.ts` 白名单一致 */
function geminiBulkForwardDevPlugin(origins: string[]): Plugin {
  return {
    name: 'ac-gemini-bulk-forward-dev',
    configureServer(server) {
      if (origins.length === 0) return;

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        const pathOnly = url.split('?')[0] || '';
        const q = url.indexOf('?');
        const query = q >= 0 ? url.slice(q) : '';
        const m = /^\/__ac-bulk-forward\/(\d+)(\/.*)?$/.exec(pathOnly);
        if (!m) {
          next();
          return;
        }

        const idx = Number(m[1]);
        const origin = origins[idx];
        if (!Number.isFinite(idx) || idx < 0 || idx >= origins.length || !origin) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '无效的 dev bulk 转发索引' }));
          return;
        }

        const restPath = m[2] && m[2].length > 0 ? m[2] : '/';
        const targetUrl = origin + restPath + query;
        const method = (req.method || 'GET').toUpperCase();

        if (method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
        if (!allowed.has(method)) {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: `不支持的转发方法: ${method}` }));
          return;
        }

        let bodyBuf: Buffer | undefined;
        if (method !== 'GET' && method !== 'HEAD') {
          try {
            bodyBuf = await readRequestBodyBuffer(req);
          } catch (e) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: '读取请求体失败', detail: e instanceof Error ? e.message : String(e) }));
            return;
          }
        }

        let upstream: Response;
        try {
          upstream = await fetch(targetUrl, {
            method,
            headers: forwardRequestHeaders(req.headers),
            body:
              bodyBuf && bodyBuf.length > 0 && method !== 'GET' && method !== 'HEAD'
                ? bodyBuf
                : undefined,
          });
        } catch (e) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: 'dev bulk 转发无法连接上游',
              detail: e instanceof Error ? e.message : String(e),
              targetUrl,
            })
          );
          return;
        }

        const skipResp = new Set(['content-encoding', 'transfer-encoding', 'content-length']);
        res.statusCode = upstream.status;
        upstream.headers.forEach((v, k) => {
          if (skipResp.has(k.toLowerCase())) return;
          try {
            res.setHeader(k, v);
          } catch {
            /* ignore invalid header names for Node */
          }
        });

        try {
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader('Content-Length', String(buf.length));
          res.end(buf);
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: '读取上游响应失败', detail: e instanceof Error ? e.message : String(e) }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    // loadEnv 读 .env 文件（本地）；Vercel 等把变量放在 process.env。优先用 process.env，没有再用文件里的
    const fromFile = loadEnv(mode, '.', '');
    const env = {
        ...fromFile,
        VITE_TENCENT_PROXY: process.env.VITE_TENCENT_PROXY ?? fromFile.VITE_TENCENT_PROXY,
        VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS:
          process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS ?? fromFile.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS,
    };
    const bulkForwardOrigins = collectRemoteBulkOriginsFromEnv({
      ...fromFile,
      ...process.env,
    } as Record<string, string | undefined>);
    const outboundProxyUrl = resolveDevOutboundProxyUrl(process.env, fromFile);
    const outboundProxyAgent = outboundProxyUrl ? new HttpsProxyAgent(outboundProxyUrl) : undefined;
    return {
      root: path.resolve(__dirname),
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/auth': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/api/admin': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/api/companion-artifacts': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/api/bridge': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/api/r2': {
            /** 生产与本地推荐：R2 路由挂在 auth-api（9100）同源 Cookie；独立 9003 仅用于 npm run dev:r2-api / start:r2-api */
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
            configure(proxy) {
              proxy.on('error', (err, _req, res) => {
                const msg =
                  '无法连接 /api/r2（已代理到 127.0.0.1:9100 的 auth-api）。请运行 npm run dev:auth-backend，并在 .env.local 配置 R2_*；若仅用独立 R2 进程，请把 vite.config 里 /api/r2 的 target 改回 9003 并运行 npm run dev:r2-api。';
                if (res && typeof (res).writeHead === 'function' && !(res).headersSent) {
                  (res).writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                  (res).end(
                    JSON.stringify({
                      error: msg,
                      detail: err instanceof Error ? err.message : String(err),
                    })
                  );
                }
              });
            },
          },
          '/api/tripo': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/api/tripo/upload': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/api/debug': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          /** 用户用量记账（Phase 0/1）：summary / events / export */
          '/api/usage': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          /** 统一积分制：余额 / 流水 */
          '/api/credits': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          /** 工作流任务执行上报（管理端任务执行页） */
          '/api/workflow': {
            target: 'http://127.0.0.1:9100',
            changeOrigin: true,
          },
          '/seam-repair-api': {
            target: 'http://127.0.0.1:8008',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/seam-repair-api/, ''),
          },
          /** VectorEngine：开发环境绕过浏览器 CORS（直连 api.vectorengine.ai 会 Failed to fetch） */
          '/__vectorengine': {
            target: 'https://api.vectorengine.ai',
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/__vectorengine/, '') || '/',
            agent: outboundProxyAgent,
          },
          /** OpenAI 官方：开发环境绕过浏览器 CORS（直连 api.openai.com 会 Failed to fetch） */
          '/__openai': {
            target: 'https://api.openai.com',
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/__openai/, '') || '/',
            agent: outboundProxyAgent,
            configure(proxy) {
              proxy.on('error', (err, _req, res) => {
                const msg = openAiUpstreamProxyErrorMessage(outboundProxyUrl);
                if (res && typeof res.writeHead === 'function' && !res.headersSent) {
                  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(
                    JSON.stringify({
                      error: msg,
                      detail: err instanceof Error ? err.message : String(err),
                    })
                  );
                }
              });
            },
          },
          /** Gemini 异步代理：与前端同源，避免浏览器跨端口访问 localhost:9002 触发 CORS */
          '/proxy/gemini': {
            target: 'http://127.0.0.1:9002',
            changeOrigin: true,
            configure(proxy) {
              proxy.on('error', (err, _req, res) => {
                const msg =
                  '无法连接本机 gemini-proxy（已代理到 127.0.0.1:9002）。请在仓库根执行 npm run dev:gemini-proxy，或使用 npm run restart:local-stack 一并拉起；并确认 .env.local 已配置 GEMINI_API_KEY。若 VITE_BULK_IMAGE_API 指向境外 *.onrender.com，请检查网络或改为 same-origin 走本机代理。';
                if (res && typeof res.writeHead === 'function' && !res.headersSent) {
                  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(
                    JSON.stringify({
                      error: msg,
                      detail: err instanceof Error ? err.message : String(err),
                    })
                  );
                }
              });
            },
          },
        },
      },
      plugins: [fixViteDecimalTimestampQuery(), react(), geminiBulkForwardDevPlugin(bulkForwardOrigins)],
      define: {
        'process.env.VITE_TENCENT_PROXY': JSON.stringify(env.VITE_TENCENT_PROXY),
        'process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS': JSON.stringify(env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return undefined;
              if (id.includes('node_modules/three/examples')) return 'three-examples';
              if (id.includes('node_modules/three')) return 'three-core';
              if (id.includes('node_modules/@google/genai')) return 'genai-vendor';
              if (id.includes('node_modules/@xyflow/react')) return 'xyflow-vendor';
              if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react-vendor';
              return undefined;
            },
          },
        },
      }
    };
});
