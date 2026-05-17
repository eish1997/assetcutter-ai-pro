/**
 * script.maya 串行队列：Maya Command Port 单连接，POST /v1/compute/jobs 立即返回，后台执行。
 */
let tail: Promise<void> = Promise.resolve();

export function enqueueMayaScriptJob(run: () => Promise<void>): void {
  tail = tail.then(run, run);
}

/** 仅单测：重置队列链 */
export function resetMayaScriptJobQueueForTests(): void {
  tail = Promise.resolve();
}

/** 仅单测：等待当前已入队任务全部结束 */
export function flushMayaScriptJobQueueForTests(): Promise<void> {
  return tail;
}
