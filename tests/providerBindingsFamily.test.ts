import { describe, expect, it } from "vitest";
import { getBindingsForRegistry, getFamilyBindingsForRegistry } from "../services/modelRegistry/providerBindings";

describe("providerBindings family fallback", () => {
  it("synthesizes bindings for unknown text registry id", () => {
    const bindings = getBindingsForRegistry("custom-gemini-model-preview", "text");
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.some((b) => b.channel === "vertex-proxy")).toBe(true);
    expect(bindings.every((b) => b.registryId === "custom-gemini-model-preview")).toBe(true);
  });

  it("synthesizes openai family for gpt upstream image id", () => {
    const bindings = getFamilyBindingsForRegistry("gpt-image-1", "image");
    expect(bindings.some((b) => b.channel === "openai-official")).toBe(true);
    expect(bindings.some((b) => b.channel === "vertex-proxy")).toBe(false);
  });

  it("synthesizes gemini family for unknown gemini image upstream id", () => {
    const bindings = getFamilyBindingsForRegistry("gemini-2.5-flash-image", "image");
    expect(bindings.some((b) => b.channel === "vertex-proxy")).toBe(true);
  });
});
