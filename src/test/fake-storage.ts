// An in-memory localStorage that can be told to fail, for testing how saved
// progress survives broken storage.

export class FakeStorage implements Storage {
  items = new Map<string, string>();
  /** Make getItem throw, as when storage is unavailable. */
  failReads = false;
  /** Make setItem throw, as when storage is full. */
  failWrites = false;

  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    if (this.failReads) throw new DOMException('unavailable', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError');
    this.items.set(key, String(value));
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
}
