/** 模型能力族：决定适配器与 binding 优先级链 */
export type ModelFamily = "gemini" | "openai" | "volcengine-ark" | "volcengine-jimeng";

/** 接线 channel（实现层，不是产品菜单 SKU） */
export type ChannelId =
  | "vertex-proxy"
  | "gemini-aistudio"
  | "toapis-gemini"
  | "toapis-openai"
  | "302ai-openai"
  | "aihubmix-openai"
  | "vectorengine"
  | "openai-official"
  | "tinysnow-openai"
  | "volcengine-ark"
  | "volcengine-jimeng";

export type ModelResolveRole = "text" | "image";

/** 上游 API 适配器标识（仅 resolve 层，非用户设置） */
export type UpstreamProviderId =
  | "gemini"
  | "vertex"
  | "toapis"
  | "302ai"
  | "aihubmix"
  | "openai"
  | "tinysnow"
  | "vectorengine"
  | "volcengine-ark"
  | "volcengine-jimeng"
  | "antigravity";

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
