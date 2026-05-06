import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_IMAGE, DEFAULT_MODEL_TEXT } from "../services/modelRegistry/constants";
import {
  resolveUpstreamModelIdForProvider,
  resolveUpstreamImageModelId,
  resolveUpstreamTextModelId,
} from "../services/modelRegistry/resolve";
import type { AiProvider } from "../services/settingsStore";

describe("modelRegistry resolve", () => {
  it("VectorEngine text: preview ids map to 2.5", () => {
    const p = "vectorengine" as AiProvider;
    expect(resolveUpstreamModelIdForProvider("gemini-3-flash-preview", "text", p)).toBe("gemini-2.5-flash");
    expect(resolveUpstreamModelIdForProvider("gemini-3-pro-preview", "text", p)).toBe("gemini-2.5-pro");
  });

  it("Gemini official path: text unchanged", () => {
    const p = "gemini" as AiProvider;
    expect(resolveUpstreamModelIdForProvider("gemini-3-flash-preview", "text", p)).toBe("gemini-3-flash-preview");
  });

  it("OpenAI: Gemini-style ids map to gpt models", () => {
    const p = "openai" as AiProvider;
    expect(resolveUpstreamModelIdForProvider("gemini-3-flash-preview", "text", p)).toBe("gpt-4o-mini");
    expect(resolveUpstreamModelIdForProvider("gemini-3-pro-preview", "text", p)).toBe("gpt-4o");
    expect(resolveUpstreamModelIdForProvider("gpt-4o", "text", p)).toBe("gpt-4o");
    expect(resolveUpstreamModelIdForProvider("gemini-3-pro-image-preview", "image", p)).toBe("gpt-image-1");
    expect(resolveUpstreamModelIdForProvider("gpt-image-1", "image", p)).toBe("gpt-image-1");
  });

  it("DEFAULT_MODEL_* from constants map under OpenAI (能力执行器等默认 registryId)", () => {
    const p = "openai" as AiProvider;
    expect(resolveUpstreamModelIdForProvider(DEFAULT_MODEL_TEXT, "text", p)).toBe("gpt-4o-mini");
    expect(resolveUpstreamModelIdForProvider(DEFAULT_MODEL_IMAGE, "image", p)).toBe("gpt-image-1");
  });

  it("Antigravity image: preview suffix stripped to console ids", () => {
    const p = "antigravity" as AiProvider;
    expect(resolveUpstreamModelIdForProvider("gemini-3.1-flash-image-preview", "image", p)).toBe(
      "gemini-3.1-flash-image"
    );
    expect(resolveUpstreamModelIdForProvider("gemini-3-pro-image-preview", "image", p)).toBe("gemini-3-pro-image");
  });

  it("VectorEngine image: pro/flash preview fall back to 2.5 flash image", () => {
    const p = "vectorengine" as AiProvider;
    expect(resolveUpstreamModelIdForProvider("gemini-3.1-flash-image-preview", "image", p)).toBe(
      "gemini-2.5-flash-image"
    );
    expect(resolveUpstreamModelIdForProvider("gemini-3-pro-image-preview", "image", p)).toBe("gemini-2.5-flash-image");
  });

  it("empty id passes through", () => {
    expect(resolveUpstreamTextModelId("")).toBe("");
    expect(resolveUpstreamImageModelId("   ")).toBe("   ");
  });
});
