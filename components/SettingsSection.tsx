import React, { useState, useEffect } from 'react';
import { getUserApiKey, setUserApiKey } from '../services/settingsStore';

type SettingsTabId = 'api';

const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'api', label: 'API' },
  // 后续可加：{ id: 'general', label: '通用' }, { id: 'appearance', label: '外观' } 等
];

const SettingsSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('api');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiKey(getUserApiKey() ?? '');
  }, []);

  const handleSaveApiKey = () => {
    setUserApiKey(apiKey.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col h-full min-h-[60vh]">
      {/* 标题栏 */}
      <header className="shrink-0 h-14 flex items-center px-4 lg:px-6 border-b border-white/10 bg-black/20">
        <h1 className="text-sm font-black uppercase tracking-widest text-white/90">设置</h1>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 设置侧边导航 */}
        <nav className="shrink-0 w-48 lg:w-56 border-r border-white/10 py-4 px-2">
          <ul className="space-y-0.5">
            {SETTINGS_TABS.map(({ id, label }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`w-full text-left py-2.5 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    activeTab === id
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-10">
          <div className="max-w-2xl">
            {activeTab === 'api' && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-1">API 密钥</h2>
                <p className="text-[11px] text-gray-500 mb-4">用于对话、提取花纹、生成贴图、网站助手等 AI 功能。密钥仅保存在本机，不会上传。</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={handleSaveApiKey}
                    placeholder="输入 Gemini API Key"
                    className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:border-blue-500/50 focus:outline-none"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={handleSaveApiKey}
                    className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                  >
                    {saved ? '已保存' : '保存'}
                  </button>
                </div>
                {saved && <p className="mt-2 text-[10px] text-green-400/90">已保存到本机</p>}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSection;
