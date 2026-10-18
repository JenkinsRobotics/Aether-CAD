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
