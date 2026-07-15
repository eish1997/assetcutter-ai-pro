import { describe, expect, it } from "vitest";
import { DIALOG_IMAGE_REGISTRY } from "../services/modelRegistry/imageModels";
import { JIMENG_IMAGE_REGISTRY } from "../services/modelRegistry/jimengImageRegistry";
import {
  defaultEnabledChannelIds,
  getBindingsForRegistry,
  PROVIDER_BINDINGS,
} from "../services/modelRegistry/providerBindings";
import { TEXT_MODEL_REGISTRY } from "../services/modelRegistry/textModels";

describe("providerBindings", () => {
  it("covers every image registry id with image bindings", () => {
    for (const row of DIALOG_IMAGE_REGISTRY) {
      const bindings = getBindingsForRegistry(row.registryId, "image");
      expect(bindings.length).toBeGreaterThan(0);
      expect(bindings.every((b) => b.registryId === row.registryId && b.role === "image")).toBe(true);
    }
  });

  it("covers every jimeng image registry id with volcengine-jimeng binding", () => {
    for (const row of JIMENG_IMAGE_REGISTRY) {
      const bindings = getBindingsForRegistry(row.registryId, "image");
      expect(bindings).toHaveLength(1);
      expect(bindings[0]?.channel).toBe("volcengine-jimeng");
      expect(bindings[0]?.defaultEnabled).toBe(false);
    }
  });

  it("covers every text registry id with text bindings", () => {
    for (const row of TEXT_MODEL_REGISTRY) {
      const bindings = getBindingsForRegistry(row.registryId, "text");
      expect(bindings.length).toBeGreaterThan(0);
    }
  });

  it("default enabled channels match binding defaultEnabled flags", () => {
    const fromFlags = defaultEnabledChannelIds();
    expect(fromFlags).toContain("vertex-proxy");
    expect(fromFlags).toContain("openai-official");
    expect(fromFlags).not.toContain("volcengine-ark");
    expect(fromFlags).not.toContain("gemini-aistudio");
  });

  it("does not attach Volcengine Ark to OpenAI model bindings by default", () => {
    const bindings = getBindingsForRegistry("gpt-4o-mini", "text");
    expect(bindings.some((b) => b.channel === "volcengine-ark")).toBe(false);
  });

  it("gemini-aistudio bindings are not defaultEnabled", () => {
    const aistudio = PROVIDER_BINDINGS.filter((b) => b.channel === "gemini-aistudio");
    expect(aistudio.length).toBeGreaterThan(0);
    expect(aistudio.every((b) => !b.defaultEnabled)).toBe(true);
  });
});
