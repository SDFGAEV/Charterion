export class TabOperationQueue {
  private readonly tails = new Map<number, Promise<void>>();

  run<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(tabId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const marker = previous.catch(() => undefined).then(() => gate);
    this.tails.set(tabId, marker);

    return previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        release();
        if (this.tails.get(tabId) === marker) this.tails.delete(tabId);
      });
  }

  pending(tabId: number): boolean {
    return this.tails.has(tabId);
  }
}
