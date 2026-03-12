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
          '/seam-repair-api': {
            target: 'http://127.0.0.1:8008',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/seam-repair-api/, ''),
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
