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
      'tests/tencentService.test.ts',
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
          ],
        },
      ],
    },
  },
];
