import React, { useState, useRef, useEffect } from 'react';
import { getSiteAssistantResponseStream } from '../services/geminiService';
import type { AppTask } from '../types';
import AppIcon from './ui/AppIcon';

const SiteAssistant: React.FC<{
  tasks?: AppTask[];
  onRemoveTask?: (id: string) => void;
}> = ({ tasks = [], onRemoveTask }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) inputRef.current?.focus();
  }, [open, messages.length]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, { role: 'user', text }, { role: 'model', text: '' }]);
    setLoading(true);
    try {
      await getSiteAssistantResponseStream(
        text,
        history,
        (fullText) => {
          setMessages((prev) => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === 'model') {
              next[next.length - 1] = { role: 'model', text: fullText };
            }
            return next;
          });
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => (prev.length > 0 && prev[prev.length - 1].role === 'model' && prev[prev.length - 1].text === '' ? prev.slice(0, -1) : prev));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* 悬浮按钮：网站助手 */}
      <div className="fixed bottom-6 right-6 z-[1999] flex items-center justify-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-14 h-14 rounded-full glass border border-[#343438] shadow-lg flex items-center justify-center text-2xl hover:border-[#3b6fb8] hover:bg-[#1a3354] transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          title="网站助手"
          aria-label="打开网站助手"
        >
          <AppIcon name="chat" className="w-6 h-6" />
        </button>
      </div>

      {/* 对话面板 */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-[1998] w-[min(360px,calc(100vw-3rem))] max-h-[min(70vh,520px)] flex flex-col glass rounded-2xl border border-[#343438] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
          role="dialog"
          aria-label="网站助手"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2e2e32] bg-[#141416] shrink-0">
            <span className="text-[11px] font-black uppercase tracking-wider text-white">网站助手</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#2e2e36] transition-colors"
              aria-label="关闭"
            >
              <AppIcon name="close" className="w-4 h-4" />
            </button>
          </div>
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[320px] no-scrollbar"
          >
            {messages.length === 0 && !loading && (
              <p className="text-[11px] text-gray-500 text-center py-6">
                遇到使用问题或其它疑问可直接提问，我会用当前产品能力帮你解答。
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#264670] border border-[#4b6a9e] text-white'
                      : 'bg-[#1c1c22] border border-[#2e2e32] text-gray-200'
                  }`}
                >
                  <span className="whitespace-pre-wrap break-words">
                    {m.text || (loading && i === messages.length - 1 ? (
                      <span className="inline-flex items-center gap-2 text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        正在回复…
                      </span>
                    ) : null)}
                  </span>
                  {loading && i === messages.length - 1 && m.role === 'model' && m.text.length > 0 && (
                    <span className="inline-block w-2 h-3.5 ml-0.5 bg-blue-400 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            ))}
            {error && (
              <p className="text-[10px] text-red-400 px-2">{error}</p>
            )}
          </div>
          <div className="p-3 border-t border-[#2e2e32] bg-[#121214] shrink-0">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入问题…"
                rows={2}
                className="flex-1 min-h-[44px] max-h-[80px] resize-none rounded-xl bg-[#1c1c22] border border-[#2e2e32] px-3 py-2 text-[11px] text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-[#3b82f6]"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="shrink-0 self-end px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-black uppercase text-white transition-colors"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SiteAssistant;
