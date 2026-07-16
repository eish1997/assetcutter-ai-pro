export type ProviderCatalogId =
  | "openai-official"
  | "gemini-aistudio"
  | "vertex-site"
  | "toapis"
  | "vectorengine"
  | "volcengine-ark"
  | "volcengine-jimeng"
  | "tripo"
  | "tencent-hunyuan";

export type ProviderModality = "text" | "image" | "video" | "model3d" | "music" | "digital_human";

export type ProviderAuthField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  envName?: string;
  storage: "secret" | "credentials";
};

export type ProviderAuthScheme = {
  id: "api-key" | "api-key-base-url" | "ak-sk" | "secret-id-key" | "site";
  label: string;
  fields: readonly ProviderAuthField[];
};

export type ProviderCapabilityStatus = {
  catalogVisible: boolean;
  keyPoolSupported: boolean;
  backendAdapterReady: boolean;
  platformKeyReady: boolean;
  byokSupported: boolean;
  modelCatalogReady: boolean;
  smokeTestReady: boolean;
};

export type ProviderCatalogEntry = {
  id: ProviderCatalogId;
  displayName: string;
  shortName: string;
  supportedModalities: readonly ProviderModality[];
  authSchemes: readonly ProviderAuthScheme[];
  homepageUrl?: string;
  consoleUrl?: string;
  docsUrl?: string;
  pricingUrl?: string;
  keyPoolSupported: boolean;
  byokSupported: boolean;
  modelDiscovery: "static" | "manual" | "api-planned";
  capabilityStatus: ProviderCapabilityStatus;
};

function capabilityStatus(overrides: Partial<ProviderCapabilityStatus>): ProviderCapabilityStatus {
  return {
    catalogVisible: true,
    keyPoolSupported: false,
    backendAdapterReady: false,
    platformKeyReady: false,
    byokSupported: false,
    modelCatalogReady: true,
    smokeTestReady: false,
    ...overrides,
  };
}

const API_KEY_FIELD: ProviderAuthField = {
  key: "apiKey",
  label: "API Key",
  secret: true,
  storage: "secret",
};

const BASE_URL_FIELD: ProviderAuthField = {
  key: "baseUrl",
  label: "Base URL",
  storage: "credentials",
};

const API_KEY_SCHEME: ProviderAuthScheme = {
  id: "api-key",
  label: "API Key",
  fields: [API_KEY_FIELD],
};

const API_KEY_BASE_URL_SCHEME: ProviderAuthScheme = {
  id: "api-key-base-url",
  label: "API Key + Base URL",
  fields: [API_KEY_FIELD, BASE_URL_FIELD],
};

const VOLCENGINE_AK_SK_SCHEME: ProviderAuthScheme = {
  id: "ak-sk",
  label: "Access Key / Secret Key",
  fields: [
    {
      key: "accessKeyId",
      label: "Access Key",
      secret: true,
      placeholder: "VOLCENGINE_ACCESS_KEY",
      envName: "VOLCENGINE_ACCESS_KEY",
      storage: "credentials",
    },
    {
      key: "secretAccessKey",
      label: "Secret Key",
      secret: true,
      placeholder: "VOLCENGINE_SECRET_KEY",
      envName: "VOLCENGINE_SECRET_KEY",
      storage: "credentials",
    },
    {
      key: "region",
      label: "Region",
      placeholder: "cn-north-1",
      storage: "credentials",
    },
  ],
};

const TENCENT_SECRET_SCHEME: ProviderAuthScheme = {
  id: "secret-id-key",
  label: "SecretId / SecretKey",
  fields: [
    {
      key: "secretId",
      label: "SecretId",
      secret: true,
      placeholder: "TENCENT_SECRET_ID",
      envName: "TENCENT_SECRET_ID",
      storage: "credentials",
    },
    {
      key: "secretKey",
      label: "SecretKey",
      secret: true,
      placeholder: "TENCENT_SECRET_KEY",
      envName: "TENCENT_SECRET_KEY",
      storage: "credentials",
    },
  ],
};

