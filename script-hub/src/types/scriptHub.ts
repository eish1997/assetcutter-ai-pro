export type TargetType = 'maya' | 'unreal';

export type ParamSchemaV1 = {
  schemaVersion: 1;
  fields: ParamFieldV1[];
};

export type ParamFieldV1 = {
  key: string;
  type: 'string' | 'text' | 'int' | 'float' | 'bool' | 'enum' | 'path';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enumOptions?: { value: string; label: string }[];
};

export type ScriptListItem = {
  id: string;
  slug: string;
  title: string;
  description: string;
  targetType: TargetType;
  visibility: string;
  currentRevision: { id: string; version: number; schema: ParamSchemaV1 } | null;
  updatedAt: string;
  createdAt: string;
};

export type ScriptDetail = {
  id: string;
  slug: string;
  title: string;
  description: string;
  targetType: TargetType;
  visibility: string;
  currentRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScriptHubRun = {
  id: string;
  scriptId: string;
  revisionId: string;
  targetType: string;
  params: Record<string, unknown>;
  status: string;
  companionJobId?: string;
  exitCode?: number | null;
  errorCode?: string;
  errorMessage?: string;
  logExcerpt?: string;
  durationMs?: number | null;
  client: string;
  createdAt: string;
  finishedAt: string | null;
};
