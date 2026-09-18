const mem = new Map<string, unknown>();

const localforage = {
  async getItem<T>(key: string): Promise<T | null> {
    return (mem.has(key) ? (mem.get(key) as T) : null);
  },
  async setItem<T>(key: string, value: T): Promise<T> {
    mem.set(key, value);
    return value;
  },
  async removeItem(key: string): Promise<void> {
    mem.delete(key);
  },
};

export default localforage;
