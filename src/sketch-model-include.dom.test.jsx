import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { act } from "react";
import { createRequire } from "node:module";
import { createEmptyPartDocument } from "@aether/core/document";
import { clickSketchControl, querySketchControl } from "./sketch/test-controls";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
const kernel = vi.hoisted(() => ({ projectModelGeometry: vi.fn(), sketchSection: vi.fn() }));
vi.mock("./engine/aether/kernel", () => ({ aetherKernel: () => kernel }));
let dom, open, source, apply;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/index.html' });
  for (const name of ['window','document','HTMLElement','CustomEvent','Event','location']) vi.stubGlobal(name, dom.window[name]);
  open = (await import('./sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  source = createEmptyPartDocument("Projection"); apply = vi.fn(async next => { source = next; });
  kernel.projectModelGeometry.mockResolvedValue({ contours: [{ type: 'circle', center: [4, 3], radius: 5 }], approximatedEdges: [], toleranceMillimeters: 0.01 });
});
afterEach(async () => { await act(async () => { querySketchControl('.cad-sketch-workspace [data-feature-action="discard"]')?.click(); }); vi.clearAllMocks(); });
afterAll(async () => { await act(async () => {}); dom.window.close(); vi.unstubAllGlobals(); });
it("uses the actual Include command, saves projected geometry and undoes it as one action", async () => {
  open(() => source, apply);
  window.dispatchEvent(new CustomEvent('aether-sketch-plane', { detail: 'XY' }));
  window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: 'include-edges' }));
  await vi.waitFor(() => expect(kernel.projectModelGeometry).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(querySketchControl('.cad-sketch-workspace').textContent).toContain('editable copies'));
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
  clickSketchControl('Finish sketch');
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(source.features[0].profile.contours).toMatchObject([{ type: 'circle', center: [4, 3], radius: 5, id: expect.any(String) }]);
});
it("never saves a projection that resolves after the sketch has been cancelled", async () => {
  let resolve;
  kernel.projectModelGeometry.mockImplementation(() => new Promise(done => { resolve = done; }));
  open(() => source, apply);
  window.dispatchEvent(new CustomEvent('aether-sketch-plane', { detail: 'XY' }));
  window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: 'include-edges' }));
  querySketchControl('.cad-sketch-workspace [data-feature-action="discard"]').click();
  resolve({ contours: [{ type: 'circle', center: [0, 0], radius: 5 }], approximatedEdges: [], toleranceMillimeters: 0.01 });
  await Promise.resolve(); await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
  expect(document.querySelector('.cad-sketch-workspace')).toBeNull();
});
