import type { ChannelId, ModelResolveRole } from "../types";

/** 供应商标识（产品层，对应 connectionCatalog.id） */
export type SupplierId =
  | "vertex-site"
  | "toapis"
  | "vectorengine"
  | "openai-official"
  | "gemini-aistudio";

export type ApiShape = "gemini" | "openai" | "site-proxy";

/** 供应商上的模型级输出口（可空、可扩展） */
export type SupplierOutlet = {
  outletId: string;
  supplierId: SupplierId;
  label: string;
  upstreamModelId: string;
  apiShape: ApiShape;
  /** 运行时映射到现有 ChannelId，过渡期必填 */
  channelId: ChannelId;
};

/** 平台枢纽输入桩（接供应商输出口） */
export type HubInPort = {
  hubInId: string;
  registryId: string;
  role: ModelResolveRole;
};

/** 平台枢纽输出桩（接前端菜单，初期与 registryId 1:1） */
export type HubOutPort = {
  hubOutId: string;
  registryId: string;
  menuLabel: string;
  visible: boolean;
};

export type SupplierOutletRef = {
  supplierId: SupplierId;
  outletId: string;
};

export type HubInRef = {
  hubInId: string;
};

/** 连线：供应商输出口 → 枢纽输入 */
export type WiringEdge = {
  edgeId: string;
  from: SupplierOutletRef;
  to: HubInRef;
  priority: number;
  enabled?: boolean;
  upstreamOverride?: string;
};
