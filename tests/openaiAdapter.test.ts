import { describe, expect, it } from "vitest";
import {
  aspectRatioToGptImage15Size,
  aspectRatioToGptImage2Pixels,
  aspectRatioToGptImage2Size,
  coerceImageSizeForOpenAiImageModel,
  GPT_IMAGE2_MAX_LONG_EDGE,
  GPT_IMAGE2_MAX_TOTAL_PIXELS,
  GPT_IMAGE2_MIN_TOTAL_PIXELS,
  gptImage2LongEdgeFromImageSize,
  gptImage2TargetPixelsFromImageSize,
  gptImageQualityFromImageSize,
  imageSizeDropdownOptionsForRegistryModel,
  imageSizeSelectOptionsForRegistryModel,
  isGptImage2Model,
  isValidGptImage2Size,
  mapOpenAiChatModel,
  mapOpenAiImageModel,
  normalizeOpenAiBaseUrl,
  parseGptImage2SizeString,
  resolveGptImageSize,
} from "../services/openaiAdapter";
import { geminiContentsToOpenAiMessages } from "../services/toapisAdapter";
import { coerceImageModelRegistryId } from "../services/modelRegistry/imageModels";
import { SUPPORTED_ASPECT_RATIOS } from "../types";

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

  it("gpt-image-1.5 maps to official fixed sizes only", () => {
    expect(aspectRatioToGptImage15Size("1:1")).toBe("1024x1024");
    expect(aspectRatioToGptImage15Size("16:9")).toBe("1536x1024");
    expect(aspectRatioToGptImage15Size("21:9")).toBe("1536x1024");
    expect(aspectRatioToGptImage15Size("9:16")).toBe("1024x1536");
    expect(resolveGptImageSize("gpt-image-1.5", "16:9")).toBe("1536x1024");
    expect(resolveGptImageSize("gpt-image-2", "16:9")).toBe("1536x864");
  });

  it("gpt-image-2 tier budgets and pixel clamping", () => {
    expect(gptImage2TargetPixelsFromImageSize("1K")).toBe(1_048_576);
    expect(gptImage2TargetPixelsFromImageSize("2K")).toBe(3_686_400);
    expect(gptImage2TargetPixelsFromImageSize("4K")).toBe(GPT_IMAGE2_MAX_TOTAL_PIXELS);
    expect(gptImage2TargetPixelsFromImageSize(undefined)).toBeNull();

    expect(aspectRatioToGptImage2Size("1:1", "1K")).toBe("1024x1024");
    expect(aspectRatioToGptImage2Size("16:9", "2K")).toBe("2560x1440");
    expect(aspectRatioToGptImage2Size("9:16", "2K")).toBe("1440x2560");
    expect(aspectRatioToGptImage2Size("1:1", "4K")).toBe("2880x2880");
    expect(aspectRatioToGptImage2Size("16:9", "4K")).toBe("3840x2160");
    expect(aspectRatioToGptImage2Size("4:3", "4K")).toBe("3312x2496");

    const low1k = parseGptImage2SizeString(aspectRatioToGptImage2Size("16:9", "1K"));
    expect(low1k.width * low1k.height).toBeGreaterThanOrEqual(GPT_IMAGE2_MIN_TOTAL_PIXELS);
    expect(aspectRatioToGptImage2Size("21:9", "1K")).toBe("1568x672");
  });

  it("all supported aspect ratios × tiers produce valid gpt-image-2 sizes", () => {
    const tiers = [undefined, "1K", "2K", "4K"] as const;
    for (const { value } of SUPPORTED_ASPECT_RATIOS) {
      for (const tier of tiers) {
        const size = aspectRatioToGptImage2Size(value, tier);
        expect(isValidGptImage2Size(size), `${value} ${tier ?? "default"} → ${size}`).toBe(true);
        const { width, height } = parseGptImage2SizeString(size);
        expect(Math.max(width, height)).toBeLessThanOrEqual(GPT_IMAGE2_MAX_LONG_EDGE);
        const pixels = width * height;
        expect(pixels).toBeGreaterThanOrEqual(GPT_IMAGE2_MIN_TOTAL_PIXELS);
        expect(pixels).toBeLessThanOrEqual(GPT_IMAGE2_MAX_TOTAL_PIXELS);
      }
    }
  });

  it("clamps oversize longEdge requests to OpenAI limits", () => {
    expect(aspectRatioToGptImage2Pixels("1:1", 4096)).toBe("2880x2880");
    expect(aspectRatioToGptImage2Pixels("16:9", 5000)).toBe("3840x2160");
  });

  it("gpt-image-1.5 image size UI/API coercion", () => {
    expect(imageSizeSelectOptionsForRegistryModel("gpt-image-1.5").map((s) => s.value)).toEqual(["1K"]);
    expect(imageSizeSelectOptionsForRegistryModel("gpt-image-2").map((s) => s.value)).toEqual(["1K", "2K", "4K"]);
    expect(imageSizeDropdownOptionsForRegistryModel("gpt-image-1.5").map((o) => o.value)).toEqual(["", "1K"]);
    expect(coerceImageSizeForOpenAiImageModel("gpt-image-1.5", "4K")).toBeUndefined();
    expect(coerceImageSizeForOpenAiImageModel("gpt-image-1.5", "1K")).toBe("1K");
    expect(coerceImageSizeForOpenAiImageModel("gpt-image-2", "4K")).toBe("4K");
    expect(coerceImageSizeForOpenAiImageModel("gpt-image-2", "8K")).toBeUndefined();
    expect(resolveGptImageSize("gpt-image-2", "16:9", "8K")).toBe("1536x864");
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
