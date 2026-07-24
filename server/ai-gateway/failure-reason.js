import { publicAiGatewayErrorMessage, classifyAiGatewayFallbackError } from './route-policy.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function httpStatusFromError(error) {
  const direct = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const message = publicAiGatewayErrorMessage(error);
  const matched = message.match(/\bHTTP\s+(\d{3})\b/i) || message.match(/\b(status|code)[=: ]+(\d{3})\b/i);
  const raw = matched ? Number(matched[matched.length - 1]) : 0;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function codeFromInput(errorOrCode) {
  if (typeof errorOrCode === 'string') return nonEmptyString(errorOrCode);
  if (!errorOrCode || typeof errorOrCode !== 'object') return '';
  return (
    nonEmptyString(errorOrCode.code) ||
    nonEmptyString(errorOrCode.error) ||
    nonEmptyString(errorOrCode.body?.error) ||
    nonEmptyString(errorOrCode.body?.code) ||
    ''
  );
}

function messageFromInput(errorOrCode) {
  if (typeof errorOrCode === 'string') return errorOrCode;
  if (!errorOrCode || typeof errorOrCode !== 'object') return publicAiGatewayErrorMessage(errorOrCode);
  if (errorOrCode.body?.message) return String(errorOrCode.body.message);
  if (errorOrCode.message) return String(errorOrCode.message);
  return publicAiGatewayErrorMessage(errorOrCode);
}

