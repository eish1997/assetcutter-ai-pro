/**
 * 全站默认模型 id（策略 A：registryId 与上游 Gemini 系 id 一致，见 docs/多模型可运营改造计划.md）。
 * 设置页 / App 初始化应从这里取默认值，避免与注册表漂移。
 */
export const DEFAULT_MODEL_TEXT = "gemini-3-flash-preview";
export const DEFAULT_MODEL_IMAGE = "gemini-3.1-flash-image-preview";
export const DEFAULT_MODEL_PRO = "gemini-3-pro-image-preview";
