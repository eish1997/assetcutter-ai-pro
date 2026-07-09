import type { CustomAppModule } from '../types';

/** 内置拼图改图能力预设 id（与 capability-seed / enforce 合并一致） */
export const STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID = 'storyboard_collage_redraw_v1';

export const DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION = `你是分镜拼图改图助手（无需阅读分镜表文字）。

输入为分镜插画拼图（每格仅插画与格线，无画面描述/对白等文字条）。用户消息仅含各格的「修改反馈」。

按反馈修改对应格内画面；整体画风、线稿/上色方式、笔触与色彩氛围须与输入图保持一致。

硬性要求：
- 保持与输入相同的格数、格线、排列顺序与整体尺寸；
- 每格输出只能是修改后的插画；
- 禁止添加任何文字说明条、Scene Info、Dialogue 或边框。`;

export const STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID = 'storyboard_role_replace_v1';

export const DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION = `你是分镜角色替换助手（多图参考，无需阅读任何分镜文字）。

参考图 1：当前镜头分镜图（画风、构图、姿态、表情、动作的唯一样板）。
参考图 2 起：角色资产参考图（仅提供被替换人物的外貌/造型）。

按用户消息中的位置清单，把参考图 1 里对应位置的人物外貌换成相应参考图的角色造型；姿态、表情、动作、景别、背景与整体画风必须与参考图 1 一致。未列入清单的区域不要改动。

禁止：改动作/表情、重绘场景、添加文字或边框、输出多格画面。`;

export function getBuiltinStoryboardFeedbackCollagePreset(): CustomAppModule {
  return {
    id: STORYBOARD_FEEDBACK_COLLAGE_DEFAULT_PRESET_ID,
    label: '分镜拼图改图',
    category: 'image_to_image',
    engine: 'gen_image',
    enabled: true,
    order: 0,
    instruction: DEFAULT_STORYBOARD_FEEDBACK_COLLAGE_INSTRUCTION,
    imageGear: 'pro',
  };
}

export function getBuiltinStoryboardRoleReplacePreset(): CustomAppModule {
  return {
    id: STORYBOARD_ROLE_REPLACE_DEFAULT_PRESET_ID,
    label: '分镜角色替换改图',
    category: 'image_to_image',
    engine: 'gen_image',
    enabled: true,
    instruction: DEFAULT_STORYBOARD_ROLE_REPLACE_INSTRUCTION,
    imageGear: 'pro',
  };
}
