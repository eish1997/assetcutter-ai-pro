export type Prompt = { id: string; title?: string; content?: string };
export async function fetchSourcePrompts(_sourceId?: string): Promise<Prompt[]> {
  return [];
}
