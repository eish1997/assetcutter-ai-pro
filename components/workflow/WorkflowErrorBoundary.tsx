import React from 'react';

function workflowBoundaryNormalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  try {
    return new Error(typeof error === 'string' ? error : String(error));
  } catch {
    return new Error('未知错误（无法序列化）');
  }
}

type Props = {
  children: React.ReactNode;
  /** 懒加载失败后重试：重建 lazy 实例并清掉 boundary 错误态 */
  onRetry?: () => void;
};

export default class WorkflowErrorBoundary extends React.Component<
  Props,
  { error: Error | null }
> {
  declare props: Readonly<Props>;
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: workflowBoundaryNormalizeError(error) };
  }

  componentDidCatch(error: unknown) {
    try {
      console.error('[工作流]', error);
    } catch {
      console.error('[工作流] 子树抛错（控制台无法序列化该错误对象）');
    }
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      const fullText = `工作流报错\n\n${err.message}\n\n${err.stack ?? ''}`;
      return (
        <div className="rounded-2xl border border-[#f87171] bg-[#3f1518] p-6 text-red-200 min-h-[200px]">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-[10px] font-black uppercase text-red-400">工作流内报错</h3>
            <div className="flex items-center gap-2">
              {this.props.onRetry ? (
                <button
                  type="button"
                  onClick={() => {
                    this.props.onRetry?.();
                    this.setState({ error: null });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#4a1c1c] border border-[#f87171] text-[9px] font-black uppercase text-red-300 hover:bg-[#5a2222] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 transition-colors duration-200"
                >
                  重试加载
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(fullText);
                }}
                className="px-3 py-1.5 rounded-lg bg-[#4a1c1c] border border-[#f87171] text-[9px] font-black uppercase text-red-300 hover:bg-[#5a2222] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 transition-colors duration-200"
              >
                复制报错
              </button>
            </div>
          </div>
          <pre className="text-[9px] overflow-auto max-h-[40vh] whitespace-pre-wrap break-words bg-[#141416] p-3 rounded-lg border border-[#b85a5a]">
            {err.message}
          </pre>
          {err.stack && (
            <details className="mt-3">
              <summary className="text-[8px] font-black uppercase text-gray-500 cursor-pointer hover:text-gray-400">堆栈</summary>
              <pre className="text-[8px] text-gray-500 mt-1 overflow-auto max-h-[30vh] whitespace-pre-wrap break-words bg-[#141416] p-3 rounded-lg">
                {err.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
