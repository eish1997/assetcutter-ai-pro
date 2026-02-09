import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // loadEnv 读 .env 文件（本地）；Vercel 等把变量放在 process.env。优先用 process.env，没有再用文件里的
    const fromFile = loadEnv(mode, '.', '');
    const env = {
        ...fromFile,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? fromFile.GEMINI_API_KEY,
        TENCENT_SECRET_ID: process.env.TENCENT_SECRET_ID ?? fromFile.TENCENT_SECRET_ID,
        TENCENT_SECRET_KEY: process.env.TENCENT_SECRET_KEY ?? fromFile.TENCENT_SECRET_KEY,
        VITE_TENCENT_PROXY: process.env.VITE_TENCENT_PROXY ?? fromFile.VITE_TENCENT_PROXY,
    };
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/seam-repair-api': {
            target: 'http://127.0.0.1:8008',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/seam-repair-api/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.TENCENT_SECRET_ID': JSON.stringify(env.TENCENT_SECRET_ID),
        'process.env.TENCENT_SECRET_KEY': JSON.stringify(env.TENCENT_SECRET_KEY),
        'process.env.VITE_TENCENT_PROXY': JSON.stringify(env.VITE_TENCENT_PROXY),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
