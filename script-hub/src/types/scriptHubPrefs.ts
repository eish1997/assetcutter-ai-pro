export type ScriptHubLastParamsEntry = {
  params: Record<string, unknown>;
  updatedAt: number;
  revisionId?: string;
};

export type ScriptHubUserPrefsV1 = {
  version: 1;
  updatedAt: number;
  maya: { host: string; port: number };
  lastParamsByScriptId: Record<string, ScriptHubLastParamsEntry>;
};

export const DEFAULT_SCRIPT_HUB_PREFS: ScriptHubUserPrefsV1 = {
  version: 1,
  updatedAt: 0,
  maya: { host: '127.0.0.1', port: 7001 },
  lastParamsByScriptId: {},
};
