import type { BulkImageJob, BulkImageHealth } from '../types-admin.js';

const API_BASE = (import.meta.env.VITE_BULK_IMAGE_API || '').replace(/\/+$/, '');

function ensureApiBase() {
  if (!API_BASE) throw new Error('未配置 VITE_BULK_IMAGE_API，无法使用管理后台接口');
}

export async function fetchHealth(): Promise<BulkImageHealth> {
  ensureApiBase();
  const res = await fetch(`${API_BASE}/healthz`);
  if (!res.ok) throw new Error(`获取健康状态失败：${res.status}`);
  return (await res.json()) as BulkImageHealth;
}

export async function fetchJobs(): Promise<BulkImageJob[]> {
  ensureApiBase();
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) throw new Error(`获取任务列表失败：${res.status}`);
  return (await res.json()) as BulkImageJob[];
}

export async function fetchJob(id: string): Promise<BulkImageJob> {
  ensureApiBase();
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`获取任务详情失败：${res.status}`);
  return (await res.json()) as BulkImageJob;
}

export async function cancelJobById(id: string): Promise<BulkImageJob> {
  ensureApiBase();
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`取消任务失败：${res.status}`);
  return (await res.json()) as BulkImageJob;
}