const CODE_TABLE = Object.freeze({
  LOGIN_REQUIRED: {
    stage: 'admission',
    owner: 'user',
    retryable: false,
    userMessage: '请先登录后再提交 AI 任务',
    adminMessage: 'Request rejected because the caller is not authenticated',
    nextAction: 'Ask the user to sign in, then retry',
  },
  CREDITS_EXCEEDED: {
    stage: 'billing',
    owner: 'user',
    retryable: false,
    userMessage: '积分不足，请联系管理员补充额度',
    adminMessage: 'Credits gate rejected the request due to insufficient balance',
    nextAction: 'Top up workspace credits or lower estimated cost',
  },
  AI_GATEWAY_CREDITS_GATE_FAILED: {
    stage: 'billing',
    owner: 'user',
    retryable: false,
    userMessage: '积分校验未通过，暂时无法提交任务',
    adminMessage: 'AI Gateway credits gate failed before job creation',
    nextAction: 'Inspect creditsGate metadata and user balance',
  },
  AI_GATEWAY_MODEL_NOT_PUBLISHED: {
    stage: 'publication',
    owner: 'admin',
    retryable: false,
    userMessage: '该模型尚未对当前工作区开放',
    adminMessage: 'Canonical model is not in the published allowlist',
    nextAction: 'Publish the model in model ops config, then retry',
  },
  AI_GATEWAY_MODEL_ROUTE_NOT_FOUND: {
    stage: 'routing',
    owner: 'developer',
    retryable: false,
    userMessage: '当前模型没有可用的执行线路',
    adminMessage: 'No executable AI Gateway route matched the model/modality',
    nextAction: 'Add or publish an executable model route',
  },
  AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE: {
    stage: 'routing',
    owner: 'admin',
    retryable: false,
    userMessage: '当前模型线路已被运营暂停或未启用',
    adminMessage: 'Model route exists but is paused or not executable',
    nextAction: 'Enable the route binding in model ops config',
  },
  AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS: {
    stage: 'routing',
    owner: 'admin',
    retryable: false,
    userMessage: '模型线路配置冲突，暂时无法自动选择',
    adminMessage: 'Multiple endpoint mappings matched with the same priority',
    nextAction: 'Set a unique priority or pin an explicit provider',
  },
  AI_GATEWAY_PROVIDER_PAUSED: {
    stage: 'routing',
    owner: 'admin',
    retryable: true,
    userMessage: '供应商线路暂时不可用，请稍后重试或换线路',
    adminMessage: 'Provider route is paused by ops control',
    nextAction: 'Resume the paused provider, then rerun Route Check',
  },
  AI_GATEWAY_MODEL_ADAPTER_PENDING: {
    stage: 'adapter',
    owner: 'developer',
    retryable: false,
    userMessage: '该模型还在接入中，暂时不能生成',
    adminMessage: 'Model route is still adapter_pending',
    nextAction: 'Finish adapter wiring before publishing',
  },
  AI_GATEWAY_MODEL_PARAMETER_PENDING: {
    stage: 'adapter',
    owner: 'developer',
    retryable: false,
    userMessage: '该模型还缺参数映射，暂时不能生成',
    adminMessage: 'Endpoint mapping is incomplete for the selected route',
    nextAction: 'Fill required endpoint mapping fields',
  },
  AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE: {
    stage: 'provider_key',
    owner: 'admin',
    retryable: true,
    userMessage: '平台密钥不可用，请稍后重试或联系管理员',
    adminMessage: 'No usable platform key for the selected provider',
    nextAction: 'Add or re-enable a provider key, clear cooldown if needed',
  },
  AI_GATEWAY_PROVIDER_KEY_MISSING: {
    stage: 'provider_key',
    owner: 'admin',
    retryable: true,
    userMessage: '平台密钥缺失，暂时无法调用上游',
    adminMessage: 'Provider key pool has no enabled secret for this provider',
    nextAction: 'Create an enabled provider key before Generation Test',
  },
  AI_GATEWAY_INVALID_JSON: {
    stage: 'admission',
    owner: 'developer',
    retryable: false,
    userMessage: '请求格式无效',
    adminMessage: 'Request body is not valid JSON',
    nextAction: 'Fix the client request payload',
  },
  AI_GATEWAY_BODY_TOO_LARGE: {
    stage: 'admission',
    owner: 'user',
    retryable: false,
    userMessage: '请求内容过大，请缩小输入后再试',
    adminMessage: 'Request body exceeded the AI Gateway size limit',
    nextAction: 'Reduce payload size or upload assets to R2 first',
  },
  AI_GATEWAY_EXECUTION_HANDOFF_FAILED: {
    stage: 'worker',
    owner: 'system',
    retryable: true,
    userMessage: '任务执行失败，请稍后重试',
    adminMessage: 'Worker/adapter handoff failed during execution',
    nextAction: 'Inspect gatewayFailure and upstream response details',
  },
  AI_GATEWAY_INTERNAL_ERROR: {
    stage: 'system',
    owner: 'system',
    retryable: true,
    userMessage: '服务暂时异常，请稍后重试',
    adminMessage: 'Unhandled AI Gateway internal error',
    nextAction: 'Check server logs around the failing job id',
  },
  AI_GATEWAY_ROUTE_ERROR: {
    stage: 'routing',
    owner: 'developer',
    retryable: false,
    userMessage: '未能匹配到可用供应商线路',
    adminMessage: 'Provider router could not resolve a runtime route',
    nextAction: 'Align model route catalog with provider-router entries',
  },
  AI_GATEWAY_NO_PROVIDER_ROUTE: {
    stage: 'routing',
    owner: 'developer',
    retryable: false,
    userMessage: '未能匹配到可用供应商线路',
    adminMessage: 'Provider router could not resolve a runtime route',
    nextAction: 'Align model route catalog with provider-router entries',
  },
  AI_GATEWAY_ADAPTER_RESULT_INVALID: {
    stage: 'artifact',
    owner: 'developer',
    retryable: false,
    userMessage: '任务结果格式异常，请稍后重试或联系管理员',
    adminMessage: 'Adapter result failed AiGatewayAdapterResult contract validation',
    nextAction: 'Normalize adapter output to status/artifacts/output/usage/failureReason',
  },
  AI_WORKER_PROXY_POLL_TIMEOUT: {
    stage: 'upstream',
    owner: 'upstream',
    retryable: true,
    userMessage: '上游任务轮询超时，请稍后重试',
    adminMessage: 'AI Worker Proxy job polling timed out',
    nextAction: 'Inspect proxy job status and increase poll timeout if needed',
  },
  AI_WORKER_PROXY_ASYNC_FAILED: {
    stage: 'upstream',
    owner: 'upstream',
    retryable: true,
    userMessage: '上游任务失败，请稍后重试',
    adminMessage: 'AI Worker Proxy async job failed',
    nextAction: 'Inspect proxy error payload and retry',
  },
});

