import type { CustomAppModule } from '../types';

/** 与 WorkflowSection 运行日志中性前缀一致（避免在能力库展示） */
export const QUICK_COMPOSE_BAR_LOG_LABEL = '底部输入';

/** 内置「快捷条·文」——不对应用户能力库条目 */
export const QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID = 'ac_internal_quick_compose_plain_text';

/** 内置「快捷条·文生图」（无参考图时） */
export const QUICK_COMPOSE_PLAIN_T2I_ACTION_ID = 'ac_internal_quick_compose_plain_t2i';

/** 内置「快捷条·图生图」（有参考图时） */
export const QUICK_COMPOSE_PLAIN_I2I_ACTION_ID = 'ac_internal_quick_compose_plain_i2i';

function plainTextModule(): CustomAppModule {
  return {
    id: QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID,
    label: QUICK_COMPOSE_BAR_LOG_LABEL,
    category: 'text_to_text',
    engine: 'gen_text',
    enabled: true,
    order: -999,
    instruction: '请根据用户问题直接作答，条理清晰；如需创作，给出具体可执行的内容。',
    skipUnderstand: true,
  };
}

function plainT2IModule(): CustomAppModule {
  return {
    id: QUICK_COMPOSE_PLAIN_T2I_ACTION_ID,
    label: QUICK_COMPOSE_BAR_LOG_LABEL,
    category: 'text_to_image',
    engine: 'gen_image',
    enabled: true,
    order: -999,
    instruction: '',
    skipUnderstand: true,
    imageModelRegistryId: 'gemini-3.1-flash-image-preview',
  };
}

function plainI2IModule(): CustomAppModule {
  return {
    id: QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
    label: QUICK_COMPOSE_BAR_LOG_LABEL,
    category: 'image_to_image',
    engine: 'gen_image',
    enabled: true,
    order: -999,
    instruction:
      '根据用户文字说明调整、细化或重新生成画面，保持主体与构图合理；若用户未补充说明，则在保持内容的前提下适度增强细节与观感。',
    skipUnderstand: true,
    imageModelRegistryId: 'gemini-3.1-flash-image-preview',
  };
}

/** 解析底部快捷条「无拖入预设」用的内置能力（不在预设列表中） */
export function getQuickComposePlainModule(actionType: string): CustomAppModule | null {
  switch (actionType) {
    case QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID:
      return plainTextModule();
    case QUICK_COMPOSE_PLAIN_T2I_ACTION_ID:
      return plainT2IModule();
    case QUICK_COMPOSE_PLAIN_I2I_ACTION_ID:
      return plainI2IModule();
    default:
      return null;
  }
}
