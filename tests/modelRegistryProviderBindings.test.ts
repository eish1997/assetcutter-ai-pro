import { afterEach, describe, expect, it, vi } from "vitest";

import { pickBinding } from "../services/modelRegistry/pickBinding";
import { resolveUpstreamImageModelId } from "../services/modelRegistry/resolve";
import * as settingsStore from "../services/settingsStore";

describe("model registry provider bindings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes Volcengine Ark Seedream image models through the Ark channel", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["volcengine-ark"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation((channel) => channel === "volcengine-ark");

    const picked = pickBinding("doubao-seedream-5-0", "image");

    expect(picked).toMatchObject({
      registryId: "doubao-seedream-5-0",
      channel: "volcengine-ark",
      upstreamModelId: "doubao-seedream-5-0",
    });
    expect(resolveUpstreamImageModelId("doubao-seedream-5-0")).toBe("doubao-seedream-5-0");
  });

  it("routes Jimeng image models through the Jimeng channel instead of falling back to Gemini", () => {
    vi.spyOn(settingsStore, "getEnabledChannels").mockReturnValue(["volcengine-jimeng"]);
    vi.spyOn(settingsStore, "isChannelReady").mockImplementation((channel) => channel === "volcengine-jimeng");

    const picked = pickBinding("jimeng-image-t2i-v40", "image");

    expect(picked).toMatchObject({
      registryId: "jimeng-image-t2i-v40",
      channel: "volcengine-jimeng",
      upstreamModelId: "jimeng-image-t2i-v40",
    });
    expect(resolveUpstreamImageModelId("jimeng-image-t2i-v40")).toBe("jimeng-image-t2i-v40");
  });
});