const SITE_SCHEME: ProviderAuthScheme = {
  id: "site",
  label: "站点代理",
  fields: [],
};

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "tripo",
    displayName: "Tripo 3D",
    shortName: "Tripo",
    supportedModalities: ["model3d"],
    authSchemes: [API_KEY_SCHEME],
    homepageUrl: "https://www.tripo3d.ai/",
    consoleUrl: "https://platform.tripo3d.ai/",
    docsUrl: "https://platform.tripo3d.ai/docs",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "static",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
    }),
  },
  {
    id: "volcengine-jimeng",
    displayName: "火山引擎即梦",
    shortName: "即梦",
    supportedModalities: ["image", "video", "digital_human"],
    authSchemes: [VOLCENGINE_AK_SK_SCHEME],
    homepageUrl: "https://www.volcengine.com/product/jimeng",
    consoleUrl: "https://console.volcengine.com/visual/overview",
    docsUrl: "https://www.volcengine.com/docs/85621",
    pricingUrl: "https://www.volcengine.com/product/jimeng/pricing",
    keyPoolSupported: true,
    byokSupported: false,
    modelDiscovery: "static",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: false,
    }),
  },
  {
    id: "volcengine-ark",
    displayName: "火山方舟",
    shortName: "方舟",
    supportedModalities: ["text", "image", "video", "model3d"],
    authSchemes: [
      {
        ...API_KEY_BASE_URL_SCHEME,
        fields: [
          {
            ...API_KEY_FIELD,
            placeholder: "ARK_API_KEY",
            envName: "VOLCENGINE_ARK_API_KEY",
          },
          {
            ...BASE_URL_FIELD,
            placeholder: "https://ark.cn-beijing.volces.com/api/v3",
            envName: "VOLCENGINE_ARK_BASE_URL",
          },
        ],
      },
    ],
    homepageUrl: "https://www.volcengine.com/product/ark",
    consoleUrl: "https://console.volcengine.com/ark/region:cn-beijing",
    docsUrl: "https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1330310?lang=zh",
    pricingUrl: "https://www.volcengine.com/product/ark/pricing",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "api-planned",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
      smokeTestReady: true,
    }),
  },
  {
    id: "openai-official",
    displayName: "OpenAI",
    shortName: "OpenAI",
    supportedModalities: ["text", "image"],
    authSchemes: [API_KEY_BASE_URL_SCHEME],
    homepageUrl: "https://openai.com/",
    consoleUrl: "https://platform.openai.com/",
    docsUrl: "https://platform.openai.com/docs",
    pricingUrl: "https://openai.com/api/pricing/",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "api-planned",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
      smokeTestReady: true,
    }),
  },
  {
    id: "vertex-site",
    displayName: "Google Vertex AI",
    shortName: "Vertex",
    supportedModalities: ["text", "image"],
    authSchemes: [SITE_SCHEME],
    homepageUrl: "https://cloud.google.com/vertex-ai",
    consoleUrl: "https://console.cloud.google.com/vertex-ai",
    docsUrl: "https://cloud.google.com/vertex-ai/docs",
    pricingUrl: "https://cloud.google.com/vertex-ai/generative-ai/pricing",
    keyPoolSupported: false,
    byokSupported: false,
    modelDiscovery: "api-planned",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: false,
      backendAdapterReady: true,
      platformKeyReady: false,
      byokSupported: false,
    }),
  },
  {
    id: "gemini-aistudio",
    displayName: "Google AI Studio",
    shortName: "AI Studio",
    supportedModalities: ["text", "image"],
    authSchemes: [API_KEY_SCHEME],
    homepageUrl: "https://aistudio.google.com/",
    consoleUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "api-planned",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: false,
      platformKeyReady: false,
      byokSupported: true,
    }),
  },
  {
    id: "toapis",
    displayName: "ToAPIs",
    shortName: "ToAPIs",
    supportedModalities: ["text", "image"],
    authSchemes: [API_KEY_BASE_URL_SCHEME],
    homepageUrl: "https://toapis.com/",
    consoleUrl: "https://toapis.com/",
    docsUrl: "https://toapis.com/",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "manual",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: true,
      platformKeyReady: true,
      byokSupported: true,
      smokeTestReady: true,
    }),
  },
  {
    id: "vectorengine",
    displayName: "VectorEngine",
    shortName: "VectorEngine",
    supportedModalities: ["text", "image"],
    authSchemes: [API_KEY_BASE_URL_SCHEME],
    homepageUrl: "https://vectorengine.ai/",
    consoleUrl: "https://vectorengine.ai/",
    docsUrl: "https://vectorengine.ai/",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "manual",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: false,
      platformKeyReady: false,
      byokSupported: true,
    }),
  },
  {
    id: "tencent-hunyuan",
    displayName: "腾讯混元",
    shortName: "混元",
    supportedModalities: ["model3d"],
    authSchemes: [TENCENT_SECRET_SCHEME],
    homepageUrl: "https://cloud.tencent.com/product/hunyuan",
    consoleUrl: "https://console.cloud.tencent.com/hunyuan",
    docsUrl: "https://cloud.tencent.com/document/product/1804",
    pricingUrl: "https://cloud.tencent.com/document/product/1804/115929",
    keyPoolSupported: true,
    byokSupported: true,
    modelDiscovery: "static",
    capabilityStatus: capabilityStatus({
      keyPoolSupported: true,
      backendAdapterReady: false,
      platformKeyReady: false,
      byokSupported: true,
    }),
  },
] as const;

export const PROVIDER_CATALOG_IDS: readonly ProviderCatalogId[] = PROVIDER_CATALOG.map((entry) => entry.id);

export function isProviderCatalogId(value: string): value is ProviderCatalogId {
  return (PROVIDER_CATALOG_IDS as readonly string[]).includes(value);
}

export function getProviderCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === id);
}

export function providerDisplayName(id: string): string {
  return getProviderCatalogEntry(id)?.displayName ?? id;
}

export function providersForAdminKeyPool(): readonly ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter((entry) => entry.keyPoolSupported);
}

export function providerCapabilityStatus(id: string): ProviderCapabilityStatus | undefined {
  return getProviderCatalogEntry(id)?.capabilityStatus;
}
