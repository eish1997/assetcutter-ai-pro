'use strict';

/**
 * P0 联调大脑：关键词触发 tool_call，无外部 LLM 依赖。
 */
function createStubBrainAdapter() {
  const id = 'stub';
  const displayName = 'Stub（P0 联调）';

  async function probe() {
    return { ok: true, detail: 'local stub brain' };
  }

  function pickToolCalls(userText) {
    const t = String(userText || '').toLowerCase();
    const calls = [];

    if (/脚本|script/.test(t) && /(打开|切|去|navigate)/.test(t)) {
      calls.push({ name: 'ac.shell.navigate', arguments: { view: 'scripts' } });
    } else if (/工作台|workbench|主站/.test(t) && /(打开|切|去)/.test(t)) {
      calls.push({ name: 'ac.shell.navigate', arguments: { view: 'workbench' } });
    } else if (/工具/.test(t) && /(打开|切|去)/.test(t)) {
      calls.push({ name: 'ac.shell.navigate', arguments: { view: 'tools' } });
    } else if (/首页|home/.test(t) && /(打开|切|去|回)/.test(t)) {
      calls.push({ name: 'ac.shell.navigate', arguments: { view: 'home' } });
    } else if (/设置|settings/.test(t) && /(打开|切|去)/.test(t)) {
      calls.push({ name: 'ac.shell.navigate', arguments: { view: 'settings' } });
    }

    if (/伴侣|runtime|引擎|sam|rembg|状态|健康/.test(t)) {
      if (/runtime|引擎|sam|rembg|详细/.test(t)) {
        calls.push({ name: 'ac.companion.runtime_status', arguments: {} });
      } else {
        calls.push({ name: 'ac.shell.get_state', arguments: {} });
      }
    }

    return calls;
  }

  function formatToolFollowUp(lastToolMsg) {
    if (!lastToolMsg || lastToolMsg.role !== 'tool') return '已完成。\n';
    const name = lastToolMsg.name || '';
    const raw = String(lastToolMsg.content || '').trim();
    if (name === 'ac.shell.get_state' || name === 'ac.companion.runtime_status') {
      return raw ? `${raw}\n` : '已完成。\n';
    }
    if (name === 'ac.shell.navigate') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.navigated) {
          return `已切换到 ${parsed.navigated} 页。\n`;
        }
      } catch {
        /* fall through */
      }
    }
    try {
      const err = JSON.parse(raw);
      if (err && err.message) {
        return `工具 ${name} 失败：${err.message}\n`;
      }
    } catch {
      /* ignore */
    }
    if (raw && raw.length < 500) return `${raw}\n`;
    return '已完成。\n';
  }

  async function* streamTurn(input) {
    if (input.signal && input.signal.aborted) {
      yield { type: 'done', stopReason: 'aborted' };
      return;
    }
    const messages = input.messages || [];
    const last = messages.length ? messages[messages.length - 1] : null;
    if (last && last.role === 'tool') {
      yield { type: 'text_delta', text: formatToolFollowUp(last) };
      yield { type: 'done', stopReason: 'stop' };
      return;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content || '';
    const toolCalls = pickToolCalls(text);

    if (toolCalls.length === 0) {
      yield {
        type: 'text_delta',
        text:
          '我是 P0 Stub 大脑。可尝试：\n' +
          '• 「打开脚本页」\n' +
          '• 「打开工作台」\n' +
          '• 「伴侣状态」或「runtime 状态」',
      };
      yield { type: 'done', stopReason: 'stop' };
      return;
    }

    yield { type: 'text_delta', text: '好的，我来执行。\n' };
    let i = 0;
    for (const tc of toolCalls) {
      i += 1;
      yield {
        type: 'tool_call',
        id: `call_stub_${Date.now()}_${i}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments || {}),
      };
    }
    yield { type: 'done', stopReason: 'tool_calls' };
  }

  return { id, displayName, probe, streamTurn };
}

module.exports = { createStubBrainAdapter };
