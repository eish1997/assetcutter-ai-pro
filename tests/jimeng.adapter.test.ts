import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JIMENG_DEFAULT_MAX_WAIT_IMAGE_MS,
  JIMENG_DEFAULT_POLL_INTERVAL_MS,
  submitAndPollJimengImage,
  submitAndPollJimengVideo,
} from "../services/jimeng/adapter";
import { JimengPollTimeoutError } from "../services/jimeng/errors";

type MockResponse = {
  url: string;
  method: string;
  body?: unknown;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createJimengFetchMock(handlers: {
  onSubmit?: () => Response;
  onPoll?: (callIndex: number) => Response;
}): { fetchImpl: typeof fetch; calls: MockResponse[] } {
  const calls: MockResponse[] = [];
  let pollIndex = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    if (method === "POST" && url.includes("/api/jimeng/tasks")) {
      return handlers.onSubmit?.() ?? jsonResponse(200, { taskId: "task-1" });
    }
    if (method === "GET" && url.includes("/api/jimeng/tasks/")) {
      const res = handlers.onPoll?.(pollIndex);
      pollIndex += 1;
      return res ?? jsonResponse(200, { status: "pending" });
    }
    return jsonResponse(404, { error: "not found" });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

describe("jimeng adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("submit → pending → done returns images", async () => {
    const { fetchImpl } = createJimengFetchMock({
      onPoll: (i) =>
        i === 0
          ? jsonResponse(200, { status: "running", progress: 10 })
          : jsonResponse(200, {
              status: "done",
              images: ["https://cdn.example/a.png"],
            }),
    });

    const promise = submitAndPollJimengImage(
      { registryId: "jimeng-image-t2i-v40", prompt: "cat" },
      {
        fetchImpl,
        pollIntervalMs: JIMENG_DEFAULT_POLL_INTERVAL_MS,
        maxWaitMs: JIMENG_DEFAULT_MAX_WAIT_IMAGE_MS,
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.taskId).toBe("task-1");
    expect(result.images).toEqual(["https://cdn.example/a.png"]);
  });

  it("submit → done returns videoUrl for video SKU", async () => {
    const { fetchImpl } = createJimengFetchMock({
      onPoll: () =>
        jsonResponse(200, {
          status: "done",
          videoUrl: "https://cdn.example/v.mp4",
        }),
    });

    const promise = submitAndPollJimengVideo(
      { registryId: "jimeng-video-ti2v-v30-pro", prompt: "wave" },
      { fetchImpl, pollIntervalMs: 100, maxWaitMs: 60_000 }
    );

    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result.videoUrl).toBe("https://cdn.example/v.mp4");
  });

  it("throws JimengPollTimeoutError when maxWaitMs exceeded", async () => {
    const { fetchImpl } = createJimengFetchMock({
      onPoll: () => jsonResponse(200, { status: "pending" }),
    });

    const promise = submitAndPollJimengImage(
      { registryId: "jimeng-image-t2i-v40", prompt: "slow" },
      { fetchImpl, pollIntervalMs: 1000, maxWaitMs: 2500 }
    );

    const expectation = expect(promise).rejects.toBeInstanceOf(JimengPollTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
  });

  it("throws JimengUpstreamRejectedError on failed poll status", async () => {
    const { fetchImpl } = createJimengFetchMock({
      onPoll: () =>
        jsonResponse(200, { status: "failed", code: 50411, message: "req_key not enabled" }),
    });

    const promise = submitAndPollJimengImage(
      { registryId: "jimeng-image-t2i-v40", prompt: "x" },
      { fetchImpl, pollIntervalMs: 100, maxWaitMs: 10_000 }
    );
    const expectation = expect(promise).rejects.toMatchObject({
      upstreamCode: 50411,
      name: "JimengUpstreamRejectedError",
    });

    await vi.advanceTimersByTimeAsync(200);
    await expectation;
  });

  it("aborts poll loop when AbortSignal fires", async () => {
    const controller = new AbortController();
    const { fetchImpl } = createJimengFetchMock({
      onPoll: () => jsonResponse(200, { status: "pending" }),
    });

    const promise = submitAndPollJimengImage(
      { registryId: "jimeng-image-t2i-v40", prompt: "abort" },
      { fetchImpl, pollIntervalMs: 500, maxWaitMs: 60_000, signal: controller.signal }
    );

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
