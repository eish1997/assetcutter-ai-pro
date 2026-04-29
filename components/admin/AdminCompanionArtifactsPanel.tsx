import React, { useCallback, useEffect, useState } from 'react';
import { CustomDropdown } from '../ui/CustomDropdown';
import {
  deleteAdminCompanionArtifact,
  fetchAdminCompanionArtifacts,
  presignCompanionDistributionUpload,
  registerCompanionArtifact,
  type CompanionArtifactKind,
  type CompanionArtifactRecord,
} from '../../services/companionArtifactsClient';
import { HttpRequestError } from '../../services/httpClient';

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha512Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-512', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const AdminCompanionArtifactsPanel: React.FC = () => {
  const [rows, setRows] = useState<CompanionArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<CompanionArtifactKind>('desktop_shell');
  const [semver, setSemver] = useState('');
  const [platform, setPlatform] = useState('win32');
  const [channel, setChannel] = useState('stable');
  const [notes, setNotes] = useState('');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchAdminCompanionArtifacts();
      setRows(r.artifacts || []);
    } catch (e) {
      setErr(e instanceof HttpRequestError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onUpload = async () => {
    if (!file) {
      setErr('请选择文件');
      return;
    }
    if (!semver.trim()) {
      setErr('请填写版本号 semver');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const buf = await file.arrayBuffer();
      const [sha256, sha512] = await Promise.all([sha256Hex(buf), sha512Hex(buf)]);
      const bytes = buf.byteLength;
      const presign = await presignCompanionDistributionUpload(file.name, file.type || 'application/octet-stream');
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': presign.contentType },
        body: new Uint8Array(buf),
      });
      if (!put.ok) {
        throw new Error(`上传到 R2 失败 HTTP ${put.status}`);
      }
      await registerCompanionArtifact({
        kind,
        semver: semver.trim(),
        channel: channel.trim() || 'stable',
        platform: platform.trim() || 'win32',
        fileName: file.name,
        r2Key: presign.objectKey,
        sha256,
        sha512,
        bytes,
        notes: notes.trim() || undefined,
        label: label.trim() || undefined,
      });
      setFile(null);
      setSemver('');
      setNotes('');
      setLabel('');
      await reload();
    } catch (e) {
      setErr(e instanceof HttpRequestError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('确定删除该条发行记录？将同时尝试删除 R2 上对应对象；若 R2 删除失败则整条操作回滚。')) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteAdminCompanionArtifact(id);
      await reload();
    } catch (e) {
      setErr(e instanceof HttpRequestError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">本地伴侣发行</h2>
        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
          上传<strong className="text-gray-400">桌面壳安装包</strong>或<strong className="text-gray-400">宿主插件包</strong>到 R2，并登记元数据。用户在工作区左下角「伴侣」旁可下载（需登录）。
          与 <code className="text-[10px] text-gray-400">/v1/capabilities</code> 运行时插件是不同概念，勿混名。
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">{err}</div>
      ) : null}

      <div className="rounded-xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-300">登记新版本</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="block text-[10px] text-gray-500">
            类型
            <div className="mt-1">
              <CustomDropdown
                value={kind}
                onChange={(v) => setKind(v as CompanionArtifactKind)}
                options={[
                  { value: 'desktop_shell', label: 'desktop_shell（Electron 安装包/便携）' },
                  { value: 'host_plugin_bundle', label: 'host_plugin_bundle（宿主可热更插件包）' },
                ]}
                triggerClassName="w-full bg-[#0a0a0b] border border-[#2e2e32] rounded-lg px-3 py-2 text-[11px] text-left text-gray-200 flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#121214] transition-colors"
              />
            </div>
          </div>
          <label className="block text-[10px] text-gray-500">
            版本 semver
            <input
              value={semver}
              onChange={(e) => setSemver(e.target.value)}
              placeholder="0.2.0"
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
          <label className="block text-[10px] text-gray-500">
            平台 platform
            <input
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="win32"
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
          <label className="block text-[10px] text-gray-500">
            渠道 channel
            <input
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="stable"
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
          <label className="block text-[10px] text-gray-500 sm:col-span-2">
            展示标签（可选）
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Windows x64 安装版"
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
          <label className="block text-[10px] text-gray-500 sm:col-span-2">
            说明 notes（可选）
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0b] px-2 py-2 text-[11px] text-gray-200"
            />
          </label>
          <label className="block text-[10px] text-gray-500 sm:col-span-2">
            文件
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 w-full text-[11px] text-gray-300 file:mr-2 file:rounded file:border-0 file:bg-[#1d4ed8] file:px-2 file:py-1 file:text-[10px] file:text-white"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onUpload()}
          className="rounded-lg border border-blue-600 bg-blue-700/80 px-4 py-2 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-45"
        >
          {busy ? '处理中…' : '预签名上传并登记'}
        </button>
      </div>

      <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2e2e32] bg-[#16161a] flex justify-between items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">已登记</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="text-[10px] text-blue-400 hover:text-blue-300"
          >
            刷新
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-[11px] text-gray-500">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-[11px] text-gray-500">暂无记录。需已配置 R2。</div>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#2e2e32] text-[9px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2">版本</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">平台</th>
                <th className="px-3 py-2">文件</th>
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#2e2e32]/80">
                  <td className="px-3 py-2 text-gray-200 font-mono">{r.semver}</td>
                  <td className="px-3 py-2 text-gray-400">{r.kind}</td>
                  <td className="px-3 py-2 text-gray-400">{r.platform}</td>
                  <td className="px-3 py-2 text-gray-300 truncate max-w-[200px]" title={r.fileName}>
                    {r.fileName}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.publishedAt.slice(0, 19)}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onDelete(r.id)}
                      className="text-red-400 hover:text-red-300 text-[10px]"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AdminCompanionArtifactsPanel;
