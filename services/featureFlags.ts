/** 阶段 B 实验开关（localStorage），默认关闭 */

const KEY_PROMPT_COMPILER = 'ac_feature_prompt_compiler';
const KEY_PIPELINE_PLANNER = 'ac_feature_pipeline_planner';

export function getPromptCompilerEnabled(): boolean {
  try {
    return localStorage.getItem(KEY_PROMPT_COMPILER) === '1';
  } catch {
    return false;
  }
}

export function setPromptCompilerEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY_PROMPT_COMPILER, '1');
    else localStorage.removeItem(KEY_PROMPT_COMPILER);
  } catch {
    // ignore
  }
}

export function getPipelinePlannerEnabled(): boolean {
  try {
    return localStorage.getItem(KEY_PIPELINE_PLANNER) === '1';
  } catch {
    return false;
  }
}

export function setPipelinePlannerEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY_PIPELINE_PLANNER, '1');
    else localStorage.removeItem(KEY_PIPELINE_PLANNER);
  } catch {
    // ignore
  }
}
