import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** 仅跑仓库根目录 `tests/`，避免 Vitest 默认 glob 拾取 A-Driver 等子工程内非 Vitest 用例文件 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@ic', replacement: path.resolve(__dirname, 'vendor/basketikun-infinite-canvas') },
      { find: '@', replacement: path.resolve(__dirname, '.') },
      {
        find: 'localforage',
        replacement: path.resolve(__dirname, 'vendor/basketikun-infinite-canvas/shims/localforage.ts'),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/A-Driver/**', '**/示例项目/**', '**/local-companion/**', '**/companion-desktop/**'],
    // auth-db.test.json 共用：catalog/credits 用例文件级串行，避免竞态污染
    fileParallelism: false,
  },
});
