import { expect, it } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { DrawingEditor } from "../drawing/controller";
import { CADDrawingWorkspaceStore } from "../cad-drawing-workspace-store";
import { drawingAgentInteraction } from "./drawing-agent";
const make = async () => {
  const editor = new DrawingEditor(new CADDrawingWorkspaceStore(), async () => ({ visible: [{ kind: "line" as const, start: [0, 0], end: [40, 10] }], hidden: [], bounds: [0, 0, 40, 10], bodyIds: ["body"] }));
  editor.configure(() => createRectanglePartDocument("Part", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 })); await editor.enter();
  let context = "drawing";
  const interaction = drawingAgentInteraction(editor, context, () => context);
  const call = (name: string, args = {}) => interaction.execute({ id: "call", name: `aether_cad_${name}`, arguments: args }, new AbortController().signal);
  return { editor, call, switchContext: () => { context = "part"; } };
};
it("uses the same canonical commands, measures source units, exports and undoes", async () => {
  const { editor, call } = await make();
  const sheetId = editor.snapshot()!.document.activeSheetId;
  await call("drawing_edit", { expected_revision: editor.snapshot()!.revision, command_json: JSON.stringify({ type: "add-view", sheetId, view: { id: "front", name: "Front", orientation: "front", originMm: [80, 110], scale: 2, hiddenLines: true } }) });
  await call("drawing_edit", { expected_revision: editor.snapshot()!.revision, command_json: JSON.stringify({ type: "add-annotation", sheetId, annotation: { id: "width", kind: "width", viewId: "front", positionMm: [80, 140], decimals: 2 } }) });
  expect(await call("drawing_inspect")).toMatchObject({ sheet: { annotations: [{ value_mm: 40 }] }, writable: true });
  expect(await call("drawing_export", { expected_revision: editor.snapshot()!.revision, format: "svg" })).toMatchObject({ changed: false, text: expect.stringContaining("40.00") });
  await call("drawing_undo", { expected_revision: editor.snapshot()!.revision }); expect(editor.snapshot()!.document.sheets[0].annotations).toHaveLength(0);
  await call("drawing_redo", { expected_revision: editor.snapshot()!.revision }); expect(editor.snapshot()!.document.sheets[0].annotations).toHaveLength(1);
  expect(await call("docs", { name: "aether_cad_drawing_edit" })).toMatchObject({ workspace: "drawing", tools: [{ name: "aether_cad_drawing_edit" }] });
});
it("rejects stale revisions, unknown commands, source replacement and closed context without edits", async () => {
  const { editor, call, switchContext } = await make(), before = editor.serialize();
  await expect(call("drawing_edit", { expected_revision: "old", command_json: "{}" })).rejects.toThrow(/revision changed/);
  await expect(call("drawing_edit", { expected_revision: editor.snapshot()!.revision, command_json: '{"type":"refresh-source"}' })).rejects.toThrow(/refresh tool/);
  await expect(call("drawing_edit", { expected_revision: editor.snapshot()!.revision, command_json: '{"type":"bogus"}' })).rejects.toThrow();
  await expect(call("drawing_inspect", { offset: 0.5 })).rejects.toThrow(/offset/);
  await expect(call("drawing_inspect", { invented: true })).rejects.toThrow(/Unknown/);
  switchContext(); await expect(call("drawing_inspect")).rejects.toThrow(/changed/);
  expect(editor.serialize()).toBe(before);
});
