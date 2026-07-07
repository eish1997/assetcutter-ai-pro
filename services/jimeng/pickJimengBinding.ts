import { getJimengCatalogEntry } from "./catalog";
import type { JimengModality } from "./types";

export type JimengBinding = {
  channel: "volcengine-jimeng";
  upstreamReqKey: string;
};

/**
 * 视频 / 数字人专用选线（不经 pickBinding / geminiService）。
 * 图类 jimeng SKU 仍走 pickBinding(role=image)。
 */
export function pickJimengBinding(
  modality: Extract<JimengModality, "video" | "digital_human">,
  registryId: string
): JimengBinding | null {
  const id = String(registryId || "").trim();
  if (!id) return null;
  const entry = getJimengCatalogEntry(id);
  if (!entry || entry.modality !== modality) return null;
  return {
    channel: "volcengine-jimeng",
    upstreamReqKey: entry.upstreamReqKey,
  };
}
