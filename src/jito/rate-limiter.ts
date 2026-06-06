/**
 * Serializes calls and enforces a minimum interval between them, so we respect the public Jito
 * block-engine limit (1 request/second for txn requests). All gated calls run in submission order.
 */
export class RateLimiter {
  private last = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    // Keep the chain alive regardless of individual success/failure.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
