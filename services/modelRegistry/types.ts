/** 模型能力族：决定适配器与 binding 优先级链 */
export type ModelFamily = "gemini" | "openai";

/** 接线 channel（实现层，不是产品菜单 SKU） */
export type ChannelId =
  | "vertex-proxy"
  | "gemini-aistudio"
  | "toapis-gemini"
  | "toapis-openai"
  | "vectorengine"
  | "openai-official";

export type ModelResolveRole = "text" | "image";

export type ProviderBinding = {
  bindingId: string;
  registryId: string;
  role: ModelResolveRole;
  channel: ChannelId;
  /** 越小越优先 */
  priority: number;
  /** 用户未显式配置时的默认是否启用 channel */
  defaultEnabled?: boolean;
  upstreamOverride?: string;
};

export type PickedBinding = ProviderBinding & {
  upstreamModelId: string;
};
