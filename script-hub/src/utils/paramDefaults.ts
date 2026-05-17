import type { ParamSchemaV1 } from '../types/scriptHub';

export function paramDefaultsFromSchema(sch: ParamSchemaV1): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const f of sch.fields) {
    if (f.default !== undefined) o[f.key] = f.default;
  }
  return o;
}

export function resolveParamsForRun(
  schema: ParamSchemaV1,
  lastParams?: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = paramDefaultsFromSchema(schema);
  if (!lastParams || typeof lastParams !== 'object') return base;
  return { ...base, ...lastParams };
}
