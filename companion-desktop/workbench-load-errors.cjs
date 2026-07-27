'use strict';

/**
 * Chromium loadURL failures that often mean "wrong proxy path", not "site dead".
 * Used to decide whether to retry with session proxy mode=direct (or vice versa).
 */
function isProxyOrTransientLoadError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /ERR_PROXY|PROXY_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_ABORTED|\(-3\)|ERR_CONNECTION_TIMED_OUT|\(-118\)|ERR_TIMED_OUT|ERR_CONNECTION_RESET|\(-101\)|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|\(-102\)|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED/i.test(
    msg,
  );
}

module.exports = {
  isProxyOrTransientLoadError,
  /** @deprecated alias — older call sites */
  isProxyOrAbortLoadError: isProxyOrTransientLoadError,
};