function reasonFromFallback(error) {
  const classified = classifyAiGatewayFallbackError(error);
  if (classified.reason === 'rate_limit') {
    return {
      code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED',
      stage: 'upstream',
      owner: 'upstream',
      retryable: true,
      userMessage: '上游限流，请稍后重试',
      adminMessage: `Upstream rate limited (HTTP ${classified.status || 429})`,
      nextAction: 'Retry later or switch to a fallback provider',
      rawCode: codeFromInput(error) || undefined,
    };
  }
  if (classified.reason === 'timeout') {
    return {
      code: 'AI_GATEWAY_UPSTREAM_TIMEOUT',
      stage: 'upstream',
      owner: 'upstream',
      retryable: true,
      userMessage: '上游响应超时，请稍后重试',
      adminMessage: 'Upstream request timed out',
      nextAction: 'Retry with a longer timeout or another provider',
      rawCode: codeFromInput(error) || undefined,
    };
  }
  if (classified.reason === 'upstream_5xx' || classified.reason === 'network_error') {
    return {
      code: 'AI_GATEWAY_UPSTREAM_UNAVAILABLE',
      stage: 'upstream',
      owner: 'upstream',
      retryable: true,
      userMessage: '上游暂时不可用，请稍后重试',
      adminMessage: `Upstream unavailable (${classified.reason})`,
      nextAction: 'Check provider health and retry',
      rawCode: codeFromInput(error) || undefined,
    };
  }
  if (classified.reason === 'provider_key_missing') {
    return buildFromCode('AI_GATEWAY_PROVIDER_KEY_MISSING', error);
  }
  return null;
}

function buildFromCode(code, errorOrCode, overrides = {}) {
  const base = CODE_TABLE[code];
  const message = messageFromInput(errorOrCode);
  if (!base) {
    return {
      code: code || 'AI_GATEWAY_INTERNAL_ERROR',
      stage: overrides.stage || 'system',
      owner: overrides.owner || 'system',
      retryable: overrides.retryable !== false,
      userMessage: overrides.userMessage || message || '任务失败，请稍后重试',
      adminMessage: overrides.adminMessage || message || 'Unhandled AI Gateway failure',
      nextAction: overrides.nextAction || 'Inspect job detail and server logs',
      rawCode: code || undefined,
    };
  }
  return {
    code,
    stage: base.stage,
    owner: base.owner,
    retryable: base.retryable,
    userMessage: base.userMessage,
    adminMessage: base.adminMessage || message,
    nextAction: base.nextAction,
    rawCode: code !== codeFromInput(errorOrCode) ? codeFromInput(errorOrCode) || undefined : undefined,
    ...overrides,
  };
}

function inferEmptyArtifact(message) {
  return /no (downloadable|image|video|model)|empty artifact|without (image|video|model) output|produced no /i.test(
    message || ''
  );
}

/**
 * Map any Gateway error/code into a stable failure reason.
 * @param {unknown} errorOrCode
 * @param {{ stage?: string, defaultCode?: string }} [context]
 */
export function resolveAiGatewayFailureReason(errorOrCode, context = {}) {
  const code = codeFromInput(errorOrCode) || nonEmptyString(context.defaultCode);
  const message = messageFromInput(errorOrCode);
  const status = typeof errorOrCode === 'object' ? httpStatusFromError(errorOrCode) : 0;

  if (code && CODE_TABLE[code]) {
    // Execution handoff is a wrapper: prefer upstream classification from the message/status.
    if (code === 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED') {
      const fromFallback = reasonFromFallback(
        typeof errorOrCode === 'object' && errorOrCode
          ? errorOrCode
          : { code, message, status }
      );
      if (fromFallback) return fromFallback;
      if (inferEmptyArtifact(message)) {
        return {
          code: 'AI_GATEWAY_ARTIFACT_EMPTY',
          stage: 'artifact',
          owner: 'upstream',
          retryable: true,
          userMessage: '任务完成但没有可用产物，请重试或更换模型',
          adminMessage: message || 'Terminal job without usable artifacts',
          nextAction: 'Inspect adapter output/artifacts and rerun Generation Test',
          rawCode: code,
        };
      }
    }
    return buildFromCode(code, errorOrCode);
  }

  // Common aliases from credits gate / auth bodies
  if (code === 'LOGIN_REQUIRED' || /login required/i.test(message)) {
    return buildFromCode('LOGIN_REQUIRED', errorOrCode);
  }
  if (code === 'CREDITS_EXCEEDED' || /积分不足|credits? exceeded|insufficient credits/i.test(message)) {
    return buildFromCode('CREDITS_EXCEEDED', errorOrCode);
  }
  if (/not published|unpublished/i.test(message)) {
    return buildFromCode('AI_GATEWAY_MODEL_NOT_PUBLISHED', errorOrCode);
  }
  if (inferEmptyArtifact(message) || context.stage === 'artifact') {
    return {
      code: 'AI_GATEWAY_ARTIFACT_EMPTY',
      stage: 'artifact',
      owner: 'upstream',
      retryable: true,
      userMessage: '任务完成但没有可用产物，请重试或更换模型',
      adminMessage: message || 'Terminal job succeeded/failed without usable artifacts',
      nextAction: 'Inspect adapter output/artifacts and rerun Generation Test',
      rawCode: code || undefined,
    };
  }

  const fromFallback = reasonFromFallback(
    typeof errorOrCode === 'object' && errorOrCode
      ? errorOrCode
      : { code, message, status }
  );
  if (fromFallback) return fromFallback;

  if (code === 'AiGatewayRouteError' || /No AI provider route/i.test(message)) {
    return buildFromCode('AI_GATEWAY_ROUTE_ERROR', errorOrCode, {
      adminMessage: message || CODE_TABLE.AI_GATEWAY_ROUTE_ERROR.adminMessage,
    });
  }

  if (status === 429) {
    return reasonFromFallback({ code, message, status: 429 });
  }
  if (status >= 500) {
    return reasonFromFallback({ code, message, status });
  }

  return buildFromCode(code || context.defaultCode || 'AI_GATEWAY_INTERNAL_ERROR', errorOrCode, {
    stage: context.stage || 'system',
  });
}

