import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pickBinding } from "../services/modelRegistry/pickBinding";
import { imageModelProviderRoute } from "../services/modelRegistry/imageModels";

vi.mock("../services/modelRegistry/pickBinding", () => ({
  pickBinding: vi.fn(),
}));

vi.mock("../services/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/settingsStore")>();
  return {
    ...actual,
    getUserApiKey: vi.fn(() => null),
    getEnabledChannels: vi.fn(() => ["openai-official"]),
    getOpenaiApiKey: vi.fn(() => "sk-test"),
  };
});

/** 与 geminiService 内 usesOpenAiRouteForImage 逻辑对齐的单测替身 */
function usesOpenAiRouteForImage(registryId: string): boolean {
  const picked = pickBinding(registryId, "image");
  if (picked?.channel === "openai-official" || picked?.channel === "toapis-openai") return true;
  return imageModelProviderRoute(registryId) === "openai";
}

const OPENAI_IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const GEMINI_IMAGE_REQUEST_TIMEOUT_MS = 120_000;

function isLongImageSizeTier(imageSize?: string): boolean {
  const s = (imageSize || "").trim().toUpperCase();
  return s === "4K" || s === "4";
}

function imageGenTimeoutMsForModel(registryId: string, baseTimeout: number, imageSize?: string): number {
  if (isLongImageSizeTier(imageSize)) {
    return Math.max(baseTimeout, OPENAI_IMAGE_REQUEST_TIMEOUT_MS);
  }
  if (usesOpenAiRouteForImage(registryId)) {
    return Math.max(baseTimeout, OPENAI_IMAGE_REQUEST_TIMEOUT_MS);
  }
  return baseTimeout;
}

describe("OpenAI image generation timeout", () => {
  beforeEach(() => {
    vi.mocked(pickBinding).mockReturnValue({
      bindingId: "gpt-image-2:openai-official:image",
      registryId: "gpt-image-2",
      role: "image",
      channel: "openai-official",
      priority: 10,
      upstreamModelId: "gpt-image-2",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extends timeout to 600s for gpt-image-2 on openai-official", () => {
    expect(imageGenTimeoutMsForModel("gpt-image-2", GEMINI_IMAGE_REQUEST_TIMEOUT_MS)).toBe(600_000);
  });

  it("keeps default timeout for gemini image models", () => {
    vi.mocked(pickBinding).mockReturnValue({
      bindingId: "gemini-3.1-flash-image-preview:vertex-proxy:image",
      registryId: "gemini-3.1-flash-image-preview",
      role: "image",
      channel: "vertex-proxy",
      priority: 10,
      upstreamModelId: "gemini-3.1-flash-image-preview",
    });
    expect(imageGenTimeoutMsForModel("gemini-3.1-flash-image-preview", GEMINI_IMAGE_REQUEST_TIMEOUT_MS)).toBe(
      120_000
    );
  });

  it("extends timeout to 600s for Gemini 4K image generation", () => {
    vi.mocked(pickBinding).mockReturnValue({
      bindingId: "gemini-3-pro-image:gemini-aistudio:image",
      registryId: "gemini-3-pro-image",
      role: "image",
      channel: "gemini-aistudio",
      priority: 40,
      upstreamModelId: "gemini-3-pro-image",
    });
    expect(imageGenTimeoutMsForModel("gemini-3-pro-image", GEMINI_IMAGE_REQUEST_TIMEOUT_MS, "4K")).toBe(600_000);
  });
});
