import { describe, expect, it } from "vitest";
import { AssemblyEditHistory } from "./assembly-edit-history";

describe("bounded Assembly history", () => {
  it("retains order, branches after undo, and rejects stale model identities", () => {
    const h = new AssemblyEditHistory<object>();
    const [a,b,c,d,e] = Array.from({length:5}, () => ({}));
    h.record("a","b",a,b); h.record("b","c",b,c);
    expect(h.target(-1,c)).toBe("b"); h.moved(-1,c,d);
    expect(h.target(-1,d)).toBe("a"); expect(h.target(1,d)).toBe("c");
    expect(h.canMove(-1,b)).toBe(false);
    expect(() => h.moved(1,c,e)).toThrow(/changed/);
    h.record("b","branch",d,e);
    expect(h.canMove(1,e)).toBe(false); expect(h.target(-1,e)).toBe("b");
  });
  it("evicts oldest archives by both count and memory and releases them on close", () => {
    for (const h of [new AssemblyEditHistory<object>(2), new AssemblyEditHistory<object>(64,8)]) {
      const [a,b,c,d,e,f] = Array.from({length:6}, () => ({}));
      h.record("a","b",a,b); h.record("b","c",b,c); h.record("c","d",c,d);
      expect(h.target(-1,d)).toBe("c"); h.moved(-1,d,e);
      expect(h.target(-1,e)).toBe("b"); h.moved(-1,e,f);
      expect(h.canMove(-1,f)).toBe(false);
      h.clear(); expect(h.canMove(1,f)).toBe(false);
    }
    const h = new AssemblyEditHistory<object>(2,4), a={}, b={};
    h.record("large","archive",a,b); expect(h.canMove(-1,b)).toBe(false);
  });
});
