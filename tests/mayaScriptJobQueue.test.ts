import { afterEach, describe, expect, it } from 'vitest';
import {
  enqueueMayaScriptJob,
  flushMayaScriptJobQueueForTests,
  resetMayaScriptJobQueueForTests,
} from '../local-companion/src/scriptRun/mayaScriptJobQueue.ts';

describe('mayaScriptJobQueue', () => {
  afterEach(async () => {
    await flushMayaScriptJobQueueForTests();
    resetMayaScriptJobQueueForTests();
  });

  it('runs jobs serially in submission order', async () => {
    const order: number[] = [];
    const mk =
      (n: number, ms: number) =>
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push(n);
            resolve();
          }, ms);
        });

    enqueueMayaScriptJob(mk(1, 40));
    enqueueMayaScriptJob(mk(2, 5));
    await flushMayaScriptJobQueueForTests();
    expect(order).toEqual([1, 2]);
  });
});
