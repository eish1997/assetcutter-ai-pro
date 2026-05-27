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
});
