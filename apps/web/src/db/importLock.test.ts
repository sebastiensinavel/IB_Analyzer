import { describe, expect, it } from "vitest";
import { withImportLock } from "./importLock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withImportLock", () => {
  it("never lets two imports of the same account overlap", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withImportLock("beta", async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    const b = withImportLock("beta", async () => {
      events.push("b:start");
      events.push("b:end");
    });

    expect(events).toEqual(["a:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("lets two accounts import at the same time", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withImportLock("beta", async () => {
      events.push("beta:start");
      await first.promise;
      events.push("beta:end");
    });
    const b = withImportLock("alpha", async () => {
      events.push("alpha:start");
      events.push("alpha:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["beta:start", "alpha:start", "alpha:end"]);
    first.resolve();
    await Promise.all([a, b]);
  });

  it("lets a queue carry on after a failure", async () => {
    const failing = withImportLock("beta", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(withImportLock("beta", async () => "next")).resolves.toBe("next");
  });
});
