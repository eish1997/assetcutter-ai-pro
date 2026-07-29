/**
 * Shell tool panel renderer (PanelSpec v1 whitelist).
 * Compact industrial layout; type-distinct controls.
 * @see docs/本地伴侣-小工具架开发规格.md
 */
(function () {
  'use strict';

  var SECTION_TITLE_FALLBACK = {
    maya: '连接',
    connection: '连接',
    export: '导出',
    input: '输入',
    output: '输出',
    main: '参数',
    options: '选项',
  };

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function closeAllDropdowns(except) {
    document.querySelectorAll('.shell-tool-dd.open').forEach(function (node) {
      if (except && node === except) return;
      node.classList.remove('open');
    });
  }

  document.addEventListener('click', function () {
    closeAllDropdowns(null);
  });

  function createCustomSelect(field, value, onChange) {
    var wrap = el('div', 'shell-tool-dd');
    var trigger = el('button', 'shell-tool-dd-trigger', '');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    var opts = field.options || [];
    var current = opts.find(function (o) {
      return o.value === value;
    }) || opts[0];
    var labelSpan = el('span', 'shell-tool-dd-label', current ? current.label : '—');
    var chevron = el('span', 'shell-tool-dd-chevron', '');
    chevron.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    trigger.appendChild(labelSpan);
    trigger.appendChild(chevron);
    var list = el('div', 'shell-tool-dd-list');
    list.setAttribute('role', 'listbox');
    for (var i = 0; i < opts.length; i++) {
      (function (opt) {
        var item = el('button', 'shell-tool-dd-item', opt.label);
        item.type = 'button';
        if (current && opt.value === current.value) item.classList.add('is-active');
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          labelSpan.textContent = opt.label;
          list.querySelectorAll('.shell-tool-dd-item').forEach(function (n) {
            n.classList.toggle('is-active', n === item);
          });
          wrap.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          onChange(opt.value);
        });
        list.appendChild(item);
      })(opts[i]);
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = wrap.classList.contains('open');
      closeAllDropdowns(wrap);
      wrap.classList.toggle('open', !wasOpen);
      trigger.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
    });
    wrap.appendChild(trigger);
    wrap.appendChild(list);
    return wrap;
  }

  function sectionTitle(sec) {
    if (sec && typeof sec.title === 'string' && sec.title.trim()) return sec.title.trim();
    var id = sec && sec.id ? String(sec.id) : '';
    return SECTION_TITLE_FALLBACK[id] || id || '参数';
  }

  function fieldSpanClass(field) {
    if (field.type === 'path') return 'shell-tool-field span-2 type-path';
    if (field.type === 'toggle') return 'shell-tool-field span-2 type-toggle';
    if (field.type === 'select') return 'shell-tool-field type-select';
    return 'shell-tool-field type-text';
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
    var form = el('div', 'shell-tool-form');
    for (var s = 0; s < (panel.sections || []).length; s++) {
      var sec = panel.sections[s];
      var secEl = el('section', 'shell-tool-section');
      var head = el('div', 'shell-tool-section-head');
      head.appendChild(el('span', 'shell-tool-section-rail', ''));
      head.appendChild(el('h2', 'shell-tool-section-title', sectionTitle(sec)));
      secEl.appendChild(head);

      var grid = el('div', 'shell-tool-section-grid');
      for (var f = 0; f < (sec.fields || []).length; f++) {
        var field = sec.fields[f];
        var row = el('div', fieldSpanClass(field));
        var id = field.id;

        if (field.type === 'toggle') {
          var togLabel = el('label', 'shell-tool-toggle-row');
          var togInp = el('input', 'shell-tool-toggle');
          togInp.type = 'checkbox';
          togInp.checked = Boolean(state[id] != null ? state[id] : field.default);
          state[id] = togInp.checked;
          togInp.addEventListener(
            'change',
            (function (fieldId, inputEl) {
              return function () {
                state[fieldId] = inputEl.checked;
                onStateChange(Object.assign({}, state));
              };
            })(id, togInp),
          );
          var switchUi = el('span', 'shell-tool-switch', '');
          var text = el('span', 'shell-tool-toggle-text', field.label);
          togLabel.appendChild(togInp);
          togLabel.appendChild(switchUi);
          togLabel.appendChild(text);
          row.appendChild(togLabel);
          grid.appendChild(row);
          continue;
        }

        row.appendChild(el('label', 'shell-tool-label', field.label));
        var control = el('div', 'shell-tool-control');

        if (field.type === 'path') {
          var pathInp = el('input', 'shell-tool-input mono');
          pathInp.type = 'text';
          pathInp.readOnly = true;
          pathInp.value = typeof state[id] === 'string' ? state[id] : '';
          pathInp.placeholder = field.pick === 'file' ? '未选择文件' : '未选择文件夹';
          var btn = el('button', 'btn btn-ghost btn-compact', '浏览');
          btn.type = 'button';
          if (!handlers.pickPath) {
            btn.disabled = true;
            btn.title = '此工具未声明 path.pick 权限';
          } else {
            btn.addEventListener('click', (function (fieldId, inputEl, pick) {
              return async function () {
                if (!handlers.pickPath) return;
                try {
                  var r = await handlers.pickPath({ pick: pick || 'directory' });
                  if (r && r.ok && r.path) {
                    state[fieldId] = r.path;
                    inputEl.value = r.path;
                    onStateChange(Object.assign({}, state));
                  }
                } catch {
                  /* ignore */
                }
              };
            })(id, pathInp, field.pick));
          }
          control.appendChild(pathInp);
          control.appendChild(btn);
        } else if (field.type === 'select') {
          var val = typeof state[id] === 'string' ? state[id] : field.default || '';
          if (!state[id] && field.default) state[id] = field.default;
          control.appendChild(
            createCustomSelect(field, val, (function (fieldId) {
              return function (v) {
                state[fieldId] = v;
                onStateChange(Object.assign({}, state));
              };
            })(id)),
          );
        } else if (field.type === 'text') {
          var textInp = el('input', 'shell-tool-input' + (looksLikeHostOrPort(field) ? ' mono' : ''));
          textInp.type = 'text';
          textInp.value = typeof state[id] === 'string' ? state[id] : field.default || '';
          if (!state[id] && field.default) state[id] = field.default;
          if (field.id && /port/i.test(field.id)) textInp.inputMode = 'numeric';
          textInp.addEventListener(
            'input',
            (function (fieldId, inputEl) {
              return function () {
                state[fieldId] = inputEl.value;
                onStateChange(Object.assign({}, state));
              };
            })(id, textInp),
          );
          control.appendChild(textInp);
        }

        row.appendChild(control);
        grid.appendChild(row);
      }
      secEl.appendChild(grid);
      form.appendChild(secEl);
    }
    container.appendChild(form);
  }

  function looksLikeHostOrPort(field) {
    var id = String((field && field.id) || '');
    var label = String((field && field.label) || '');
    return /host|port|addr|ip/i.test(id) || /地址|端口|host|port/i.test(label);
  }

  function renderActions(container, panel, onAction) {
    container.innerHTML = '';
    var footer = el('div', 'shell-tool-actions');
    var row = el('div', 'btn-row');
    for (var i = 0; i < (panel.actions || []).length; i++) {
      (function (act) {
        var btn = el(
          'button',
          'btn ' + (act.style === 'primary' ? 'btn-primary' : 'btn-ghost'),
          act.label || act.id,
        );
        btn.type = 'button';
        btn.addEventListener('click', function () {
          onAction(act);
        });
        row.appendChild(btn);
      })(panel.actions[i]);
    }
    footer.appendChild(row);
    container.appendChild(footer);
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
    renderPanelFields: renderPanelFields,
    renderActions: renderActions,
    appendLog: appendLog,
    clearLog: clearLog,
  };
})();
