/**
 * An in-memory `navigator.locks` for jsdom, which has none (sub-project 43): exclusive locks
 * granted in request order, `signal` honoured while waiting, released when the callback's
 * promise settles.
 */
export class FakeLocks {
  private tails = new Map<string, Promise<unknown>>();
  private holders = new Map<string, number>();

  held(name: string): boolean {
    return (this.holders.get(name) ?? 0) > 0;
  }

  request<T>(name: string, ...args: [(lock: Lock | null) => T | Promise<T>] | [LockOptions, (lock: Lock | null) => T | Promise<T>]): Promise<T> {
    const [options, callback] = args.length === 1 ? [{} as LockOptions, args[0]] : args;
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    const previous = this.tails.get(name) ?? Promise.resolve();
    let granted = false;
    let aborted = false;
    const abortion = new Promise<never>((_, reject) => {
      // Like the real API: an abort only counts while the request waits; once granted it is ignored.
      signal?.addEventListener("abort", () => {
        if (granted) return;
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    const turn = previous.then(async () => {
      if (aborted) return undefined as T;
      granted = true;
      this.holders.set(name, (this.holders.get(name) ?? 0) + 1);
      try {
        return await callback({ name, mode: "exclusive" } as Lock);
      } finally {
        this.holders.set(name, (this.holders.get(name) ?? 1) - 1);
      }
    });
    this.tails.set(name, turn.catch(() => undefined));
    return options.signal ? Promise.race([turn, abortion]) : turn;
  }
}
