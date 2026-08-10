/**
 * Shared capability cloud-version picker UI.
 * Pages own the follow-up action; this helper only returns the selected raw version.
 */
(function () {
  'use strict';

  function ensureStyles() {
    if (document.getElementById('capability-version-picker-style')) return;
    const style = document.createElement('style');
    style.id = 'capability-version-picker-style';
    style.textContent = `
      .capability-version-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(3, 7, 18, 0.58);
      }
      .capability-version-dialog {
        width: min(420px, calc(100vw - 40px));
        max-height: min(520px, calc(100vh - 56px));
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 8px;
        background: rgba(13, 17, 24, 0.98);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .capability-version-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      }
      .capability-version-title {
        min-width: 0;
        font-size: 14px;
        font-weight: 700;
        color: #e5e7eb;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .capability-version-close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        color: #94a3b8;
        background: transparent;
        cursor: pointer;
        font-size: 20px;
        line-height: 28px;
      }
      .capability-version-close:hover {
        color: #e5e7eb;
        background: rgba(148, 163, 184, 0.12);
      }
      .capability-version-list {
        padding: 8px;
        overflow: auto;
        color-scheme: dark;
        scrollbar-width: thin;
        scrollbar-color: rgba(86, 91, 105, 0.72) rgba(8, 9, 12, 0.64);
      }
      .capability-version-option {
        width: 100%;
        min-height: 46px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 0;
        border-radius: 6px;
        color: #e5e7eb;
        background: transparent;
        cursor: pointer;
        text-align: left;
      }
      .capability-version-option:hover,
      .capability-version-option:focus-visible {
        outline: none;
        background: rgba(148, 163, 184, 0.12);
      }
      .capability-version-option.is-current {
        background: rgba(59, 130, 246, 0.16);
      }
      .capability-version-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .capability-version-semver {
        font-size: 14px;
        font-weight: 700;
      }
      .capability-version-date {
        font-size: 12px;
        color: #94a3b8;
      }
      .capability-version-badge {
        flex: 0 0 auto;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 11px;
        color: #bfdbfe;
        background: rgba(59, 130, 246, 0.18);
      }
    `;
    document.head.appendChild(style);
  }

  function fallbackOptions(entry, versions) {
    return (Array.isArray(versions) ? versions : [])
      .map((item, index) => {
        const semver = String((item && item.semver) || '').trim();
        return {
          index,
          id: String((item && item.id) || '').trim(),
          semver,
          dateLabel: item && item.publishedAt ? String(item.publishedAt).slice(0, 10) : 'cloud version',
          current: Boolean(semver && semver === String((entry && (entry.semverLocal || entry.cloudVersion || entry.version)) || '').trim()),
          raw: item,
        };
      })
      .filter((item) => item.id);
  }

  function versionOptions(entry, versions) {
    const schema = window.ShellCapabilityCardSchema;
    if (schema && typeof schema.versionOptions === 'function') {
      return schema.versionOptions({ ...(entry || {}), cloudVersions: versions });
    }
    return fallbackOptions(entry, versions);
  }

  function pick(entry, versions, opts) {
    ensureStyles();
    const existing = document.querySelector('.capability-version-backdrop');
    if (existing) existing.remove();
    const options = versionOptions(entry, versions);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (version) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeydown);
        backdrop.remove();
        resolve(version || null);
      };
      const onKeydown = (ev) => {
        if (ev.key === 'Escape') finish(null);
      };

      const backdrop = document.createElement('div');
      backdrop.className = 'capability-version-backdrop';
      backdrop.addEventListener('click', (ev) => {
        if (ev.target === backdrop) finish(null);
      });

      const dialog = document.createElement('div');
      dialog.className = 'capability-version-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const head = document.createElement('div');
      head.className = 'capability-version-head';
      const title = document.createElement('div');
      title.className = 'capability-version-title';
      title.textContent = (opts && opts.title) || 'Select cloud version - ' + ((entry && (entry.name || entry.id)) || '');
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'capability-version-close';
      close.setAttribute('aria-label', 'Close');
      close.textContent = 'x';
      close.addEventListener('click', () => finish(null));
      head.appendChild(title);
      head.appendChild(close);

      const list = document.createElement('div');
      list.className = 'capability-version-list';
      for (const item of options) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'capability-version-option' + (item.current ? ' is-current' : '');
        const main = document.createElement('div');
        main.className = 'capability-version-main';
        const semver = document.createElement('div');
        semver.className = 'capability-version-semver';
        semver.textContent = 'v' + (item.semver || 'unknown');
        const date = document.createElement('div');
        date.className = 'capability-version-date';
        date.textContent = item.dateLabel || 'cloud version';
        main.appendChild(semver);
        main.appendChild(date);
        option.appendChild(main);
        if (item.current) {
          const badge = document.createElement('span');
          badge.className = 'capability-version-badge';
          badge.textContent = 'current';
          option.appendChild(badge);
        }
        option.addEventListener('click', () => finish(item.raw));
        list.appendChild(option);
      }

      dialog.appendChild(head);
      dialog.appendChild(list);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      document.addEventListener('keydown', onKeydown);
      const first = list.querySelector('.capability-version-option');
      if (first) first.focus();
    });
  }

  window.ShellCapabilityVersionPicker = {
    pick,
    versionOptions,
  };
})();
