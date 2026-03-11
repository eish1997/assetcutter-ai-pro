import React, { useState, useEffect, useRef } from 'react';
import {
  getUserApiKey,
  setUserApiKey,
  getTencentSecretId,
  setTencentSecretId as saveTencentSecretId,
  getTencentSecretKey,
  setTencentSecretKey as saveTencentSecretKey,
  getCapabilityStoreCatalogUrl,
  setCapabilityStoreCatalogUrl,
  DEFAULT_CAPABILITY_STORE_CATALOG_URL,
} from '../services/settingsStore';

const SETTINGS_NAV: { id: string; label: string }[] = [
  { id: 'settings-api', label: 'API' },
  { id: 'settings-general', label: '通用' },
];

const SettingsSection: React.FC = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [apiKey, setApiKey] = useState('');
  const [tencentSecretId, setTencentSecretId] = useState('');
  const [tencentSecretKey, setTencentSecretKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [tencentSaved, setTencentSaved] = useState(false);
  const [capabilityStoreUrl, setCapabilityStoreUrl] = useState('');
  const [generalSaved, setGeneralSaved] = useState(false);

  useEffect(() => {
    setApiKey(getUserApiKey() ?? '');
    setTencentSecretId(getTencentSecretId() ?? '');
    setTencentSecretKey(getTencentSecretKey() ?? '');
    setCapabilityStoreUrl(getCapabilityStoreCatalogUrl() || '');
  }, []);

  const handleSaveApiKey = () => {
    setUserApiKey(apiKey.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveTencent = () => {
    saveTencentSecretId(tencentSecretId.trim() || null);
    saveTencentSecretKey(tencentSecretKey.trim() || null);
    setTencentSaved(true);
    setTimeout(() => setTencentSaved(false), 2000);
  };

  const handleSaveGeneral = () => {
    setCapabilityStoreCatalogUrl(capabilityStoreUrl.trim() || null);
    setGeneralSaved(true);
    setTimeout(() => setGeneralSaved(false), 2000);
  };

  const scrollToSection = (id: string) => {
    const el = contentRef.current?.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex flex-col h-full min-h-[60vh]">
      {/* 标题栏 */}
      <header className="shrink-0 h-14 flex items-center px-4 lg:px-6 border-b border-white/10 bg-black/20">
        <h1 className="text-sm font-black uppercase tracking-widest text-white/90">设置</h1>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 侧边导航：仅做锚点跳转，内容全部展示 */}
        <nav className="shrink-0 w-48 lg:w-56 border-r border-white/10 py-4 px-2">
          <ul className="space-y-0.5">
            {SETTINGS_NAV.map(({ id, label }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className="w-full text-left py-2.5 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors text-gray-400 hover:bg-white/5 hover:text-gray-300 border border-transparent"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* 内容区：所有区块同时展示，导航仅滚动到对应标题 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6 lg:p-10">
          <div className="max-w-2xl space-y-8">
            <section id="settings-api" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">API</h2>
              <div className="space-y-8">
                {/* Gemini */}
                <div className="rounded-xl border border-white/5 p-4">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">Gemini API Key</h3>
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
                </div>

                {/* 混元（腾讯云） */}
                <div className="rounded-xl border border-white/5 p-4">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">混元（腾讯云）</h3>
                  <p className="text-[11px] text-gray-500 mb-4">用于混元生3D。默认建议通过本地代理配合 <code className="bg-white/10 px-1 rounded">.env.local</code> 使用，避免把云密钥长期留在浏览器。这里填写的 SecretId / SecretKey 仅保存在当前标签页会话中，关闭标签页后即失效。</p>
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="password"
                        value={tencentSecretId}
                        onChange={(e) => setTencentSecretId(e.target.value)}
                        onBlur={handleSaveTencent}
                        placeholder="SecretId"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:border-blue-500/50 focus:outline-none"
                        autoComplete="off"
                      />
                      <input
                        type="password"
                        value={tencentSecretKey}
                        onChange={(e) => setTencentSecretKey(e.target.value)}
                        onBlur={handleSaveTencent}
                        placeholder="SecretKey"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:border-blue-500/50 focus:outline-none"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveTencent}
                      className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                    >
                      {tencentSaved ? '已临时保存' : '临时保存'}
                    </button>
                  </div>
                  {tencentSaved && <p className="mt-2 text-[10px] text-green-400/90">已保存到当前标签页会话</p>}
                </div>
              </div>
            </section>

            <section id="settings-general" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-1">能力商店（GitHub 地址）</h2>
                  <p className="text-[11px] text-gray-500 mb-4">远程能力预设目录地址，用于在「能力」页自动拉取并安装能力包。填写 catalog.json 的完整 URL（如 GitHub Pages 或 jsDelivr 链接）。</p>
                  <div className="flex flex-col gap-3">
                    <input
                      type="url"
                      value={capabilityStoreUrl}
                      onChange={(e) => setCapabilityStoreUrl(e.target.value)}
                      onBlur={handleSaveGeneral}
                      placeholder={DEFAULT_CAPABILITY_STORE_CATALOG_URL}
                      className="w-full min-w-0 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:border-blue-500/50 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveGeneral}
                      className="shrink-0 self-start px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                    >
                      {generalSaved ? '已保存' : '保存'}
                    </button>
                  </div>
                  {generalSaved && <p className="mt-2 text-[10px] text-green-400/90">已保存到本机，能力页将使用此地址拉取远程预设</p>}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSection;
