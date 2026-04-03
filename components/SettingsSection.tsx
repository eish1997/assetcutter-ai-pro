import React, { useState, useEffect, useRef } from 'react';
import { SidebarAccountAvatar } from './SidebarAccountAvatar';
import { useUserUiPrefs } from '../hooks/useUserUiPrefs';
import {
  setUserUiPrefs,
  sanitizeAvatarUrl,
  MAX_AVATAR_DATA_URL_CHARS,
} from '../services/userUiPrefs';
import {
  getUserApiKey,
  setUserApiKey,
  getAiProvider,
  setAiProvider,
  getToapisApiKey,
  setToapisApiKey,
  getToapisBaseUrl,
  setToapisBaseUrl,
  getVectorengineApiKey,
  setVectorengineApiKey,
  getVectorengineBaseUrl,
  setVectorengineBaseUrl,
  type AiProvider,
  getTencentSecretId,
  setTencentSecretId as saveTencentSecretId,
  getTencentSecretKey,
  setTencentSecretKey as saveTencentSecretKey,
} from '../services/settingsStore';
import { isWorkspaceCloudEnabled } from '../services/workspaceCloudSync';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';
import type { AuthUser } from '../services/authClient';

const SETTINGS_NAV: { id: string; label: string }[] = [
  { id: 'settings-user', label: '用户' },
  { id: 'settings-storage', label: '数据与存储' },
  { id: 'settings-api', label: 'API' },
];

const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini（官方 API）' },
  { value: 'toapis', label: 'ToAPIs 网关（OpenAI 兼容 + 异步生图）' },
  { value: 'vectorengine', label: '向量引擎 VectorEngine（Gemini 原生 REST）' },
];

