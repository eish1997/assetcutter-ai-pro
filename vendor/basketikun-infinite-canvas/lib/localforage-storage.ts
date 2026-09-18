const mem = new Map<string, string>();
export const localForageStorage = {
  async getItem(name: string): Promise<string | null> {
    return mem.has(name) ? mem.get(name)! : null;
  },
  async setItem(name: string, value: string): Promise<void> {
    mem.set(name, value);
  },
  async removeItem(name: string): Promise<void> {
    mem.delete(name);
  },
};
