/**
 * 3D 生成「任务适配」层共用类型。
 * 新增供应商时：扩展 {@link Generate3dProviderId}、在 registry 登记，并实现对应适配模块。
 */

/** 当前已接入的 3D 供应商（工作流预设 generate3D.provider） */
export type Generate3dProviderId = 'tencent' | 'tripo' | 'volcengine-ark';
