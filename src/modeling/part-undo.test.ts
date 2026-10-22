import { expect, it } from "vitest";
import { createEmptyPartDocument } from "@aether/core/document";
import { PartUndoHistory } from "./part-undo";
it("undoes only committed revisions, allows redo, and truncates redo after another edit", () => {
  const history = new PartUndoHistory(), doc = createEmptyPartDocument("A");
  history.record(doc); history.record({ ...doc, name: "B" });
  expect(history.candidate(-1)?.name).toBe("A");
  // Failed rebuild: not accepting the candidate leaves the cursor intact.
  expect(history.candidate(-1)?.name).toBe("A");
  history.accept(-1); expect(history.candidate(1)?.name).toBe("B");
  history.record({ ...doc, name: "C" }); expect(history.candidate(1)).toBeNull();
});
it("isolates documents and clones snapshots", () => {
  const history = new PartUndoHistory(), doc = createEmptyPartDocument("A");
  history.record(doc); doc.name = "B"; history.record(doc);
  const candidate = history.candidate(-1)!; candidate.name = "mutated";
  expect(history.candidate(-1)?.name).toBe("A");
  history.record(createEmptyPartDocument("Other")); expect(history.candidate(-1)).toBeNull();
});
it("undo and redo commands step the same history as the keyboard and report when they can", async () => {
  const { installPartUndo } = await import("./part-undo");
  const listeners = new Map<string, () => void>();
  const original = globalThis.window;
  (globalThis as any).window = { addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) };
  try {
    const doc = createEmptyPartDocument("A");
    let current = doc;
    const changes: boolean[][] = [];
    const undo = installPartUndo(() => current, async next => { current = next; }, () => changes.push([undo?.canStep(-1), undo?.canStep(1)]));
    listeners.get("aether-part-updated")!();
    current = { ...doc, name: "B" }; listeners.get("aether-part-updated")!();
    expect([undo.canStep(-1), undo.canStep(1)]).toEqual([true, false]);
    expect(await undo.step(-1)).toBe(true); expect(current.name).toBe("A");
    expect([undo.canStep(-1), undo.canStep(1)]).toEqual([false, true]);
    expect(await undo.step(1)).toBe(true); expect(current.name).toBe("B");
    expect(changes.at(-1)).toEqual([true, false]);
  } finally { (globalThis as any).window = original; }
});
