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
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha512Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-512', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const AdminCompanionArtifactsPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.COMPANION_WRITE);
  const canDelete = can(PERMISSIONS.COMPANION_DELETE);
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
  const [blockMapFile, setBlockMapFile] = useState<File | null>(null);
  const [listChannel, setListChannel] = useState<'all' | 'stable' | 'beta'>('all');

  const filteredRows = React.useMemo(() => {
    if (listChannel === 'all') return rows;
    return rows.filter((r) => (r.channel || 'stable') === listChannel);
  }, [rows, listChannel]);

  const PLATFORM_OPTIONS = [
    { value: 'win32', label: 'win32（Windows）' },
    { value: 'darwin', label: 'darwin（macOS）' },
    { value: 'linux', label: 'linux' },
    { value: 'universal', label: 'universal（全平台一条，宿主 ZIP 等）' },
    { value: 'all', label: 'all（同 universal）' },
  ] as const;

  const applySamLocalHostBundlePreset = () => {
    setKind('host_plugin_bundle');
    setPlatform('universal');
    setLabel('SamLocal 扩展包示例');
    setNotes(
      '由仓库根 npm run pack:sam-local-bundle 生成（SamLocal-release/*.zip，须含 extracted/run.json）。详见 SamLocal/host-plugin-bundle/README.md。',
    );
  };

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
    if (blockIfRolePreview(isRolePreview)) return;
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

      let blockMapBytes: number | undefined;
      let blockMapR2Key: string | undefined;
      if (kind === 'desktop_shell' && blockMapFile) {
        const bmBuf = await blockMapFile.arrayBuffer();
        blockMapBytes = bmBuf.byteLength;
        const bmPresign = await presignCompanionDistributionUpload(
          blockMapFile.name,
          blockMapFile.type || 'application/octet-stream',
          `${presign.objectKey}.blockmap`,
        );
        const bmPut = await fetch(bmPresign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': bmPresign.contentType },
          body: new Uint8Array(bmBuf),
        });
        if (!bmPut.ok) {
          throw new Error(`blockmap 上传到 R2 失败 HTTP ${bmPut.status}`);
        }
        blockMapR2Key = bmPresign.objectKey;
      }

      await registerCompanionArtifact({
        kind,
        semver: semver.trim(),
        channel: channel.trim() || 'stable',
        platform: platform.trim().toLowerCase() || 'win32',
        fileName: file.name,
        r2Key: presign.objectKey,
        sha256,
        sha512,
        blockMapBytes,
        blockMapR2Key,
        bytes,
        notes: notes.trim() || undefined,
        label: label.trim() || undefined,
      });
      setFile(null);
      setBlockMapFile(null);
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
    if (blockIfRolePreview(isRolePreview)) return;
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
          上传<strong className="text-gray-400">桌面壳安装包</strong>或<strong className="text-gray-400">扩展包（host_plugin_bundle）</strong>到 R2，并登记元数据。用户在工作区左下角「伴侣」旁可下载桌面壳（需登录）。
          扩展包与网站工作流默认使用的<strong className="text-gray-400">本机引擎</strong>不是同一路径；与{' '}
          <code className="text-[10px] text-gray-400">/v1/capabilities</code> 里列出的核心模块也不同名，请勿混用。
        </p>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">{err}</div>
      ) : null}

      {canWrite ? (
      <div className="rounded-xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-300">登记新版本</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="block text-[10px] text-gray-500">
            类型
            <div className="mt-1">
              <CustomDropdown
                value={kind}
                onChange={(v) => {
                  const nk = v as CompanionArtifactKind;
                  setKind(nk);
                  if (nk === 'host_plugin_bundle') setPlatform('universal');
                  else if (platform === 'universal' || platform === 'all') setPlatform('win32');
                }}
                options={[
                  { value: 'desktop_shell', label: 'desktop_shell（Electron 安装包/便携）' },
                  { value: 'host_plugin_bundle', label: '扩展包 host_plugin_bundle（ZIP，可选）' },
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
          <div className="block text-[10px] text-gray-500">
            平台 platform
            <div className="mt-1">
              <CustomDropdown
                value={platform}
                onChange={(v) => setPlatform(v)}
                options={[...PLATFORM_OPTIONS]}
                triggerClassName="w-full bg-[#0a0a0b] border border-[#2e2e32] rounded-lg px-3 py-2 text-[11px] text-left text-gray-200 flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#121214] transition-colors"
              />
            </div>
          </div>
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
          {kind === 'desktop_shell' ? (
            <label className="block text-[10px] text-gray-500 sm:col-span-2">
              差分 blockmap（可选，与 NSIS 同目录的 <code className="text-gray-500">*.exe.blockmap</code>）
              <input
                type="file"
                accept=".blockmap"
                onChange={(e) => setBlockMapFile(e.target.files?.[0] || null)}
                className="mt-1 w-full text-[11px] text-gray-300 file:mr-2 file:rounded file:border-0 file:bg-[#1d4ed8] file:px-2 file:py-1 file:text-[10px] file:text-white"
              />
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onUpload()}
            className="rounded-lg border border-blue-600 bg-blue-700/80 px-4 py-2 text-[11px] font-bold text-white hover:bg-blue-600 disabled:opacity-45"
          >
            {busy ? '处理中…' : '预签名上传并登记'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={applySamLocalHostBundlePreset}
            className="rounded-lg border border-[#3f3f46] bg-[#1a1a1c] px-3 py-2 text-[11px] font-bold text-violet-200 hover:bg-[#252528] disabled:opacity-45"
          >
            SamLocal 宿主包预设（填表）
          </button>
        </div>
        <p className="text-[10px] text-gray-600 leading-relaxed">
          全平台同一份 ZIP 选 <code className="text-gray-500">universal</code> 即可被各端扩展目录命中；若另有分平台包且时间更新，
          <code className="text-gray-500">latest</code> 会优先当前平台的精确条目。桌面壳 NSIS 建议同时上传{' '}
          <code className="text-gray-500">.blockmap</code> 以启用安装包差分更新（体积更小）。
        </p>
      </div>
      ) : (
        <p className="text-[11px] text-gray-500">当前角色仅可查看已登记版本。</p>
      )}

      <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#2e2e32] bg-[#16161a] flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">已登记</span>
            <div className="flex gap-1">
              {(['all', 'stable', 'beta'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setListChannel(ch)}
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    listChannel === ch
                      ? 'bg-[#2e2e32] text-gray-100'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {ch === 'all' ? '全部' : ch}
                </button>
              ))}
            </div>
          </div>
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
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-[11px] text-gray-500">暂无记录。需已配置 R2。</div>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#2e2e32] text-[9px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2">版本</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">平台</th>
                <th className="px-3 py-2">渠道</th>
                <th className="px-3 py-2">文件</th>
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-b border-[#2e2e32]/80">
                  <td className="px-3 py-2 text-gray-200 font-mono">{r.semver}</td>
                  <td className="px-3 py-2 text-gray-400">{r.kind}</td>
                  <td className="px-3 py-2 text-gray-400">{r.platform}</td>
                  <td className="px-3 py-2 text-gray-400">{r.channel || 'stable'}</td>
                  <td className="px-3 py-2 text-gray-300 truncate max-w-[200px]" title={r.fileName}>
                    {r.fileName}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.publishedAt.slice(0, 19)}</td>
                  <td className="px-3 py-2">
                    {canDelete ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onDelete(r.id)}
                      className="text-red-400 hover:text-red-300 text-[10px]"
                    >
                      删除
                    </button>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
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
