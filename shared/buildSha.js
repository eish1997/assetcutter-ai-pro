/**
 * C11 — shared build identity for web / auth-api / ai-worker-proxy.
 * Prefer deploy-injected SHA; fall back to local git HEAD; else "unknown".
 */

import { execSync } from 'node:child_process';

const ENV_KEYS = [
  'BUILD_SHA',
  'GIT_SHA',
  'RENDER_GIT_COMMIT',
  'COMMIT_REF',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'VITE_BUILD_SHA',
];

function tryGitHeadSha() {
  try {
    return String(execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch {
    return '';
  }
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] */
export function resolveBuildSha(env = process.env) {
  for (const key of ENV_KEYS) {
    const value = String(env?.[key] || '').trim();
    if (value) return value.slice(0, 40);
  }
  const git = tryGitHeadSha();
  if (git) return git.slice(0, 40);
  return 'unknown';
}

/**
 * @param {string} service
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function buildIdentityFields(service, env = process.env) {
  const buildSha = resolveBuildSha(env);
  return {
    service: String(service || '').trim() || 'unknown',
    buildSha,
    gitSha: buildSha,
  };
}
