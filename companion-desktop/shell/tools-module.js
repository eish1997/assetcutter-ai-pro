/**
 * Shell tool panel renderer (PanelSpec v1 whitelist).
 * @see docs/本地伴侣-小工具架开发规格.md
 */
(function () {
  'use strict';

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function closeAllDropdowns(except) {
    document.querySelectorAll('.shell-tool-dd.open').forEach((node) => {
      if (except && node === except) return;
      node.classList.remove('open');
    });
  }

  document.addEventListener('click', () => closeAllDropdowns(null));

  function createCustomSelect(field, value, onChange) {
    const wrap = el('div', 'shell-tool-dd');
    const trigger = el('button', 'shell-tool-dd-trigger', '');
    trigger.type = 'button';
    const opts = field.options || [];
    const current = opts.find((o) => o.value === value) || opts[0];
    trigger.textContent = current ? current.label : '—';
    const list = el('div', 'shell-tool-dd-list');
    for (const opt of opts) {
      const item = el('button', 'shell-tool-dd-item', opt.label);
      item.type = 'button';
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        trigger.textContent = opt.label;
        wrap.classList.remove('open');
        onChange(opt.value);
      });
      list.appendChild(item);
    }
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains('open');
      closeAllDropdowns(wrap);
      wrap.classList.toggle('open', !wasOpen);
    });
    wrap.appendChild(trigger);
    wrap.appendChild(list);
    return wrap;
  }

  /**
   * @param {HTMLElement} container
   * @param {object} panel
   * @param {Record<string, string|boolean>} state
   * @param {{ pickPath?: (opts: { pick: string }) => Promise<{ ok?: boolean, path?: string, canceled?: boolean }> }} handlers
   * @param {(next: Record<string, string|boolean>) => void} onStateChange
   */
  function renderPanelFields(container, panel, state, handlers, onStateChange) {
    container.innerHTML = '';
    for (const sec of panel.sections || []) {
      const secEl = el('div', 'shell-tool-section');
      for (const field of sec.fields || []) {
        const row = el('div', 'shell-tool-field');
        row.appendChild(el('label', 'shell-tool-label', field.label));
        const control = el('div', 'shell-tool-control');
        const id = field.id;
        if (field.type === 'path') {
          const inp = el('input', 'shell-tool-input mono');
          inp.type = 'text';
          inp.readOnly = true;
          inp.value = typeof state[id] === 'string' ? state[id] : '';
          inp.placeholder = field.pick === 'file' ? '未选择文件' : '未选择文件夹';
          const btn = el('button', 'btn', '选择…');
          btn.type = 'button';
          if (!handlers.pickPath) {
            btn.disabled = true;
            btn.title = '此工具未声明 path.pick 权限';
          } else {
            btn.addEventListener('click', async () => {
            if (!handlers.pickPath) return;
            try {
              const r = await handlers.pickPath({ pick: field.pick || 'directory' });
              if (r && r.ok && r.path) {
                state[id] = r.path;
                inp.value = r.path;
                onStateChange({ ...state });
              }
            } catch {
              /* ignore */
            }
          });
          }
          control.appendChild(inp);
          control.appendChild(btn);
        } else if (field.type === 'select') {
          const val = typeof state[id] === 'string' ? state[id] : field.default || '';
          if (!state[id] && field.default) state[id] = field.default;
          control.appendChild(
            createCustomSelect(field, val, (v) => {
              state[id] = v;
              onStateChange({ ...state });
            }),
          );
        } else if (field.type === 'text') {
          const inp = el('input', 'shell-tool-input');
          inp.type = 'text';
          inp.value = typeof state[id] === 'string' ? state[id] : field.default || '';
          if (!state[id] && field.default) state[id] = field.default;
          inp.addEventListener('input', () => {
            state[id] = inp.value;
            onStateChange({ ...state });
          });
          control.appendChild(inp);
        } else if (field.type === 'toggle') {
          const inp = el('input', 'shell-tool-toggle');
          inp.type = 'checkbox';
          inp.checked = Boolean(state[id] ?? field.default ?? false);
          state[id] = inp.checked;
          inp.addEventListener('change', () => {
            state[id] = inp.checked;
            onStateChange({ ...state });
          });
          control.appendChild(inp);
        }
        row.appendChild(control);
        secEl.appendChild(row);
      }
      container.appendChild(secEl);
    }
  }

  function renderActions(container, panel, onAction) {
    container.innerHTML = '';
    const row = el('div', 'btn-row');
    for (const act of panel.actions || []) {
      const btn = el(
        'button',
        'btn ' + (act.style === 'primary' ? 'btn-primary' : ''),
        act.label || act.id,
      );
      btn.type = 'button';
      btn.addEventListener('click', () => onAction(act));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }

  function appendLog(logEl, text) {
    if (!logEl) return;
    logEl.classList.remove('hidden');
    logEl.textContent += String(text || '');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog(logEl) {
    if (!logEl) return;
    logEl.textContent = '';
    logEl.classList.add('hidden');
  }

  window.ShellToolsModule = {
    renderPanelFields,
    renderActions,
    appendLog,
    clearLog,
  };
})();
