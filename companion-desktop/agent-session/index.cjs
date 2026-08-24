'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { createStubBrainAdapter } = require('../brain-adapters/stub.cjs');

const MAX_TOOL_STEPS = 8;

/**
 * @param {{
 *   store: ReturnType<import('../agent-store.cjs').createAgentStore>;
 *   bodyHost: ReturnType<import('../agent-body-host.cjs').createAgentBodyHost>;
 *   getShellView: () => string;
 *   getBrain?: () => import('../agent-types.d.ts').AgentBrainPort;
 *   ensureBrainReady?: () => Promise<void>;
 *   gateTool?: (tool: { name: string; risk: string }) => 'allow' | 'confirm' | 'deny';
 *   waitForConfirm?: (confirmId: string, meta: object) => Promise<boolean | { approved: boolean; reason?: string }>;
 *   cancelPendingConfirms?: () => void;
 *   onEvent?: (payload: object) => void;
 * }} deps
 */
function safeParseJsonObject(raw, fallback) {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function argsDigest(args) {
  try {
    return createHash('sha256').update(JSON.stringify(args || {})).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function normalizeConfirmResult(raw) {
  if (raw && typeof raw === 'object' && 'approved' in raw) {
    return {
      approved: Boolean(raw.approved),
      reason: String(raw.reason || (raw.approved ? 'approved' : 'rejected')),
    };
  }
  if (raw === true) return { approved: true, reason: 'approved' };
  return { approved: false, reason: 'rejected' };
}

function createAgentSessionService(deps) {
  let activeAbort = null;
  let turnBusy = false;
  /** @type {string | null} */
  let activeSessionId = null;
  /** @type {ReturnType<createStubBrainAdapter> | null} */
  let defaultStubBrain = null;

  function getBrain() {
    if (deps.getBrain) return deps.getBrain();
    if (!defaultStubBrain) defaultStubBrain = createStubBrainAdapter();
    return defaultStubBrain;
  }

  function emit(payload) {
    if (typeof deps.onEvent === 'function') {
      try {
        deps.onEvent(payload);
      } catch {
        /* ignore */
      }
    }
  }

  function buildContext(sessionId) {
    return {
      sessionId,
      brainId: getBrain().id,
      shellView: deps.getShellView(),
    };
  }

  function appendToolAudit(ctx, name, ok, errorCode, args, extra) {
    deps.store.appendAudit({
      ts: new Date().toISOString(),
      clientId: 'copilot',
      sessionId: ctx.sessionId,
      brainId: ctx.brainId,
      tool: name,
      ok,
      errorCode: errorCode || null,
      argsDigest: argsDigest(args),
      ...(extra && typeof extra === 'object' ? extra : {}),
    });
  }

  async function runToolCall(toolCallId, name, argsRaw, ctx) {
    if (ctx && ctx.signal && ctx.signal.aborted) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_ABORTED', message: 'turn aborted' },
      };
    }
    emit({ type: 'tool_status', toolCallId, name, phase: 'start' });
    let args = {};
    try {
      args = argsRaw ? JSON.parse(argsRaw) : {};
    } catch {
      args = safeParseJsonObject(argsRaw, {});
    }

    const startedAt = Date.now();
    let result;
    if (name.startsWith('ac.')) {
      result = await deps.bodyHost.executeTool(name, args, ctx);
    } else {
      result = {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_UNKNOWN', message: name },
      };
    }

    appendToolAudit(ctx, name, result.ok, result.error?.code || null, args, {
      durationMs: Date.now() - startedAt,
      policyDecision: 'allow',
    });

    emit({
      type: 'tool_status',
      toolCallId,
      name,
      phase: result.ok ? 'done' : 'error',
      detail: result.ok ? undefined : result.error?.message,
      errorCode: result.ok ? undefined : result.error?.code,
      structured: result.ok ? undefined : result.structured,
    });

    return result;
  }

  function persistContextSnapshot(sessionId, brain, messages) {
    if (typeof deps.store.writeContextSnapshot !== 'function') return;
    try {
      deps.store.writeContextSnapshot(sessionId, {
        schemaVersion: 1,
        brainId: brain.id,
        shellView: deps.getShellView(),
        messageCount: messages.length,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }

  async function sendUserMessage(text, options) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return { ok: false, error: 'empty_message' };
    if (turnBusy) return { ok: false, error: 'turn_in_progress' };

    if (typeof deps.ensureBrainReady === 'function') {
      await deps.ensureBrainReady();
    }

    const requestedSessionId =
      options && typeof options === 'object' && options.sessionId ? String(options.sessionId).trim() : '';
    const sessionId = requestedSessionId || deps.store.getOrCreateDefaultSessionId();
    activeSessionId = sessionId;
    const userMsg = deps.store.newMessage('user', trimmed, { brainId: getBrain().id });
    deps.store.appendMessage(sessionId, userMsg);

    turnBusy = true;
    const ac = new AbortController();
    activeAbort = ac;

    try {
      const messages = deps.store.readMessages(sessionId);
      const tools = await deps.bodyHost.listTools();
      const brain = getBrain();
      let codexEscalated = false;
      const settings =
        deps.store && typeof deps.store.readSettings === 'function' ? deps.store.readSettings() : {};
      const codexPermissionMode = String(settings.codexPermissionMode || 'ask');
      if (brain.id === 'codex' && codexPermissionMode === 'full') {
        codexEscalated = true;
        deps.store.appendAudit({
          ts: new Date().toISOString(),
          clientId: 'copilot',
          sessionId,
          brainId: brain.id,
          action: 'codex_full_access_turn',
          approved: true,
          reason: 'permission_mode_full',
        });
      } else if (brain.id === 'codex' && codexPermissionMode !== 'sandbox' && typeof deps.waitForConfirm === 'function') {
        const confirmId = `cfm_${randomUUID()}`;
        emit({
          type: 'confirm_required',
          confirmId,
          name: 'codex.full_access_turn',
          arguments: {
            scope: 'this_turn',
            description:
              'Allow Codex CLI to run this turn with full local execution permissions. Reject to keep the normal sandbox.',
          },
          sessionId,
        });
        const confirmResult = normalizeConfirmResult(
          await deps.waitForConfirm(confirmId, {
            name: 'codex.full_access_turn',
            arguments: { scope: 'this_turn' },
            broadcast: false,
          }),
        );
        if (ac.signal.aborted) {
          emit({ type: 'done', sessionId, stopReason: 'aborted' });
          return { ok: false, error: 'aborted' };
        }
        codexEscalated = Boolean(confirmResult.approved);
        deps.store.appendAudit({
          ts: new Date().toISOString(),
          clientId: 'copilot',
          sessionId,
          brainId: brain.id,
          action: 'codex_full_access_turn',
          approved: codexEscalated,
          reason: confirmResult.reason,
        });
      }
      let steps = 0;

      while (steps < MAX_TOOL_STEPS) {
        if (ac.signal.aborted) {
          emit({ type: 'done', sessionId, stopReason: 'aborted' });
          return { ok: false, error: 'aborted' };
        }
        steps += 1;
        const toolCalls = [];
        let assistantText = '';

        for await (const ev of brain.streamTurn({ messages, tools, signal: ac.signal, sessionId, codexEscalated })) {
          if (ac.signal.aborted) break;
          if (ev.type === 'text_delta') {
            assistantText += ev.text;
            emit({ type: 'text_delta', text: ev.text, sessionId });
          } else if (ev.type === 'tool_call') {
            toolCalls.push(ev);
            emit({
              type: 'tool_call',
              id: ev.id,
              name: ev.name,
              arguments: ev.arguments,
              sessionId,
            });
          } else if (ev.type === 'error') {
            emit({ type: 'error', message: ev.message, sessionId });
            return { ok: false, error: ev.message };
          } else if (ev.type === 'activity') {
            emit({ ...ev, sessionId });
          } else if (ev.type === 'usage') {
            deps.store.appendAudit({
              ts: new Date().toISOString(),
              clientId: 'copilot',
              sessionId,
              brainId: brain.id,
              usage: ev.usage || {},
            });
            emit({ type: 'usage', usage: ev.usage || {}, sessionId });
          } else if (ev.type === 'done') {
            break;
          }
        }

        if (ac.signal.aborted) {
          emit({ type: 'done', sessionId, stopReason: 'aborted' });
          return { ok: false, error: 'aborted' };
        }

        if (toolCalls.length === 0) {
          const assistantMsg = deps.store.newMessage('assistant', assistantText, {
            brainId: brain.id,
          });
          deps.store.appendMessage(sessionId, assistantMsg);
          emit({ type: 'done', sessionId, stopReason: 'stop' });
          persistContextSnapshot(sessionId, brain, [...messages, assistantMsg]);
          return { ok: true, sessionId };
        }

        const assistantMsg = deps.store.newMessage('assistant', assistantText || '', {
          brainId: brain.id,
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: safeParseJsonObject(tc.arguments, {}),
          })),
        });
        deps.store.appendMessage(sessionId, assistantMsg);
        messages.push(assistantMsg);

        for (const tc of toolCalls) {
          if (ac.signal.aborted) {
            emit({ type: 'done', sessionId, stopReason: 'aborted' });
            return { ok: false, error: 'aborted' };
          }

          const parsedArgs = safeParseJsonObject(tc.arguments, {});
          const ctx = { ...buildContext(sessionId), signal: ac.signal, clientId: 'copilot' };
          const schema = tools.find((t) => t.name === tc.name);
          if (schema && typeof deps.gateTool === 'function') {
            const gate = deps.gateTool(schema);
            if (gate === 'deny') {
              appendToolAudit(ctx, tc.name, false, 'AGENT_TOOL_DENIED', parsedArgs, {
                durationMs: 0,
                policyDecision: 'deny',
              });
              const denied = {
                role: 'tool',
                toolCallId: tc.id,
                name: tc.name,
                content: JSON.stringify({ code: 'AGENT_TOOL_DENIED', message: 'policy denied' }),
                meta: { ts: new Date().toISOString(), brainId: brain.id },
              };
              deps.store.appendMessage(sessionId, denied);
              messages.push(denied);
              emit({
                type: 'tool_result',
                toolCallId: tc.id,
                name: tc.name,
                result: { ok: false, content: denied.content },
                sessionId,
              });
              continue;
            }
            if (gate === 'confirm' && typeof deps.waitForConfirm === 'function') {
              const confirmId = `cfm_${randomUUID()}`;
              emit({
                type: 'confirm_required',
                confirmId,
                name: tc.name,
                arguments: parsedArgs,
                risk: schema.risk,
                autoConfirmEligible: Boolean(schema.autoConfirmEligible),
                sessionId,
              });
              const confirmResult = normalizeConfirmResult(
                await deps.waitForConfirm(confirmId, {
                  name: tc.name,
                  arguments: parsedArgs,
                  risk: schema.risk,
                  autoConfirmEligible: Boolean(schema.autoConfirmEligible),
                  broadcast: false,
                }),
              );
              if (ac.signal.aborted) {
                emit({ type: 'done', sessionId, stopReason: 'aborted' });
                return { ok: false, error: 'aborted' };
              }
              if (!confirmResult.approved) {
                if (confirmResult.reason === 'timeout') {
                  emit({ type: 'confirm_cancelled', reason: 'timeout', confirmId, sessionId });
                } else if (confirmResult.reason === 'cancelled') {
                  emit({ type: 'confirm_cancelled', reason: 'cancelled', confirmId, sessionId });
                }
                const rejectCode =
                  ac.signal.aborted || confirmResult.reason === 'cancelled'
                    ? 'AGENT_CONFIRM_ABORTED'
                    : confirmResult.reason === 'timeout'
                      ? 'AGENT_CONFIRM_TIMEOUT'
                      : 'AGENT_CONFIRM_REJECTED';
                appendToolAudit(ctx, tc.name, false, rejectCode, parsedArgs, {
                  durationMs: 0,
                  policyDecision: 'confirm_rejected',
                });
                const rejected = {
                  role: 'tool',
                  toolCallId: tc.id,
                  name: tc.name,
                  content: JSON.stringify({
                    code: rejectCode,
                    message:
                      rejectCode === 'AGENT_CONFIRM_ABORTED'
                        ? 'turn aborted'
                        : rejectCode === 'AGENT_CONFIRM_TIMEOUT'
                          ? 'confirm timeout'
                          : 'user rejected',
                  }),
                  meta: { ts: new Date().toISOString(), brainId: brain.id },
                };
                deps.store.appendMessage(sessionId, rejected);
                messages.push(rejected);
                emit({
                  type: 'tool_result',
                  toolCallId: tc.id,
                  name: tc.name,
                  result: { ok: false, content: rejected.content },
                  sessionId,
                });
                if (ac.signal.aborted) {
                  emit({ type: 'done', sessionId, stopReason: 'aborted' });
                  return { ok: false, error: 'aborted' };
                }
                continue;
              }
            }
          }

          const result = await runToolCall(tc.id, tc.name, tc.arguments, ctx);
          if (ac.signal.aborted) {
            emit({ type: 'done', sessionId, stopReason: 'aborted' });
            return { ok: false, error: 'aborted' };
          }
          const toolMsg = {
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: result.ok ? result.content : JSON.stringify(result.error || {}),
            meta: { ts: new Date().toISOString(), brainId: brain.id },
          };
          deps.store.appendMessage(sessionId, toolMsg);
          messages.push(toolMsg);
          emit({ type: 'tool_result', toolCallId: tc.id, name: tc.name, result, sessionId });
        }

        if (steps >= MAX_TOOL_STEPS) {
          emit({ type: 'done', sessionId, stopReason: 'max_steps' });
          persistContextSnapshot(sessionId, brain, messages);
          return { ok: true, sessionId };
        }
      }

      emit({ type: 'done', sessionId, stopReason: 'max_steps' });
      persistContextSnapshot(sessionId, brain, messages);
      return { ok: true, sessionId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emit({ type: 'error', message: msg, sessionId: activeSessionId });
      return { ok: false, error: msg };
    } finally {
      turnBusy = false;
      activeAbort = null;
      activeSessionId = null;
    }
  }

  function abortTurn() {
    if (!activeAbort && !turnBusy) {
      return { ok: false, error: 'no_active_turn' };
    }
    if (typeof deps.cancelPendingConfirms === 'function') {
      deps.cancelPendingConfirms();
    }
    if (activeAbort) {
      activeAbort.abort();
    }
    emit({ type: 'confirm_cancelled', reason: 'aborted', sessionId: activeSessionId });
    emit({ type: 'done', stopReason: 'aborted', sessionId: activeSessionId });
    return { ok: true };
  }

  function listMessages(sessionId) {
    const id = sessionId || deps.store.getOrCreateDefaultSessionId();
    return deps.store.readMessages(id);
  }

  function clearHistory(sessionId) {
    const id = sessionId || deps.store.getOrCreateDefaultSessionId();
    if (turnBusy || activeAbort) {
      try {
        abortTurn();
      } catch {
        /* ignore */
      }
    }
    const cleared = deps.store.clearMessages(id);
    let brainCleared = null;
    try {
      const brain = getBrain();
      if (brain && typeof brain.clearSession === 'function') {
        brainCleared = brain.clearSession(id);
      }
    } catch {
      /* ignore */
    }
    emit({ type: 'history_cleared', sessionId: id });
    return {
      ok: true,
      sessionId: id,
      messagesCleared: Boolean(cleared && cleared.ok),
      brainCleared,
    };
  }

  async function probeBrain() {
    if (typeof deps.ensureBrainReady === 'function') {
      await deps.ensureBrainReady();
    }
    return getBrain().probe();
  }

  return {
    sendUserMessage,
    abortTurn,
    listMessages,
    clearHistory,
    probeBrain,
    getBrainId: () => getBrain().id,
  };
}

module.exports = { createAgentSessionService };
