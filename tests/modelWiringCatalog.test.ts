import { describe, expect, it } from "vitest";

import { modelWiringRows } from "../services/modelRegistry/modelWiringCatalog";

describe("modelWiringRows", () => {
  it("returns rows for registered text and image SKUs", () => {
    const rows = modelWiringRows(["vertex-proxy", "openai-official"]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.role === "text" && r.registryId.includes("gemini"))).toBe(true);
    expect(rows.some((r) => r.role === "image")).toBe(true);
  });

  it("reflects enabled vertex outlet in wiring states", () => {
    const rows = modelWiringRows(["vertex-proxy"]);
    const flash = rows.find((r) => r.registryId === "gemini-3-flash-preview" && r.role === "text");
    expect(flash).toBeTruthy();
    const vertex = flash!.outlets.find((o) => o.channel === "vertex-proxy");
    expect(vertex?.state === "active" || vertex?.state === "pending").toBe(true);
  });
});
