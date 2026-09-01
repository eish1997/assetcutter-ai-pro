/**
 * ParamSchema v1 服务端校验（历史规格见 docs/archived/Script-Hub-开发规格.md）
 */
const KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const ALLOWED_TYPES = new Set(['string', 'text', 'int', 'float', 'bool', 'enum', 'path']);

export function validateParamSchemaV1(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('schema 须为 JSON 对象');
  }
  if (schema.schemaVersion !== 1) {
    throw new Error('schemaVersion 须为 1');
  }
  if (!Array.isArray(schema.fields)) {
    throw new Error('fields 须为非空数组');
  }
  if (schema.fields.length === 0) {
    throw new Error('fields 至少包含一个字段');
  }
  const keys = new Set();
  for (const f of schema.fields) {
    if (!f || typeof f !== 'object') throw new Error('field 项非法');
    const key = String(f.key || '').trim();
    if (!KEY_RE.test(key)) throw new Error(`非法字段 key：${key}`);
    if (keys.has(key)) throw new Error(`重复字段 key：${key}`);
    keys.add(key);
    const type = String(f.type || '').trim();
    if (!ALLOWED_TYPES.has(type)) throw new Error(`非法字段类型：${type}`);
    if (!String(f.label || '').trim()) throw new Error(`字段 ${key} 缺少 label`);
    if (type === 'enum') {
      if (!Array.isArray(f.enumOptions) || f.enumOptions.length === 0) {
        throw new Error(`enum 字段 ${key} 须含 enumOptions`);
      }
    }
  }
  return schema;
}

export function normalizeHostPrimitiveToolManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { tier: 'composed', dependsOn: [], probeKind: 'bridge_connected' };
  }
  const tier = String(input.tier || input.hostPrimitiveTier || 'composed').trim() === 'primitive' ? 'primitive' : 'composed';
  const dependsOn = Array.isArray(input.dependsOn) ? input.dependsOn.map(String).filter(Boolean) : [];
  const probeKind = String(input.probeKind || 'bridge_connected').trim() || 'bridge_connected';
  return {
    tier,
    dependsOn,
    probeKind,
    hostId: String(input.hostId || input.softwareId || '').trim(),
    hostPrimitiveId: String(input.hostPrimitiveId || input.id || '').trim(),
    hostPrimitiveLabel: String(input.hostPrimitiveLabel || input.label || input.name || '').trim(),
  };
}
