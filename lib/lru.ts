// A Map that forgets its least recently used entries past a count or a size.
export class LRU<T> {
  private map = new Map<string, { value: T; size: number }>();
  private size = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxSize: number
  ) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, size: number): void {
    if (size > this.maxSize) return;
    const old = this.map.get(key);
    if (old) {
      this.size -= old.size;
      this.map.delete(key);
    }
    this.map.set(key, { value, size });
    this.size += size;
    for (const [k, e] of this.map) {
      if (this.map.size <= this.maxEntries && this.size <= this.maxSize) break;
      this.map.delete(k);
      this.size -= e.size;
    }
  }

  get count(): number {
    return this.map.size;
  }
}
