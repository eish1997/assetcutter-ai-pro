import React from 'react';
import { resetLazyImagePreviewViewer } from './registry';

type Props = {
  children: React.ReactNode;
  /** registry mode key, e.g. image.equirect — cleared on retry */
  mode?: string;
  label?: string;
};

type State = { error: Error | null; retryKey: number };

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  try {
    return new Error(typeof error === 'string' ? error : String(error));
  } catch {
    return new Error('预览模块加载失败');
  }
}

function isChunkLoadError(err: Error): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    err.message
  );
}

/**
 * Isolates lazy preview Viewer failures so a missing hashed chunk does not
 * tear down the whole WorkflowErrorBoundary.
 */
export default class PreviewViewerErrorBoundary extends React.Component<
  Props,
  State
> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: normalizeError(error) };
  }

  componentDidCatch(error: unknown) {
    try {
      console.error('[预览 Viewer]', error);
    } catch {
      /* ignore */
    }
  }

  handleRetry = () => {
    if (this.props.mode) resetLazyImagePreviewViewer(this.props.mode);
    else resetLazyImagePreviewViewer();
    this.setState((s) => ({ error: null, retryKey: s.retryKey + 1 }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      const chunk = isChunkLoadError(this.state.error);
      const title = this.props.label || '预览模块';
      return (
        <div className="absolute inset-0 z-[6] flex items-center justify-center bg-black/70 p-6">
          <div className="max-w-md rounded-2xl border border-white/10 bg-[#141416] p-5 text-center text-gray-200 shadow-xl">
            <p className="text-[11px] font-black uppercase tracking-wide text-amber-300/90">
              {title}加载失败
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
              {chunk
                ? '线上资源可能已更新，或该预览脚本暂时不可用。可重试加载，或刷新页面拉取最新版本。'
                : this.state.error.message}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-white/15"
              >
                重试
              </button>
              {chunk ? (
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-amber-100 hover:bg-amber-500/25"
                >
                  刷新页面
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
