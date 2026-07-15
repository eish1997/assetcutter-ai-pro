import type { ChannelId } from "../types";
import type { SupplierId, SupplierOutlet } from "./types";

/** 静态供应商输出口目录（过渡期 1:1 映射 ChannelId） */
export const STATIC_SUPPLIER_OUTLETS: readonly SupplierOutlet[] = [
  {
    outletId: "vertex-proxy",
    supplierId: "vertex-site",
    label: "Vertex · 站点代理",
    upstreamModelId: "*",
    apiShape: "site-proxy",
    channelId: "vertex-proxy",
  },
  {
    outletId: "toapis-gemini",
    supplierId: "toapis",
    label: "ToAPIs · Gemini 形态",
    upstreamModelId: "*",
    apiShape: "gemini",
    channelId: "toapis-gemini",
  },
  {
    outletId: "toapis-openai",
    supplierId: "toapis",
    label: "ToAPIs · OpenAI 形态",
    upstreamModelId: "*",
    apiShape: "openai",
    channelId: "toapis-openai",
  },
  {
    outletId: "vectorengine",
    supplierId: "vectorengine",
    label: "VectorEngine",
    upstreamModelId: "*",
    apiShape: "gemini",
    channelId: "vectorengine",
  },
  {
    outletId: "openai-official",
    supplierId: "openai-official",
    label: "OpenAI 官方",
    upstreamModelId: "*",
    apiShape: "openai",
    channelId: "openai-official",
  },
  {
    outletId: "volcengine-ark",
    supplierId: "volcengine-ark",
    label: "火山方舟",
    upstreamModelId: "*",
    apiShape: "openai",
    channelId: "volcengine-ark",
  },
  {
    outletId: "gemini-aistudio",
    supplierId: "gemini-aistudio",
    label: "Google AI Studio",
    upstreamModelId: "*",
    apiShape: "gemini",
    channelId: "gemini-aistudio",
  },
] as const;

const OUTLET_BY_CHANNEL = new Map<ChannelId, SupplierOutlet>(
  STATIC_SUPPLIER_OUTLETS.map((o) => [o.channelId, o])
);

const OUTLET_BY_REF = new Map<string, SupplierOutlet>(
  STATIC_SUPPLIER_OUTLETS.map((o) => [`${o.supplierId}\0${o.outletId}`, o])
);

export function supplierOutletForChannel(channel: ChannelId): SupplierOutlet | undefined {
  return OUTLET_BY_CHANNEL.get(channel);
}

export function supplierOutletLabelForChannel(channel: ChannelId): string | undefined {
  return OUTLET_BY_CHANNEL.get(channel)?.label;
}

export function supplierOutletForRef(supplierId: SupplierId, outletId: string): SupplierOutlet | undefined {
  return OUTLET_BY_REF.get(`${supplierId}\0${outletId}`);
}
