
const JSON_MAX = 2000;

export function getAuditLogRetentionMeta() {
  const usePg = Boolean(String(process.env.DATABASE_URL || '').trim());
  if (usePg) {
    return {
      storage: 'postgres',
      maxRecords: null,
      retentionDays: null,
      note: 'PostgreSQL 持久化；当前无自动清理策略，请运维自行归档。',
    };
  }
  return {
    storage: 'json',
    maxRecords: JSON_MAX,
    retentionDays: null,
    note: `本地 JSON 文件最多保留 ${JSON_MAX} 条，超出时丢弃最旧记录。`,
  };
}
