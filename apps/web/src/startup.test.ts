import { afterEach, expect, it, vi } from "vitest";
import { startApp } from "@/startup";

afterEach(() => vi.restoreAllMocks());

it("renders after the preparation step", async () => {
  const order: string[] = [];
  await startApp(async () => void order.push("prepare"), () => void order.push("render"));
  expect(order).toEqual(["prepare", "render"]);
});

it("still renders when the preparation step fails, and says why in the console", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const render = vi.fn();
  const failure = new Error("seed failed");
  await startApp(() => Promise.reject(failure), render);
  expect(render).toHaveBeenCalledOnce();
  expect(logged).toHaveBeenCalledWith(expect.any(String), failure);
});
