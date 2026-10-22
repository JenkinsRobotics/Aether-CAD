import { describe, it, expect } from "vitest";
import { appendSTEP } from "./step-import";


describe("saved native STEP import", () => {
  it("rejects empty or oversized source without changing the current document", async () => {
    await expect(appendSTEP(null, new File([], "empty.step"))).rejects.toThrow(/nonempty/);
    await expect(appendSTEP(null, new File([new Uint8Array(3*1024*1024+1)], "large.step"))).rejects.toThrow(/3 MiB/);
  });
});
