import { describe, expect, it } from "vitest";
import {
  aspectRatioToGptImage15Size,
  aspectRatioToGptImage2Size,
  gptImageQualityFromImageSize,
  isGptImage2Model,
  mapOpenAiChatModel,
  mapOpenAiImageModel,
  normalizeOpenAiBaseUrl,
  resolveGptImageSize,
} from "../services/openaiAdapter";
import { geminiContentsToOpenAiMessages } from "../services/toapisAdapter";
import { coerceImageModelRegistryId } from "../services/modelRegistry/imageModels";

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

  it("mapOpenAiImageModel defaults to gpt-image-1.5 and migrates legacy ids", () => {
    expect(mapOpenAiImageModel("")).toBe("gpt-image-1.5");
    expect(mapOpenAiImageModel("gemini-3-pro-image-preview")).toBe("gpt-image-1.5");
    expect(mapOpenAiImageModel("gpt-image-1")).toBe("gpt-image-1.5");
    expect(mapOpenAiImageModel("dall-e-3")).toBe("gpt-image-1.5");
    expect(mapOpenAiImageModel("gpt-image-1.5")).toBe("gpt-image-1.5");
    expect(mapOpenAiImageModel("gpt-image-2")).toBe("gpt-image-2");
  });

  it("GPT Image size mapping follows official standard sizes", () => {
    expect(aspectRatioToGptImage15Size("1:1")).toBe("1024x1024");
    expect(aspectRatioToGptImage15Size("16:9")).toBe("1536x1024");
    expect(aspectRatioToGptImage15Size("9:16")).toBe("1024x1536");
    expect(aspectRatioToGptImage2Size("16:9")).toBe("1536x864");
    expect(resolveGptImageSize("gpt-image-1.5", "16:9")).toBe("1536x1024");
    expect(resolveGptImageSize("gpt-image-2", "16:9")).toBe("1536x864");
  });

  it("isGptImage2Model detects gpt-image-2 family", () => {
    expect(isGptImage2Model("gpt-image-2")).toBe(true);
    expect(isGptImage2Model("gpt-image-1.5")).toBe(false);
  });

  it("gptImageQualityFromImageSize maps Gemini imageSize to OpenAI quality", () => {
    expect(gptImageQualityFromImageSize("1K")).toBe("medium");
    expect(gptImageQualityFromImageSize("2K")).toBe("high");
    expect(gptImageQualityFromImageSize("4K")).toBe("high");
    expect(gptImageQualityFromImageSize(undefined)).toBe("auto");
  });

  it("coerceImageModelRegistryId migrates legacy OpenAI registry ids", () => {
    expect(coerceImageModelRegistryId("gpt-image-1")).toBe("gpt-image-1.5");
    expect(coerceImageModelRegistryId("dall-e-3")).toBe("gpt-image-1.5");
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
