// An async iterable fed by push(), for prompts that arrive one by one.
export class InputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: {
    resolve: (r: IteratorResult<T>) => void;
    reject: (e: unknown) => void;
  } | null = null;
  private ended = false;
  private error: unknown = null;

  push(item: T): void {
    if (this.ended) return;
    if (this.waiting) {
      this.waiting.resolve({ value: item, done: false });
      this.waiting = null;
    } else {
      this.items.push(item);
    }
  }

  end(): void {
    this.ended = true;
    this.waiting?.resolve({ value: undefined, done: true });
    this.waiting = null;
  }

  // Ends the iteration with an error, once the queued items are read.
  fail(error: unknown): void {
    if (this.ended) return;
    this.error = error;
    this.ended = true;
    this.waiting?.reject(error);
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined)
          return Promise.resolve({ value: item, done: false });
        if (this.ended)
          return this.error
            ? Promise.reject(this.error)
            : Promise.resolve({ value: undefined, done: true });
        return new Promise(
          (resolve, reject) => (this.waiting = { resolve, reject })
        );
      },
    };
  }
}
