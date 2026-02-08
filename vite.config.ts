import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
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
