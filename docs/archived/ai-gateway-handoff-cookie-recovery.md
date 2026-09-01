# AI Gateway Handoff Cookie Recovery Note

Date: 2026-07-19

## Symptom

Online workflow jobs such as "line art / image generation step" could fail with a generic request failure. Admin job details showed that a prior ai-worker-proxy cold-start `502` was later recovered into `LOGIN_REQUIRED`.

## Cause

The recovered handoff is sent by auth-api in the background, so it has no browser Cookie. If ai-worker-proxy and auth-api do not share matching proxy HMAC/internal secrets, ai-worker-proxy falls back to session-cookie credits-gate validation and rejects the request before it reaches Google.

This is not evidence of Google billing or quota failure. A Google billing/quota issue should appear as an upstream Google error after the worker starts execution.

## Fix

Auth-api now signs reserved AI Gateway handoffs with `X-AC-AI-Gateway-Handoff`. Ai-worker-proxy can validate that short-lived token through auth-api `/api/internal/ai-gateway/validate-handoff`, confirm the user and reserve key, and accept recovered no-cookie jobs.

## Regression

- `tests/aiGatewayExecutor.test.ts` covers token emission during normal and recovered handoff.
- `tests/aiWorkerProxyCreditsGateServer.test.ts` covers no-cookie/no-shared-secret acceptance via auth-api token validation.
