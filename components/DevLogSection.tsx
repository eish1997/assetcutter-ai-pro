import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDevLogDay, fetchDevLogIndex } from '../services/devLogClient';
import { downloadDevLogReceiptPng, buildDevLogReceiptText } from '../services/devLogReceiptExport';
import type { DevLogEntry, DevLogIndex } from '../types/devLog';
import { HttpRequestError } from '../services/httpClient';

function shortSha(sha: string) {
  return String(sha || '').slice(0, 7) || '—';
}

function formatPushedAt(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function DevLogSection() {
  const [index, setIndex] = useState<DevLogIndex | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<DevLogEntry[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const loadIndex = useCallback(async () => {
    setLoadingIndex(true);
    setError(null);
    try {
      const data = await fetchDevLogIndex();
      setIndex(data);
      setSelectedDay((prev) => {
        if (prev && data.days.some((d) => d.dayKey === prev)) return prev;
        return data.days[0]?.dayKey ?? null;
      });
      } catch (e) {
      let msg =
        e instanceof HttpRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : '加载失败';
      if (e instanceof HttpRequestError && e.status === 404) {
        msg =
          '开发日志接口不存在（404）。请确认本机 auth-api 已重启且含 /api/admin/dev-log；若 Vite 反代到云端 Render，需先部署含该接口的 auth-api。';
      }
      setError(msg);
      setIndex(null);
    } finally {
      setLoadingIndex(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  useEffect(() => {
    if (!selectedDay) {
      setDayEntries([]);
      return;
    }
    let cancelled = false;
    setLoadingDay(true);
    void fetchDevLogDay(selectedDay)
      .then((res) => {
        if (!cancelled) setDayEntries(res.entries || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setDayEntries([]);
          setError(e instanceof Error ? e.message : '加载当日条目失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDay(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay]);

  const days = useMemo(() => index?.days ?? [], [index]);

  const onExportPng = async () => {
    if (!selectedDay || !dayEntries.length) return;
    setExportBusy(true);
    setError(null);
    try {
      await downloadDevLogReceiptPng(selectedDay, dayEntries);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExportBusy(false);
    }
  };

  const onCopyText = async () => {
    if (!selectedDay || !dayEntries.length) return;
    try {
      await navigator.clipboard.writeText(buildDevLogReceiptText(selectedDay, dayEntries));
    } catch {
      setError('复制失败');
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[13px] font-black uppercase tracking-[0.18em] text-gray-200">开发日志</h1>
          <p className="mt-1 text-[10px] text-gray-500">
            push 后自动总结并上传 R2 · 打开本页自动刷新一次
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadIndex()}
            disabled={loadingIndex}
            className="rounded-md bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-bold text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1] disabled:opacity-40"
          >
            {loadingIndex ? '刷新中…' : '刷新'}
          </button>
          <button
            type="button"
            onClick={() => void onExportPng()}
            disabled={!selectedDay || !dayEntries.length || exportBusy}
            className="rounded-md bg-white px-2.5 py-1.5 text-[10px] font-black text-[#0a0a0c] ring-1 ring-white disabled:opacity-40"
          >
            {exportBusy ? '导出中…' : '导出小票 PNG'}
          </button>
          <button
            type="button"
            onClick={() => void onCopyText()}
            disabled={!selectedDay || !dayEntries.length}
            className="rounded-md bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-bold text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1] disabled:opacity-40"
          >
            复制文本
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg bg-red-950/40 px-3 py-2 text-[10px] text-red-200 ring-1 ring-red-500/30">
          {error}
        </div>
      ) : null}

      {index ? (
        <p className="text-[9px] text-gray-600">
          上次 tip {shortSha(index.lastPushSha)} · 索引更新 {index.updatedAt || '—'}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f12] p-2 ring-1 ring-white/[0.05]">
          <div className="mb-1.5 px-1 text-[9px] font-black uppercase tracking-wide text-gray-500">日期</div>
          {loadingIndex && !days.length ? (
            <p className="px-1 text-[10px] text-gray-600">加载中…</p>
          ) : error && !days.length ? (
            <p className="px-1 text-[10px] text-gray-600">索引未加载，请先解决上方错误后点「刷新」</p>
          ) : !days.length ? (
            <p className="px-1 text-[10px] text-gray-600">
              暂无记录。流程：git push 成功 → 再运行 npm run dev-log:post-push（会上传 R2）
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {days.map((d) => {
                const on = selectedDay === d.dayKey;
                return (
                  <li key={d.dayKey}>
                    <button
                      type="button"
                      onClick={() => setSelectedDay(d.dayKey)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-[10px] font-semibold ring-1 transition-colors ${
                        on
                          ? 'bg-white/[0.16] text-white ring-white/[0.22]'
                          : 'bg-white/[0.04] text-gray-300 ring-white/[0.07] hover:bg-white/[0.08]'
                      }`}
                    >
                      <span className="block tabular-nums">{d.dayKey}</span>
                      <span className="text-[8px] text-gray-500">{(d.entryIds || []).length} 笔</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto">
          {error && !selectedDay ? (
            <p className="text-[10px] text-gray-600">无法展示时间轴</p>
          ) : !selectedDay ? (
            <p className="text-[10px] text-gray-600">选择日期查看时间轴</p>
          ) : loadingDay ? (
            <p className="text-[10px] text-gray-600">加载 {selectedDay}…</p>
          ) : (
            <ol className="relative space-y-4 border-l border-white/10 pl-4">
              {dayEntries.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-white/40 ring-2 ring-[#0a0a0c]" />
                  <article className="rounded-xl border border-white/10 bg-[#0f0f12] p-3 ring-1 ring-white/[0.05]">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <time className="text-[10px] font-bold text-gray-200">{formatPushedAt(e.pushedAt)}</time>
                      <span className="font-mono text-[9px] text-gray-500">
                        {shortSha(e.fromSha)} → {shortSha(e.toSha)}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {(e.summaryBullets || []).map((b) => (
                        <li key={b} className="text-[10px] leading-relaxed text-gray-300">
                          · {b}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[8px] text-gray-600">
                      文件 {e.stats?.filesChanged ?? 0} · +{e.stats?.insertions ?? 0} / −
                      {e.stats?.deletions ?? 0} · 提交 {(e.commits || []).length}
                    </p>
                  </article>
                </li>
              ))}
              {!dayEntries.length ? (
                <li className="text-[10px] text-gray-600">该日暂无条目</li>
              ) : null}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
