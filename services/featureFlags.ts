/** 阶段 B 实验开关（localStorage），默认关闭；读写经 `clientPersist` */

import { readLocalFlag, writeLocalFlag } from './clientPersist';

const KEY_PROMPT_COMPILER = 'ac_feature_prompt_compiler';
const KEY_PIPELINE_PLANNER = 'ac_feature_pipeline_planner';

export function getPromptCompilerEnabled(): boolean {
  return readLocalFlag(KEY_PROMPT_COMPILER);
}

export function setPromptCompilerEnabled(on: boolean): void {
  writeLocalFlag(KEY_PROMPT_COMPILER, on);
}

export function getPipelinePlannerEnabled(): boolean {
  return readLocalFlag(KEY_PIPELINE_PLANNER);
}

export function setPipelinePlannerEnabled(on: boolean): void {
  writeLocalFlag(KEY_PIPELINE_PLANNER, on);
}
