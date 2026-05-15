import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 本机伴侣 API 由前端 `companionFetchJson` 直连 `127.0.0.1:18765`（与工作台同源），不依赖此处 `define` 注入 Token。
 * 仍保留 `/v1` 代理便于在浏览器里手工试 curl 同源路径；业务代码不走该代理。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api/auth': {
        target: 'http://127.0.0.1:9100',
        changeOrigin: true,
      },
      '/api/scripts': {
        target: 'http://127.0.0.1:9101',
        changeOrigin: true,
      },
      '/api/runs': {
        target: 'http://127.0.0.1:9101',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://127.0.0.1:18765',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:9101',
        changeOrigin: true,
      },
    },
  },
});
