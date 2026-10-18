import { expect, it, vi } from "vitest";
import { PreviewQueue } from "./feature-preview";
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
it("coalesces changes and never displays an obsolete native result", async () => {
  const resolvers: ((n: number) => void)[] = [];
  const evaluate = vi.fn((_n: number) => new Promise<number>(r => resolvers.push(r)));
  const show = vi.fn(); const queue = new PreviewQueue(evaluate, show);
  queue.request(10); queue.request(20); queue.request(30);
  resolvers[0](10); await tick();
  expect(show).not.toHaveBeenCalled();
  expect(evaluate.mock.calls.map(c => c[0])).toEqual([10, 30]);
  resolvers[1](30); await tick(); expect(show).toHaveBeenLastCalledWith(30);
});
it("clears on cancel and ignores an in-flight reply", async () => {
  let resolve!: (n: number) => void;
  const show = vi.fn(); const queue = new PreviewQueue((_n: number) => new Promise<number>(r => resolve = r), show);
  queue.request(10); queue.close(); resolve(10); await tick();
  expect(show.mock.calls).toEqual([[null]]);
});
it("replaces a failed preview after parameters are corrected", async () => {
  const show = vi.fn(); const evaluate = vi.fn().mockRejectedValueOnce(new Error("Invalid fillet")).mockResolvedValueOnce(5);
  const queue = new PreviewQueue(evaluate, show);
  queue.request(1000); await tick(); expect(show).toHaveBeenLastCalledWith(null, "Invalid fillet");
  queue.request(5); await tick(); expect(show).toHaveBeenLastCalledWith(5);
});
it('retains the last preview while a newer depth is being computed',async()=>{
  const show=vi.fn();const queue=new PreviewQueue(async(value:number)=>value,show);
  queue.request(10);await tick();expect(show).toHaveBeenLastCalledWith(10);
  queue.invalidate(false);expect(show.mock.calls).toEqual([[10]]);
  queue.request(20);await tick();expect(show).toHaveBeenLastCalledWith(20);
  queue.close();expect(show).toHaveBeenLastCalledWith(null);
});
