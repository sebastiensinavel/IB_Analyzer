import { describe, expect, it } from "vitest";
import { FakeLocks } from "./fakeLocks";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

describe("FakeLocks", () => {
  it("grants in request order", async () => {
    const locks = new FakeLocks();
    const order: number[] = [];
    const first = gate();
    const a = locks.request("l", async () => { order.push(1); await first.promise; });
    const b = locks.request("l", async () => { order.push(2); });
    await tick();
    expect(order).toEqual([1]);
    first.open();
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  it("never runs a request aborted while waiting, and lets the next waiter in", async () => {
    const locks = new FakeLocks();
    const holder = gate();
    const ran: string[] = [];
    const a = locks.request("l", async () => { ran.push("a"); await holder.promise; });
    const controller = new AbortController();
    const b = locks.request("l", { signal: controller.signal }, async () => { ran.push("b"); });
    const c = locks.request("l", async () => { ran.push("c"); });
    await tick();
    controller.abort();
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    holder.open();
    await Promise.all([a, c]);
    expect(ran).toEqual(["a", "c"]);
  });

  it("rejects an already aborted signal without running the callback", async () => {
    const locks = new FakeLocks();
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(locks.request("l", { signal: controller.signal }, async () => { ran = true; })).rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toBe(false);
    expect(locks.held("l")).toBe(false);
  });

  it("ignores an abort after the grant: the request resolves with the callback's result", async () => {
    const locks = new FakeLocks();
    const controller = new AbortController();
    const inside = gate();
    const result = locks.request("l", { signal: controller.signal }, async () => { await inside.promise; return 42; });
    await tick();
    controller.abort();
    inside.open();
    await expect(result).resolves.toBe(42);
  });

  it("holds the lock while the callback runs only", async () => {
    const locks = new FakeLocks();
    const inside = gate();
    const result = locks.request("l", async () => { await inside.promise; });
    await tick();
    expect(locks.held("l")).toBe(true);
    expect(locks.held("other")).toBe(false);
    inside.open();
    await result;
    expect(locks.held("l")).toBe(false);
  });
});
