/** 统一前缀，便于日志检索（阶段 3 观测） */
const PREFIX = "[model-registry]";

export function modelRegistryLog(level: "info" | "warn" | "error", message: string, detail?: string): void {
  const body = detail ? `${message} — ${detail}` : message;
  const line = `${PREFIX} ${body}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
