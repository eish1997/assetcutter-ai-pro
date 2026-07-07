/** 即梦客户端 / 适配器错误（W0） */

export class JimengNotConfiguredError extends Error {
  readonly code = "JIMENG_NOT_CONFIGURED" as const;
  readonly errorHint = "auth_config" as const;

  constructor(message = "即梦 AI 未启用或未配置站点凭证。") {
    super(message);
    this.name = "JimengNotConfiguredError";
  }
}

export class JimengPollTimeoutError extends Error {
  readonly code = "JIMENG_POLL_TIMEOUT" as const;
  readonly errorHint = "poll_timeout" as const;

  constructor(
    message = "即梦任务轮询超时，请稍后重试。",
    readonly taskId?: string,
    readonly registryId?: string
  ) {
    super(message);
    this.name = "JimengPollTimeoutError";
  }
}

export class JimengUpstreamRejectedError extends Error {
  readonly errorHint = "upstream_rejected" as const;

  constructor(
    message: string,
    readonly upstreamCode: number,
    readonly registryId?: string,
    readonly taskId?: string
  ) {
    super(message);
    this.name = "JimengUpstreamRejectedError";
  }
}

export function isJimengNotConfiguredError(err: unknown): err is JimengNotConfiguredError {
  return err instanceof JimengNotConfiguredError;
}
