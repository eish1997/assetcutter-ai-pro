'use strict';

function escapeForJsString(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function buildFillDshComposerScript(text, opts) {
  const encoded = escapeForJsString(text);
  const submit = Boolean(opts && opts.submit);
  return `(async function () {
    const text = ${encoded};
    const shouldSubmit = ${submit ? 'true' : 'false'};
    if (!text) return false;

    function persistDraft(next) {
      if (typeof localStorage === 'undefined') return false;
      let wrote = false;
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith('dsh.conversation.chat')) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          let state;
          try {
            state = JSON.parse(raw);
          } catch {
            continue;
          }
          if (!state || typeof state !== 'object') continue;
          if (state.draft === next) {
            wrote = true;
            continue;
          }
          state.draft = next;
          localStorage.setItem(key, JSON.stringify(state));
          wrote = true;
        }
      } catch {
        /* ignore storage failures */
      }
      return wrote;
    }

    function setNativeValue(element, value) {
      const proto = window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : Object.getPrototypeOf(element);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && typeof desc.set === 'function') {
        desc.set.call(element, value);
      } else {
        element.value = value;
      }
    }

    function resetValueTracker(element) {
      const tracker = element._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') {
        tracker.setValue('');
      }
    }

    function invokeReactOnChange(element) {
      const keys = Object.getOwnPropertyNames(element);
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!key.startsWith('__reactProps$') && !key.startsWith('__reactFiber$')) continue;
        const bag = element[key];
        const props = key.startsWith('__reactProps$') ? bag : bag && bag.memoizedProps;
        if (!props || typeof props.onChange !== 'function') continue;
        props.onChange({
          target: element,
          currentTarget: element,
          type: 'change',
          bubbles: true,
          persist: function () {},
        });
        return true;
      }
      return false;
    }

    function pickComposerTextarea() {
      const preferred = document.querySelector(
        '[data-input-scroll] textarea[data-phase="plain"]:not([disabled])',
      );
      if (preferred && !preferred.readOnly) return preferred;
      return null;
    }

    function composerShows(next) {
      const mirror = document.querySelector('[data-input-mirror]');
      const backdrop = document.querySelector('[data-input-backdrop]');
      const hay = String((mirror && mirror.textContent) || '') + String((backdrop && backdrop.textContent) || '');
      return hay.includes(next);
    }

    function tryFill() {
      const textarea = pickComposerTextarea();
      if (!textarea) return false;
      resetValueTracker(textarea);
      setNativeValue(textarea, text);
      textarea.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertFromPaste',
          data: text,
        }),
      );
      textarea.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertFromPaste',
          data: text,
        }),
      );
      invokeReactOnChange(textarea);
      try {
        textarea.focus();
        textarea.selectionStart = text.length;
        textarea.selectionEnd = text.length;
      } catch {
        /* ignore caret failures */
      }
      return composerShows(text);
    }

    function trySubmit() {
      const textarea = pickComposerTextarea();
      if (!textarea) return false;
      const form = textarea.form || (textarea.closest && textarea.closest('form'));
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return true;
      }
      const card = document.querySelector('[data-composer-card]');
      const send =
        (card && card.querySelector('button[type="submit"]:not([disabled])')) ||
        (card && card.querySelector('button:not([disabled])')) ||
        document.querySelector('button[type="submit"]:not([disabled])');
      if (send) {
        send.click();
        return true;
      }
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
          code: 'Enter',
        }),
      );
      return true;
    }

    persistDraft(text);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (tryFill()) {
        if (shouldSubmit) trySubmit();
        return true;
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, 150);
      });
    }
    return false;
  })()`;
}

module.exports = {
  buildFillDshComposerScript,
};