const SettingsSection: React.FC<{
  currentUser?: AuthUser | null;
  authLoading?: boolean;
  onRefreshUser?: () => Promise<void>;
  onLogout?: () => Promise<void>;
}> = ({ currentUser = null, authLoading = false, onRefreshUser, onLogout }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [aiProvider, setAiProviderState] = useState<AiProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [toapisApiKey, setToapisApiKeyState] = useState('');
  const [toapisBaseUrl, setToapisBaseUrlState] = useState('');
  const [vectorengineApiKey, setVectorengineApiKeyState] = useState('');
  const [vectorengineBaseUrl, setVectorengineBaseUrlState] = useState('');
  const [tencentSecretId, setTencentSecretId] = useState('');
  const [tencentSecretKey, setTencentSecretKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [tencentSaved, setTencentSaved] = useState(false);
  const [userActionBusy, setUserActionBusy] = useState<'refresh' | 'logout' | null>(null);
  const [userActionMsg, setUserActionMsg] = useState<string>('');
  const userUiPrefs = useUserUiPrefs();
  const [avatarLinkDraft, setAvatarLinkDraft] = useState('');
  const [prefsUiHint, setPrefsUiHint] = useState('');
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = userUiPrefs.avatarUrl.trim();
    setAvatarLinkDraft(/^https?:\/\//i.test(u) ? u : '');
  }, [userUiPrefs.avatarUrl]);

  useEffect(() => {
    setAiProviderState(getAiProvider());
    setApiKey(getUserApiKey() ?? '');
    setToapisApiKeyState(getToapisApiKey() ?? '');
    setToapisBaseUrlState(getToapisBaseUrl());
    setVectorengineApiKeyState(getVectorengineApiKey() ?? '');
    setVectorengineBaseUrlState(getVectorengineBaseUrl());
    setTencentSecretId(getTencentSecretId() ?? '');
    setTencentSecretKey(getTencentSecretKey() ?? '');
  }, []);

  const handleSaveApiKey = () => {
    setUserApiKey(apiKey.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveToapis = () => {
    setToapisApiKey(toapisApiKey.trim() || null);
    setToapisBaseUrl(toapisBaseUrl.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveVectorengine = () => {
    setVectorengineApiKey(vectorengineApiKey.trim() || null);
    setVectorengineBaseUrl(vectorengineBaseUrl.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAiProviderChange = (value: string) => {
    const v: AiProvider =
      value === 'toapis' ? 'toapis' : value === 'vectorengine' ? 'vectorengine' : 'gemini';
    setAiProviderState(v);
    setAiProvider(v);
  };

  const handleSaveTencent = () => {
    saveTencentSecretId(tencentSecretId.trim() || null);
    saveTencentSecretKey(tencentSecretKey.trim() || null);
    setTencentSaved(true);
    setTimeout(() => setTencentSaved(false), 2000);
  };

  const scrollToSection = (id: string) => {
    const el = contentRef.current?.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleRefreshUser = async () => {
    if (!onRefreshUser || userActionBusy) return;
    setUserActionBusy('refresh');
    setUserActionMsg('');
    try {
      await onRefreshUser();
      setUserActionMsg('用户信息已刷新');
    } catch (e) {
      setUserActionMsg(`刷新失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUserActionBusy(null);
    }
  };

  const handleLogout = async () => {
    if (!onLogout || userActionBusy) return;
    setUserActionBusy('logout');
    setUserActionMsg('');
    try {
      await onLogout();
      setUserActionMsg('已退出登录');
    } catch (e) {
      setUserActionMsg(`退出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUserActionBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[60vh]">
      {/* 标题栏 */}
      <header className="shrink-0 h-14 flex items-center px-4 lg:px-6 border-b border-[#2e2e32] bg-[#121214]">
        <h1 className="text-sm font-black uppercase tracking-widest text-white/90">设置</h1>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 侧边导航：仅做锚点跳转，内容全部展示 */}
        <nav className="shrink-0 w-48 lg:w-56 border-r border-[#2e2e32] py-4 px-2">
          <ul className="space-y-0.5">
            {SETTINGS_NAV.map(({ id, label }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className="w-full text-left py-2.5 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors text-gray-400 hover:bg-[#222228] hover:text-gray-300 border border-transparent"
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
            <section id="settings-user" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">用户</h2>
              <div className="rounded-xl border border-[#252528] p-4 space-y-4">
                {authLoading ? (
                  <p className="text-[10px] text-gray-500">正在加载用户信息…</p>
                ) : currentUser ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[10px]">
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">用户名</p>
                        <p className="text-white mt-1 break-all">{currentUser.username}</p>
                      </div>
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">邮箱</p>
                        <p className="text-white mt-1 break-all">{currentUser.email}</p>
                      </div>
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">用户 ID</p>
                        <p className="text-white mt-1 break-all">{currentUser.id}</p>
                      </div>
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">角色 / 状态</p>
                        <p className="text-white mt-1 break-all">
                          {currentUser.role} / {currentUser.status}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#2e2e32] bg-[#16161a] p-4 space-y-4">
                      <div>
                        <h3 className="text-[10px] font-black uppercase tracking-wider text-blue-400/80">侧栏展示</h3>
                        <p className="text-[9px] text-gray-600 mt-1 leading-relaxed">
                          自定义左侧边栏账户入口的头像与展示名（圆角矩形，与全站按钮风格一致）。修改后会写入本机并随「用户云配置」自动同步到云端（与能力预设等同一份
                          user-config.json）；不会修改服务器上的登录名与密码。
                          {isWorkspaceCloudEnabled()
                            ? ' 本地上传的 data 头像体积较大，不会上传云端；换设备请使用「图片链接」或仅用展示名。'
                            : ' 当前未开启工作区云同步时，侧栏偏好仅保存在本机。'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <SidebarAccountAvatar user={currentUser} prefs={userUiPrefs} />
                        <div className="flex-1 min-w-[12rem] space-y-2">
                          <label className="block text-[9px] text-gray-500 uppercase tracking-wide">展示名（可选）</label>
                          <input
                            type="text"
                            value={userUiPrefs.displayName}
                            onChange={(e) => setUserUiPrefs({ displayName: e.target.value })}
                            placeholder={currentUser.username || '与登录名相同可留空'}
                            maxLength={24}
                            className="w-full px-3 py-2 rounded-xl bg-[#121214] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                          />
                          <p className="text-[9px] text-gray-600">留空时侧栏缩写取自用户名或邮箱。</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] text-gray-500 uppercase tracking-wide">头像图片</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={avatarFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (!f || !f.type.startsWith('image/')) return;
                              if (f.size > 2 * 1024 * 1024) {
                                setPrefsUiHint('请选择小于 2MB 的图片');
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () => {
                                const data = String(reader.result || '');
                                if (data.length > MAX_AVATAR_DATA_URL_CHARS) {
                                  setPrefsUiHint('图片过大，请压缩或换一张');
                                  return;
                                }
                                setUserUiPrefs({ avatarUrl: data });
                                setPrefsUiHint('已更新本地上传头像');
                              };
                              reader.readAsDataURL(f);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => avatarFileInputRef.current?.click()}
                            className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors"
                          >
                            上传图片
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUserUiPrefs({ avatarUrl: '' });
                              setAvatarLinkDraft('');
                              setPrefsUiHint('已恢复默认缩写头像');
                            }}
                            className="px-4 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-400 hover:bg-[#222228] transition-colors"
                          >
                            清除自定义头像
                          </button>
                        </div>
                        {userUiPrefs.avatarUrl.startsWith('data:') ? (
                          <p className="text-[9px] text-gray-500">当前使用本地上传的图片。</p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <label className="block text-[9px] text-gray-500 uppercase tracking-wide">或图片链接（https 直链）</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="url"
                            value={avatarLinkDraft}
                            onChange={(e) => setAvatarLinkDraft(e.target.value)}
                            placeholder="https://example.com/avatar.png"
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#121214] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const s = sanitizeAvatarUrl(avatarLinkDraft);
                              if (!avatarLinkDraft.trim()) {
                                setPrefsUiHint('请先填写图片 URL');
                                return;
                              }
                              if (!s) {
                                setPrefsUiHint('无效链接（需 http(s) 图片地址，勿填 localhost）');
                                return;
                              }
                              setUserUiPrefs({ avatarUrl: s });
                              setPrefsUiHint('已应用链接头像');
                            }}
                            className="shrink-0 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase text-white transition-colors"
                          >
                            应用链接
                          </button>
                        </div>
                      </div>
                      {prefsUiHint ? <p className="text-[9px] text-gray-500">{prefsUiHint}</p> : null}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void handleRefreshUser()}
                        disabled={userActionBusy !== null}
                        className="px-5 py-3 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-white text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-60"
                      >
                        {userActionBusy === 'refresh' ? '刷新中…' : '刷新信息'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        disabled={userActionBusy !== null}
                        className="px-5 py-3 rounded-xl bg-red-600/80 hover:bg-red-500 text-white text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-60"
                      >
                        {userActionBusy === 'logout' ? '退出中…' : '退出登录'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-500">当前未登录。</p>
                )}
                {userActionMsg ? (
                  <p className="text-[10px] text-gray-400">{userActionMsg}</p>
                ) : null}
              </div>
            </section>

            <section id="settings-storage" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">数据与存储</h2>
              <div className="rounded-xl border border-[#252528] p-4 space-y-3 text-[10px] text-gray-400 leading-relaxed">
                <p className="text-gray-300 font-semibold">本机浏览器（localStorage）</p>
                <ul className="list-disc list-inside space-y-1.5 text-gray-500">
                  <li>工作区项目画布、对话会话与临时库、仓库条目、能力预设等会占用<strong className="text-gray-400">当前站点在本机的存储配额</strong>（各浏览器通常共约数 MB～十余 MB，与设备有关）。</li>
                  <li>配额不足时可能无法保存；可清理本站数据、减少大图与项目数量，或登录后使用云端工作区同步。</li>
                </ul>
                <p className="text-gray-300 font-semibold pt-2">云端（登录且开启工作区云同步）</p>
                <ul className="list-disc list-inside space-y-1.5 text-gray-500">
                  <li>流程图片等可走对象存储，<strong className="text-gray-400">工作区云空间</strong>有 per-user 配额（默认约 200MB，管理员可调）；与工作流 JSON 的本地缓存是两套概念。</li>
                  <li>大图以独立对象上传，不在单次 JSON 请求里塞满 base64，便于跨设备与省本地配额。</li>
                </ul>
              </div>
            </section>

            <section id="settings-api" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">API</h2>
              <div className="space-y-8">
                {/* AI 调用源 */}
                <div className="rounded-xl border border-[#252528] p-4 space-y-4">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">AI 调用源</h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className="text-[10px] text-gray-500 shrink-0">供应商</span>
                    <CustomDropdown
                      options={AI_PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      value={aiProvider}
                      onChange={handleAiProviderChange}
                      triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} flex-1 min-w-[12rem]`}
                    />
                  </div>

                  {aiProvider === 'gemini' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Gemini API Key</h4>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          onBlur={handleSaveApiKey}
                          placeholder="Google AI Studio / Gemini API Key"
                          className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
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
                    </>
                  ) : aiProvider === 'toapis' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">ToAPIs</h4>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="password"
                          value={toapisApiKey}
                          onChange={(e) => setToapisApiKeyState(e.target.value)}
                          onBlur={handleSaveToapis}
                          placeholder="ToAPIs API Key"
                          className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={handleSaveToapis}
                          className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                        >
                          {saved ? '已保存' : '保存'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">VectorEngine</h4>
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <input
                            type="password"
                            value={vectorengineApiKey}
                            onChange={(e) => setVectorengineApiKeyState(e.target.value)}
                            onBlur={handleSaveVectorengine}
                            placeholder="VectorEngine API Key"
                            className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={handleSaveVectorengine}
                            className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                          >
                            {saved ? '已保存' : '保存'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {saved && <p className="mt-2 text-[10px] text-green-400/90">已保存到本机</p>}
                </div>

                {/* 混元（腾讯云） */}
                <div className="rounded-xl border border-[#252528] p-4">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">混元（腾讯云）</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="password"
                        value={tencentSecretId}
                        onChange={(e) => setTencentSecretId(e.target.value)}
                        onBlur={handleSaveTencent}
                        placeholder="SecretId"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                        autoComplete="off"
                      />
                      <input
                        type="password"
                        value={tencentSecretKey}
                        onChange={(e) => setTencentSecretKey(e.target.value)}
                        onBlur={handleSaveTencent}
                        placeholder="SecretKey"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
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

          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSection;
