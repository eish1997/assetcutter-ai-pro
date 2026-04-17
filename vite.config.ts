import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // loadEnv 读 .env 文件（本地）；Vercel 等把变量放在 process.env。优先用 process.env，没有再用文件里的
    const fromFile = loadEnv(mode, '.', '');
    const env = {
        ...fromFile,
        VITE_TENCENT_PROXY: process.env.VITE_TENCENT_PROXY ?? fromFile.VITE_TENCENT_PROXY,
        VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS:
          process.env.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS ?? fromFile.VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS,
    };
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
          },
          /** Gemini 异步代理：与前端同源，避免浏览器跨端口访问 localhost:9002 触发 CORS */
          '/proxy/gemini': {
            target: 'http://127.0.0.1:9002',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
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
