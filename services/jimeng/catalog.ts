import type { JimengCatalogEntry, JimengModality } from "./types";

/** §3 SKU 唯一真源（含 verified 门禁） */
export const JIMENG_CATALOG: readonly JimengCatalogEntry[] = [
  // §3.1 图片
  {
    registryId: "jimeng-image-t2i-v40",
    label: "即梦 · 图片生成 4.0",
    modality: "image",
    upstreamReqKey: "jimeng_t2i_v40",
    docRef: "https://www.volcengine.com/docs/85621/1817045?lang=zh",
    verified: true,
    warehouseOnly: true,
    asyncMode: "submit_poll",
  },
  {
    registryId: "jimeng-image-t2i-v30",
    label: "即梦 · 文生图 3.0",
    modality: "image",
    upstreamReqKey: "jimeng_t2i_v30",
    docRef: "https://www.volcengine.com/docs/85621/1616429?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
  },
  {
    registryId: "jimeng-image-t2i-v31",
    label: "即梦 · 文生图 3.1",
    modality: "image",
    upstreamReqKey: "jimeng_t2i_v31",
    docRef: "https://www.volcengine.com/docs/85621/1616429?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
  },
  {
    registryId: "jimeng-image-i2i-v30",
    label: "即梦 · 图生图 3.0",
    modality: "image",
    upstreamReqKey: "jimeng_i2i_v30",
    docRef: "https://www.volcengine.com/docs/85621/1747301?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-image-t2i-v46",
    label: "即梦 · 图片生成 4.6",
    modality: "image",
    upstreamReqKey: "jimeng_t2i_v46",
    docRef: "https://www.volcengine.com/docs/85621/2275082?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
  },
  {
    registryId: "jimeng-image-inpainting",
    label: "即梦 · Inpainting",
    modality: "image",
    upstreamReqKey: "jimeng_inpainting",
    docRef: "https://www.volcengine.com/docs/85621/2164806?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-image-outpainting",
    label: "即梦 · Outpainting",
    modality: "image",
    upstreamReqKey: "jimeng_outpainting",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-image-upscale",
    label: "即梦 · 智能超清",
    modality: "image",
    upstreamReqKey: "jimeng_upscale",
    docRef: "https://www.volcengine.com/docs/85621/2164806?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-image-pod-extract",
    label: "即梦 · POD 按需定制",
    modality: "image",
    upstreamReqKey: "jimeng_pod_extract",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-image-product-extract",
    label: "即梦 · 商品提取",
    modality: "image",
    upstreamReqKey: "jimeng_product_extract",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },

  // §3.2 视频
  {
    registryId: "jimeng-video-ti2v-v30-pro",
    label: "即梦 · 视频 3.0 Pro",
    modality: "video",
    upstreamReqKey: "jimeng_ti2v_v30_pro",
    docRef: "https://www.volcengine.com/docs/85621/1777001?lang=zh",
    verified: true,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-video-t2v-v30-720p",
    label: "即梦 · 720P 文生视频",
    modality: "video",
    upstreamReqKey: "jimeng_t2v_v30",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
  },
  {
    registryId: "jimeng-video-i2v-first-v30-720p",
    label: "即梦 · 720P 图生首帧",
    modality: "video",
    upstreamReqKey: "jimeng_i2v_first_v30",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-video-i2v-first-tail-v30-720p",
    label: "即梦 · 720P 首尾帧",
    modality: "video",
    upstreamReqKey: "jimeng_i2v_first_tail_v30",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 2,
  },
  {
    registryId: "jimeng-video-i2v-recamera-v30-720p",
    label: "即梦 · 720P 运镜",
    modality: "video",
    upstreamReqKey: "jimeng_i2v_recamera_v30",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-video-t2v-v30-1080p",
    label: "即梦 · 1080P 文生视频",
    modality: "video",
    upstreamReqKey: "jimeng_t2v_v30_1080p",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
  },
  {
    registryId: "jimeng-video-i2v-first-v30-1080p",
    label: "即梦 · 1080P 图生首帧",
    modality: "video",
    upstreamReqKey: "jimeng_i2v_first_v30_1080p",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-video-i2v-first-tail-v30-1080p",
    label: "即梦 · 1080P 首尾帧",
    modality: "video",
    upstreamReqKey: "jimeng_i2v_first_tail_v30_1080p",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 2,
  },
  {
    registryId: "jimeng-video-motion-mimic-v20",
    label: "即梦 · 动作模仿 2.0",
    modality: "video",
    upstreamReqKey: "jimeng_motion_mimic_v20",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
  {
    registryId: "jimeng-video-translate-v20",
    label: "即梦 · 视频翻译 2.0",
    modality: "video",
    upstreamReqKey: "jimeng_video_translate_v20",
    docRef: "https://www.volcengine.com/docs/85621/1792702?lang=zh",
    verified: false,
    warehouseOnly: true,
    asyncMode: "submit_poll",
    maxReferenceImages: 1,
  },
] as const;

export type JimengCatalogRegistryId = (typeof JIMENG_CATALOG)[number]["registryId"];

const CATALOG_BY_ID = new Map<string, JimengCatalogEntry>(
  JIMENG_CATALOG.map((entry) => [entry.registryId, entry])
);

const VERIFIED_REGISTRY_IDS = new Set(
  JIMENG_CATALOG.filter((e) => e.verified).map((e) => e.registryId)
);

/** 文档 §3 冻结的 verified SKU（W0 冒烟范围） */
export const JIMENG_VERIFIED_REGISTRY_IDS = [
  "jimeng-image-t2i-v40",
  "jimeng-video-ti2v-v30-pro",
] as const satisfies readonly JimengCatalogRegistryId[];

export function getJimengCatalogEntry(registryId: string): JimengCatalogEntry | undefined {
  return CATALOG_BY_ID.get((registryId || "").trim());
}

export function listJimengCatalogByModality(modality: JimengModality): JimengCatalogEntry[] {
  return JIMENG_CATALOG.filter((e) => e.modality === modality);
}

export function isJimengCatalogRegistryId(registryId: string): registryId is JimengCatalogRegistryId {
  return CATALOG_BY_ID.has((registryId || "").trim());
}

export function isJimengVerifiedRegistryId(registryId: string): boolean {
  return VERIFIED_REGISTRY_IDS.has((registryId || "").trim());
}

export function upstreamReqKeyForJimengRegistry(registryId: string): string | undefined {
  return getJimengCatalogEntry(registryId)?.upstreamReqKey;
}
