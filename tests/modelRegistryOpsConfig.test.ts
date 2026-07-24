import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_MODEL_OPS_CONFIG,
  _refreshModelOpsConfigAtUrlForTests,
  _resetModelOpsRemoteStateForTests,
  _setModelOpsConfigForTests,
  getModelOpsConfigSync,
} from "../services/modelRegistry/opsConfig";

function jsonRes(
  data: unknown,
  init?: { etag?: string; lastModified?: string; status?: number }
): Response {
  const headers = new Headers();
  if (init?.etag) headers.set("ETag", init.etag);
  if (init?.lastModified) headers.set("Last-Modified", init.lastModified);
  return new Response(JSON.stringify(data), { status: init?.status ?? 200, headers });
}

describe("modelRegistry opsConfig remote fetch", () => {
  const testUrl = "https://cdn.example/model-ops.json";

  beforeEach(() => {
    _resetModelOpsRemoteStateForTests();
    _setModelOpsConfigForTests({ ...DEFAULT_MODEL_OPS_CONFIG });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends If-None-Match on second fetch when server returned ETag", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes(
        {
          version: 9,
          imageRegistryAllowlist: ["gemini-2.5-flash-image"],
          imageModelPreference: ["gemini-2.5-flash-image"],
        },
        { etag: '"ops-v1"' }
      )
    );
    await _refreshModelOpsConfigAtUrlForTests(testUrl);
    expect(getModelOpsConfigSync().version).toBe(9);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    const h = second.headers as Headers;
    expect(h.get("If-None-Match")).toBe('"ops-v1"');
    expect(getModelOpsConfigSync().version).toBe(9);
  });

  it("uses If-Modified-Since when no ETag but Last-Modified present", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const lm = "Wed, 21 Oct 2015 07:28:00 GMT";

    fetchMock.mockResolvedValueOnce(
      jsonRes({ version: 1, imageRegistryAllowlist: null }, { lastModified: lm })
    );
    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect((second.headers as Headers).get("If-Modified-Since")).toBe(lm);
  });

  it("clears If-None-Match after 200 without ETag", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(jsonRes({ version: 1, imageRegistryAllowlist: null }, { etag: '"a"' }));
    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    fetchMock.mockResolvedValueOnce(jsonRes({ version: 2, imageRegistryAllowlist: null }, {}));
    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    fetchMock.mockResolvedValueOnce(jsonRes({ version: 2, imageRegistryAllowlist: null }, {}));
    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    const thirdInit = fetchMock.mock.calls[2][1] as RequestInit | undefined;
    if (thirdInit?.headers instanceof Headers) {
      expect(thirdInit.headers.get("If-None-Match")).toBeNull();
    } else {
      expect(thirdInit?.headers).toBeUndefined();
    }
  });

  it("normalizes published canonical model allowlist from remote JSON", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes({
        version: 3,
        publishedCanonicalModelAllowlist: [
          "gpt-4o-mini",
          "unknown-model",
          "gpt-4o-mini",
          "gemini-2.5-flash-image",
        ],
      })
    );

    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(getModelOpsConfigSync().publishedCanonicalModelAllowlist).toEqual([
      "gpt-4o-mini",
      "gemini-2.5-flash-image",
    ]);
  });

  it("accepts auth-api wrapped model ops config responses", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes({
        ok: true,
        config: {
          version: 5,
          publishedCanonicalModelAllowlist: ["gpt-4o-mini"],
        },
      })
    );

    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(getModelOpsConfigSync().version).toBe(5);
    expect(getModelOpsConfigSync().publishedCanonicalModelAllowlist).toEqual(["gpt-4o-mini"]);
  });

  it("keeps valid fallbackPolicy values in binding overrides", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes({
        version: 6,
        bindingOverrides: [
          {
            bindingId: "gpt-image-2:toapis-openai:image",
            priority: 4,
            fallbackPolicy: "quality_first",
            fallbackMaxAttempts: 2,
          },
          {
            bindingId: "gpt-image-2:tinysnow-openai:image",
            fallbackPolicy: "not-a-policy",
          },
        ],
      })
    );

    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(getModelOpsConfigSync().bindingOverrides).toEqual([
      {
        bindingId: "gpt-image-2:toapis-openai:image",
        priority: 4,
        fallbackPolicy: "quality_first",
        fallbackMaxAttempts: 2,
      },
      {
        bindingId: "gpt-image-2:tinysnow-openai:image",
      },
    ]);
  });

  it("keeps valid endpoint mapping rows", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes({
        version: 7,
        endpointMappings: [
          {
            routeId: "302ai-video-manual:302ai:video",
            method: "post",
            requestPath: "/submit",
            pollPath: "/tasks/{id}",
            statusPath: "data.status",
            artifactPath: "data.video.url",
            taskIdPath: "data.taskId",
            errorPath: "error.message",
            statusValuePath: "data.status",
            artifactUrlPath: "data.video.url",
            upstreamOverride: "kling-video-v1",
            priority: 25,
          },
          {
            routeId: "302ai-model3d-manual:302ai:model3d",
            requestPath: "relative-path-is-ignored",
          },
        ],
      })
    );

    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(getModelOpsConfigSync().endpointMappings).toEqual([
      {
        routeId: "302ai-video-manual:302ai:video",
        method: "POST",
        requestPath: "/submit",
        pollPath: "/tasks/{id}",
        statusPath: "data.status",
        artifactPath: "data.video.url",
        taskIdPath: "data.taskId",
        errorPath: "error.message",
        statusValuePath: "data.status",
        artifactUrlPath: "data.video.url",
        upstreamOverride: "kling-video-v1",
        priority: 25,
      },
      {
        routeId: "302ai-model3d-manual:302ai:model3d",
      },
    ]);
  });

  it("keeps valid provider base URL overrides", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes({
        version: 8,
        providerOverrides: [
          {
            providerId: "302ai",
            baseUrl: "https://proxy.example/302ai/v1/",
            requestTimeoutMs: 45500,
          },
          {
            providerId: "aihubmix",
            baseUrl: "ftp://invalid.example/v1",
            requestTimeoutMs: -1,
          },
        ],
      })
    );

    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(getModelOpsConfigSync().providerOverrides).toEqual([
      {
        providerId: "302ai",
        baseUrl: "https://proxy.example/302ai/v1",
        requestTimeoutMs: 45500,
      },
      {
        providerId: "aihubmix",
      },
    ]);
  });

  it("ignores published canonical allowlist when every id is unknown", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      jsonRes({
        version: 4,
        publishedCanonicalModelAllowlist: ["unknown-a", "unknown-b"],
      })
    );

    await _refreshModelOpsConfigAtUrlForTests(testUrl);

    expect(getModelOpsConfigSync().publishedCanonicalModelAllowlist).toBeNull();
  });
});
