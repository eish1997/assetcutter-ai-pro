import { describe, expect, it } from "vitest";
import { buildHubInPorts } from "../services/modelRegistry/hubGraph/hubPorts";
import {
  providerBindingsToWiringEdges,
  wiringEdgesToProviderBindings,
} from "../services/modelRegistry/hubGraph/compile";
import { STATIC_SUPPLIER_OUTLETS } from "../services/modelRegistry/hubGraph/supplierOutlets";
import { PROVIDER_BINDINGS } from "../services/modelRegistry/providerBindings";

describe("hubGraph compile", () => {
  const hubIns = buildHubInPorts();

  it("providerBindings → edges → bindings round trip preserves keys", () => {
    const edges = providerBindingsToWiringEdges(PROVIDER_BINDINGS, STATIC_SUPPLIER_OUTLETS, hubIns);
    expect(edges.length).toBe(PROVIDER_BINDINGS.length);

    const roundTrip = wiringEdgesToProviderBindings(edges, STATIC_SUPPLIER_OUTLETS, hubIns);
    expect(roundTrip.length).toBe(PROVIDER_BINDINGS.length);

    for (const original of PROVIDER_BINDINGS) {
      const back = roundTrip.find((b) => b.bindingId === original.bindingId);
      expect(back).toBeDefined();
      expect(back!.registryId).toBe(original.registryId);
      expect(back!.role).toBe(original.role);
      expect(back!.channel).toBe(original.channel);
      expect(back!.priority).toBe(original.priority);
    }
  });

  it("disabled edge is omitted from bindings", () => {
    const sample = PROVIDER_BINDINGS[0]!;
    const edges = providerBindingsToWiringEdges([sample], STATIC_SUPPLIER_OUTLETS, hubIns);
    const disabled = edges.map((e) => (e.edgeId === sample.bindingId ? { ...e, enabled: false } : e));
    const bindings = wiringEdgesToProviderBindings(disabled, STATIC_SUPPLIER_OUTLETS, hubIns);
    expect(bindings.find((b) => b.bindingId === sample.bindingId)).toBeUndefined();
  });
});
