/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 与服务器 `TRIAL_GEMINI_DAILY_LIMIT` 对齐时设置，用于访客提示与本地计数上限 */
  readonly VITE_TRIAL_GEMINI_DAILY_LIMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
