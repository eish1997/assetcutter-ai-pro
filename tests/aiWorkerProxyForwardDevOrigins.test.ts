import { describe, expect, it } from "vitest";
import {
  collectRemoteAiWorkerProxyOriginsFromEnv,
  DEFAULT_AI_WORKER_PROXY_ORIGIN,
} from "../services/aiWorkerProxyForwardDevOrigins";

describe("aiWorkerProxyForwardDevOrigins", () => {
  it("collects AI Worker Proxy envs in stable priority order", () => {
    expect(
      collectRemoteAiWorkerProxyOriginsFromEnv({
        VITE_AI_WORKER_PROXY_API: "https://worker.example/root",
        VITE_AI_WORKER_PROXY_API_VERTEX: "https://vertex.example/root",
        VITE_VERTEX_FALLBACK_AI_WORKER_PROXY_API: "https://fallback.example/root",
      })
    ).toEqual([
      "https://worker.example",
      "https://vertex.example",
      "https://fallback.example",
      DEFAULT_AI_WORKER_PROXY_ORIGIN,
    ]);
  });

  it("ignores same-origin and local development values", () => {
    expect(
      collectRemoteAiWorkerProxyOriginsFromEnv({
        VITE_AI_WORKER_PROXY_API: "same-origin",
        VITE_AI_WORKER_PROXY_API_VERTEX: "http://127.0.0.1:9002",
      })
    ).toEqual([DEFAULT_AI_WORKER_PROXY_ORIGIN]);
  });
});
