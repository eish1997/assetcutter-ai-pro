import { describe, it, expect, vi } from "vitest";
import { requestWorkflowVideoWithEndpoint } from "../services/workflowVideoBridge";

describe("workflowVideoBridge", () => {
  it("parses videoUrl from JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ videoUrl: "https://cdn.example/out.mp4", mimeType: "video/mp4" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const out = await requestWorkflowVideoWithEndpoint(
      "https://api.example/gen",
      { prompt: "pan" },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    expect(out.videoUrl).toBe("https://cdn.example/out.mp4");
    expect(out.mimeType).toBe("video/mp4");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example/gen",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "pan", referenceImages: [] }),
      })
    );
  });

  it("accepts url alias and referenceImages", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "/api/r2/clips/x.mp4" }), { status: 200 })
    );
    const out = await requestWorkflowVideoWithEndpoint(
      "https://api.example/gen",
      { prompt: "a", referenceImages: ["data:image/png;base64,xx"] },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    expect(out.videoUrl).toBe("/api/r2/clips/x.mp4");
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.referenceImages).toEqual(["data:image/png;base64,xx"]);
  });

  it("builds data URL from videoBase64 + mimeType", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ videoBase64: "AAA", mimeType: "video/webm" }), { status: 200 })
    );
    const out = await requestWorkflowVideoWithEndpoint(
      "https://api.example/gen",
      { prompt: "b" },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    expect(out.videoUrl).toBe("data:video/webm;base64,AAA");
  });

  it("throws on HTTP error JSON message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "quota" }), { status: 402 })
    );
    await expect(
      requestWorkflowVideoWithEndpoint("https://api.example/gen", { prompt: "x" }, { fetchImpl: fetchImpl as typeof fetch })
    ).rejects.toThrow(/quota/);
  });
});
