import type { SystemConfig } from "../../types";
import { DEFAULT_MODEL_IMAGE, DEFAULT_MODEL_PRO, DEFAULT_MODEL_TEXT } from "./constants";
import { isRegisteredImageModelId } from "./imageModels";
import { coerceTextModelRegistryId } from "./textModels";

/**
 * 读本地 `ac_config` 后收敛模型字段：空串回默认；生图槽位若非注册表 id 则回默认（防脏数据）。
 * `modelText` 经注册表 coerce，未知 id 仍保留（兼容自定义）。
 */
export function migrateSystemModelSlots(
  config: Pick<SystemConfig, "modelText" | "modelImage" | "modelPro">
): Pick<SystemConfig, "modelText" | "modelImage" | "modelPro"> {
  const modelText = coerceTextModelRegistryId((config.modelText || "").trim() || DEFAULT_MODEL_TEXT);
  let modelImage = (config.modelImage || "").trim() || DEFAULT_MODEL_IMAGE;
  let modelPro = (config.modelPro || "").trim() || DEFAULT_MODEL_PRO;
  if (!isRegisteredImageModelId(modelImage)) modelImage = DEFAULT_MODEL_IMAGE;
  if (!isRegisteredImageModelId(modelPro)) modelPro = DEFAULT_MODEL_PRO;
  return { modelText, modelImage, modelPro };
}