export function publicAiGatewayFailureReason(reason) {
  if (!reason || typeof reason !== 'object') return null;
  return {
    code: nonEmptyString(reason.code) || 'AI_GATEWAY_INTERNAL_ERROR',
    stage: nonEmptyString(reason.stage) || 'system',
    owner: nonEmptyString(reason.owner) || 'system',
    retryable: reason.retryable === true,
    userMessage: nonEmptyString(reason.userMessage) || '任务失败，请稍后重试',
    adminMessage: nonEmptyString(reason.adminMessage) || reason.userMessage || 'AI Gateway failure',
    nextAction: nonEmptyString(reason.nextAction) || 'Inspect job detail',
    ...(reason.rawCode ? { rawCode: String(reason.rawCode) } : {}),
  };
}

export function attachFailureReasonToErrorBody(body, errorOrCode, context = {}) {
  const base = body && typeof body === 'object' ? { ...body } : {};
  const rawCode = nonEmptyString(base.error) || nonEmptyString(base.code) || codeFromInput(errorOrCode);
  const reason = publicAiGatewayFailureReason(
    resolveAiGatewayFailureReason(
      errorOrCode && typeof errorOrCode === 'object'
        ? { ...errorOrCode, code: rawCode || errorOrCode.code, message: base.message || errorOrCode.message }
        : { code: rawCode || codeFromInput(errorOrCode), message: base.message || messageFromInput(errorOrCode) },
      context
    )
  );
  return {
    ...base,
    ...(rawCode && !base.error ? { error: rawCode } : {}),
    failureReason: reason,
  };
}

export function gatewayFailureMetadata(errorOrCode, context = {}) {
  const reason = publicAiGatewayFailureReason(resolveAiGatewayFailureReason(errorOrCode, context));
  return {
    gatewayFailure: {
      ...reason,
      at: new Date().toISOString(),
      ...(context.providerId ? { providerId: context.providerId } : {}),
      ...(context.adapterId ? { adapterId: context.adapterId } : {}),
      ...(context.workerId ? { workerId: context.workerId } : {}),
    },
  };
}

/**
 * Attach a resolved failureReason onto an Error (or plain object) so callers/adapters
 * never cross the Gateway boundary with a bare message only.
 */
export function decorateErrorWithFailureReason(error, context = {}) {
  if (error == null) return error;
  const reason = publicAiGatewayFailureReason(resolveAiGatewayFailureReason(error, context));
  if (error instanceof Error) {
    if (!error.failureReason) error.failureReason = reason;
    if (!error.code && reason?.code) error.code = reason.code;
    if (Number.isFinite(Number(error.status)) === false && Number.isFinite(Number(context.status))) {
      error.status = Number(context.status);
    }
    return error;
  }
  if (typeof error === 'object') {
    return {
      ...error,
      failureReason: error.failureReason || reason,
      code: error.code || reason?.code,
    };
  }
  const wrapped = new Error(String(error));
  wrapped.failureReason = reason;
  wrapped.code = reason?.code;
  return wrapped;
}
