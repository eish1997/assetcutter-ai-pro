import { describe, expect, it } from "vitest";
import {
  mapOpenAiChatModel,
  mapOpenAiImageModel,
  normalizeOpenAiBaseUrl,
} from "../services/openaiAdapter";
import { geminiContentsToOpenAiMessages } from "../services/toapisAdapter";

describe("openaiAdapter", () => {
  it("normalizeOpenAiBaseUrl appends /v1", () => {
    expect(normalizeOpenAiBaseUrl("")).toBe("https://api.openai.com/v1");
    expect(normalizeOpenAiBaseUrl("https://api.openai.com")).toBe("https://api.openai.com/v1");
    expect(normalizeOpenAiBaseUrl("https://example.com/v1/")).toBe("https://example.com/v1");
  });

  it("mapOpenAiChatModel passthrough gpt/o prefixes", () => {
    expect(mapOpenAiChatModel("gpt-4o")).toBe("gpt-4o");
    expect(mapOpenAiChatModel("o3-mini")).toBe("o3-mini");
  });

  it("mapOpenAiChatModel maps Gemini-style ids", () => {
    expect(mapOpenAiChatModel("gemini-3-flash-preview")).toBe("gpt-4o-mini");
    expect(mapOpenAiChatModel("gemini-3-pro-preview")).toBe("gpt-4o");
  });

  it("mapOpenAiImageModel defaults and passthrough", () => {
    expect(mapOpenAiImageModel("gemini-3-pro-image-preview")).toBe("gpt-image-1");
    expect(mapOpenAiImageModel("gpt-image-1")).toBe("gpt-image-1");
    expect(mapOpenAiImageModel("dall-e-3")).toBe("dall-e-3");
  });

  it("geminiContentsToOpenAiMessages builds roles", () => {
    const messages = geminiContentsToOpenAiMessages(
      [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
      ],
      "sys"
    );
    expect(messages[0]).toEqual({ role: "system", content: "sys" });
    expect(messages[1]).toEqual({ role: "user", content: "hi" });
    expect(messages[2]).toEqual({ role: "assistant", content: "hello" });
  });
});
