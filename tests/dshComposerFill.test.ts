import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { buildFillDshComposerScript } = require('../companion-desktop/dsh-composer-fill.cjs') as {
  buildFillDshComposerScript: (text: string, opts?: { submit?: boolean }) => string;
};

describe('buildFillDshComposerScript', () => {
  it('embeds composer text safely', () => {
    const script = buildFillDshComposerScript('请帮我验证 Unreal Editor 5.3 的连接。');
    expect(script).toContain('请帮我验证 Unreal Editor 5.3 的连接。');
    expect(script).toContain('data-phase="plain"');
    expect(script).toContain('dsh.conversation.chat');
    expect(script).toContain('InputEvent');
    expect(script).toContain('_valueTracker');
    expect(script).toContain('data-input-mirror');
    expect(script).toContain('__reactProps$');
    expect(script).toContain('getOwnPropertyNames');
    expect(script).not.toContain('data-phase="inert"');
  });

  it('can submit after fill when asked', () => {
    const script = buildFillDshComposerScript('/plan 布置这间空房', { submit: true });
    expect(script).toContain('/plan ');
    expect(script).toContain('requestSubmit');
    expect(script).toContain('shouldSubmit = true');
  });

  it('does not succeed until the visible mirror layer has the draft', async () => {
    const filled = '请按这张复现单跑：导出 Maya。';
    const dom = new JSDOM(
      `
      <html>
        <body>
          <div data-composer-card>
            <div data-input-scroll>
              <div data-input-backdrop></div>
              <textarea data-phase="plain"></textarea>
              <div data-input-mirror></div>
            </div>
            <button type="button" disabled>send</button>
          </div>
        </body>
      </html>
      `,
      { runScripts: 'dangerously', url: 'http://127.0.0.1:3080/' },
    );
    const textarea = dom.window.document.querySelector('textarea') as HTMLTextAreaElement;
    const mirror = dom.window.document.querySelector('[data-input-mirror]') as HTMLElement;
    const backdrop = dom.window.document.querySelector('[data-input-backdrop]') as HTMLElement;
    const send = dom.window.document.querySelector('button') as HTMLButtonElement;
    Object.defineProperty(textarea, '__reactProps$test', {
      value: {
        onChange(event: { target: { value: string } }) {
          const next = event.target.value;
          mirror.textContent = `${next}\n`;
          backdrop.textContent = next;
          send.disabled = !next.trim();
        },
      },
    });

    const ok = await dom.window.eval(buildFillDshComposerScript(filled));
    expect(ok).toBe(true);
    expect(mirror.textContent).toContain(filled);
    expect(backdrop.textContent).toContain(filled);
    expect(send.disabled).toBe(false);
  });

  it('keeps retrying while the composer is still inert', async () => {
    const filled = '确认变动格后调用 replay_run。';
    const dom = new JSDOM(
      `
      <html>
        <body>
          <div data-input-scroll>
            <div data-input-backdrop></div>
            <textarea data-phase="inert"></textarea>
            <div data-input-mirror></div>
          </div>
        </body>
      </html>
      `,
      { runScripts: 'dangerously', url: 'http://127.0.0.1:3080/' },
    );
    const script = buildFillDshComposerScript(filled).replace(
      'for (let attempt = 0; attempt < 24; attempt += 1)',
      'for (let attempt = 0; attempt < 1; attempt += 1)',
    );
    const ok = await dom.window.eval(script);
    expect(ok).toBe(false);
    expect(dom.window.document.querySelector('[data-input-mirror]')?.textContent || '').not.toContain(filled);
  });
});
