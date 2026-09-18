export type PromptSource = {
  id: string;
  name: string;
  url?: string;
  enabled: boolean;
  builtIn?: boolean;
};
export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [];
export function createPromptSource(partial?: Partial<PromptSource>): PromptSource {
  return {
    id: partial?.id || `source-${Date.now()}`,
    name: partial?.name || '',
    url: partial?.url,
    enabled: partial?.enabled ?? true,
    builtIn: partial?.builtIn,
  };
}
