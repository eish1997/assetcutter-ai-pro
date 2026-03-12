export type BulkImageJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled';

export interface BulkImageJob {
  id: string;
  instruction: string;
  totalImages: number;
  status: BulkImageJobStatus;
  results: string[];
  createdAt: number;
  updatedAt: number;
  errorSummary?: string;
  imageBase64?: string | null;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
}

export interface BulkImageHealth {
  ok: boolean;
  rpdToday: number;
  rpdLimit: number;
  jobsTotal: number;
  jobsPendingOrRunning: number;
  inFlight: number;
  queueLength: number;
}

export const BULK_STATUS_LABELS: Record<BulkImageJobStatus, string> = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  partial: '部分完成',
  cancelled: '已取消',
};

export const BULK_STATUS_BADGE_CLASSNAMES: Record<BulkImageJobStatus, string> = {
  pending: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  running: 'border-blue-400/60 bg-blue-500/20 text-blue-100',
  completed: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100',
  failed: 'border-red-500/60 bg-red-600/20 text-red-100',
  partial: 'border-amber-400/60 bg-amber-500/15 text-amber-100',
  cancelled: 'border-gray-500/40 bg-gray-600/10 text-gray-300',
};


