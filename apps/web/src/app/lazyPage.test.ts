import { expect, it, vi } from "vitest";
import { CHUNK_RELOAD_KEY, loadWithChunkRecovery } from "./lazyPage";

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    map,
  };
}
const module_ = { default: () => null };

it("returns the module on first success and clears any stale reload flag", async () => {
  const store = fakeStore({ [CHUNK_RELOAD_KEY]: "1" });
  await expect(loadWithChunkRecovery(async () => module_, store, vi.fn())).resolves.toBe(module_);
  expect(store.map.has(CHUNK_RELOAD_KEY)).toBe(false);
});

it("retries a transient chunk failure once and succeeds without reloading", async () => {
  const store = fakeStore();
  const reload = vi.fn();
  let calls = 0;
  const load = async () => { calls++; if (calls === 1) throw new Error("chunk load failed"); return module_; };
  await expect(loadWithChunkRecovery(load, store, reload)).resolves.toBe(module_);
  expect(calls).toBe(2);
  expect(reload).not.toHaveBeenCalled();
});

it("reloads exactly once when the chunk keeps failing, and stays pending", async () => {
  const store = fakeStore();
  const reload = vi.fn();
  const load = async () => { throw new Error("chunk load failed"); };
  const pending = loadWithChunkRecovery(load, store, reload);
  const settled = await Promise.race([pending.then(() => "resolved", () => "rejected"), new Promise(r => setTimeout(() => r("pending"), 50))]);
  expect(settled).toBe("pending"); // Suspense keeps the loading state while the reload happens
  expect(reload).toHaveBeenCalledTimes(1);
  expect(store.map.get(CHUNK_RELOAD_KEY)).toBe("1");
});

it("surfaces the error instead of reloading twice in a row", async () => {
  const store = fakeStore({ [CHUNK_RELOAD_KEY]: "1" });
  const reload = vi.fn();
  const load = async () => { throw new Error("chunk load failed"); };
  await expect(loadWithChunkRecovery(load, store, reload)).rejects.toThrow("chunk load failed");
  expect(reload).not.toHaveBeenCalled();
});
