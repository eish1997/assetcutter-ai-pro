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

