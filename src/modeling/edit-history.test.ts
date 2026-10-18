import { expect, it, vi } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
import { EditHistory, featurePreviewDocument } from "./edit-history";
import type { ImportedModelData } from "../domain";
const model = (name: string): ImportedModelData => ({ parts: [], sourceName: name, parseMilliseconds: 0 });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const document = () => createRectanglePartDocument("Part",{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});

it("evaluates only predecessors while exposing the edited feature in the tree, without changing saved history", async () => {
  const doc = document(), before = structuredClone(doc);
  const service = {evaluate:vi.fn().mockResolvedValue(model("past")),show:vi.fn(),changed:vi.fn(),error:vi.fn()};
  const history = new EditHistory(service);
  const close = history.begin(doc, doc.features[0].id);
  expect(service.show).toHaveBeenLastCalledWith(null,true);
  expect(service.evaluate.mock.calls[0][0].rollbackIndex).toBe(0);
  expect(history.project(doc)?.rollbackIndex).toBe(1);
  expect(doc).toEqual(before);
  await tick(); expect(service.show).toHaveBeenLastCalledWith(model("past"),true);
  close(); expect(history.project(doc)).toBe(doc);
  expect(service.show).toHaveBeenLastCalledWith(null,false);
});
it("restores an existing manual rollback and rejects late results after cancellation or switching editors", async () => {
  const doc={...document(),rollbackIndex:1};
  const resolvers: ((value: ImportedModelData)=>void)[]=[];
  const service={evaluate:vi.fn(()=>new Promise<ImportedModelData>(resolve=>resolvers.push(resolve))),show:vi.fn(),changed:vi.fn(),error:vi.fn()};
  const history=new EditHistory(service);
  const first=history.begin(doc,doc.features[0].id);
  const second=history.begin(doc,doc.features[1].id);
  first();resolvers[0](model("obsolete"));await tick();
  expect(history.project(doc)?.rollbackIndex).toBe(2);
  expect(service.show).not.toHaveBeenCalledWith(model("obsolete"),true);
  second();resolvers[1](model("late"));await tick();
  expect(history.project(doc)).toBe(doc);
  expect(history.project(doc)?.rollbackIndex).toBe(1);
  expect(service.show).toHaveBeenLastCalledWith(null,false);
});
it("limits a feature preview without truncating the committed document or leaking into another part",()=>{
  const doc=document();const preview=featurePreviewDocument(doc,doc.features[0].id);
  expect(preview.rollbackIndex).toBe(1);expect(preview.features).toEqual(doc.features);expect(doc.rollbackIndex).toBeUndefined();
  const history=new EditHistory({evaluate:vi.fn().mockResolvedValue(model("past")),show:vi.fn(),changed:vi.fn(),error:vi.fn()});
  history.begin(doc,doc.features[0].id);
  const other={...doc,documentId:"other"};expect(history.project(other)).toBe(other);
});
