import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist/**',
      'scripts/**/*.mjs',
      'node_modules/**',
      'public/py/**',
      'WebSeamRepair/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // 大模型调用统一经 unifiedAiGateway；防止 components/hooks/业务 services 回退为直连实现层
  {
    files: [
      'App.tsx',
      'types.ts',
      'components/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
      'services/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
    ],
    ignores: [
      'services/unifiedAiGateway.ts',
      'services/geminiService.ts',
      'services/tencentService.ts',
      'services/generate3d/**/*.ts',
      'services/jimeng/**/*.ts',
      'services/workflowGeminiAsyncRecovery.ts',
      'tests/tencentService.test.ts',
      'tests/jimeng.*.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: String.raw`\/geminiService(\.[cm]?[jt]s)?$`,
              message:
                '请从 services/unifiedAiGateway 引用大模型能力，勿直连 geminiService（实现层仅 geminiService.ts / unifiedAiGateway.ts）。',
            },
            {
              regex: String.raw`\/tripoService(\.[cm]?[jt]s)?$`,
              message: '请从 services/unifiedAiGateway 引用 Tripo，勿直连 tripoService。',
            },
            {
              regex: String.raw`\/tencentService(\.[cm]?[jt]s)?$`,
              message:
                '请从 services/unifiedAiGateway 引用腾讯混元生3D API，勿直连 tencentService（实现层仅 tencentService.ts / unifiedAiGateway.ts）。',
            },
            {
              regex: String.raw`\/jimeng\/adapter(\.[cm]?[jt]s)?$`,
              message: '请经 services/unifiedAiGateway 引用即梦，勿直连 jimeng/adapter。',
            },
            {
              regex: String.raw`\/jimeng\/client(\.[cm]?[jt]s)?$`,
              message: '请经 services/unifiedAiGateway 引用即梦，勿直连 jimeng/client。',
            },
          ],
        },
      ],
    },
  },
  // Sprint C3 — UI 禁止直连价目种子；metering adapter 禁止直连 credit-store
  {
    files: ['components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../shared/usageBillingCatalog',
              message: '组件层请经 /api/usage/price-list 或 admin API 获取价目，勿 import DEFAULT_PRICE_CATALOG。',
            },
            {
              name: '../../shared/usageBillingCatalog',
              message: '组件层请经 /api/usage/price-list 或 admin API 获取价目，勿 import DEFAULT_PRICE_CATALOG。',
            },
          ],
          patterns: [
            {
              regex: String.raw`shared\/usageBillingCatalog(\.[cm]?[jt]s)?$`,
              message: '组件层请经 /api/usage/price-list 或 admin API 获取价目，勿 import DEFAULT_PRICE_CATALOG。',
            },
            {
              regex: String.raw`DEFAULT_PRICE_CATALOG`,
              importNames: ['DEFAULT_PRICE_CATALOG'],
              message: '组件层请经 /api/usage/price-list 或 admin API 获取价目，勿 import DEFAULT_PRICE_CATALOG。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['services/observability/metering/adapters/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: String.raw`server\/credit-store(\.[cm]?[jt]s)?$`,
              message: 'metering adapter 禁止直连 credit-store；请经 metering pipeline / usage 记账层。',
            },
            {
              regex: String.raw`\/credit-store(\.[cm]?[jt]s)?$`,
              message: 'metering adapter 禁止直连 credit-store；请经 metering pipeline / usage 记账层。',
            },
          ],
        },
      ],
    },
  },
];
