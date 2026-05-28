import type { ProviderBinding } from "../types";
import { hubInPortForRegistry } from "./hubPorts";
import { supplierOutletForChannel, supplierOutletForRef } from "./supplierOutlets";
import type { HubInPort, SupplierOutlet, WiringEdge } from "./types";

export function providerBindingsToWiringEdges(
  bindings: readonly ProviderBinding[],
  outlets: readonly SupplierOutlet[] = [],
  hubIns: readonly HubInPort[] = []
): WiringEdge[] {
  const outletByChannel = new Map(outlets.map((o) => [o.channelId, o]));
  const hubInByKey = new Map(hubIns.map((h) => [`${h.registryId}\0${h.role}`, h]));
  const edges: WiringEdge[] = [];

  for (const b of bindings) {
    const outlet = outletByChannel.get(b.channel) ?? supplierOutletForChannel(b.channel);
    const hubIn =
      hubInByKey.get(`${b.registryId}\0${b.role}`) ??
      hubInPortForRegistry(b.registryId, b.role);
    if (!outlet || !hubIn) continue;
    edges.push({
      edgeId: b.bindingId,
      from: { supplierId: outlet.supplierId, outletId: outlet.outletId },
      to: { hubInId: hubIn.hubInId },
      priority: b.priority,
      enabled: true,
      upstreamOverride: b.upstreamOverride,
    });
  }
  return edges.sort((a, b) => a.priority - b.priority);
}

export function wiringEdgesToProviderBindings(
  edges: readonly WiringEdge[],
  outlets: readonly SupplierOutlet[] = [],
  hubIns: readonly HubInPort[] = []
): ProviderBinding[] {
  const outletByRef = new Map(outlets.map((o) => [`${o.supplierId}\0${o.outletId}`, o]));
  const hubInById = new Map(hubIns.map((h) => [h.hubInId, h]));
  const bindings: ProviderBinding[] = [];

  for (const edge of edges) {
    if (edge.enabled === false) continue;
    const outlet =
      outletByRef.get(`${edge.from.supplierId}\0${edge.from.outletId}`) ??
      supplierOutletForRef(edge.from.supplierId, edge.from.outletId);
    const hubIn = hubInById.get(edge.to.hubInId);
    if (!outlet || !hubIn) continue;
    bindings.push({
      bindingId: edge.edgeId,
      registryId: hubIn.registryId,
      role: hubIn.role,
      channel: outlet.channelId,
      priority: edge.priority,
      upstreamOverride: edge.upstreamOverride,
    });
  }
  return bindings.sort((a, b) => a.priority - b.priority);
}

/** 默认 binding 表编译为边表（供单测与 ops 对照） */
export function compileDefaultWiringEdges(bindings: readonly ProviderBinding[]): WiringEdge[] {
  return providerBindingsToWiringEdges(bindings);
}
