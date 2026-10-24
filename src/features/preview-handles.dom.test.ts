// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mountPreviewHandles } from "./preview-handles";

it("mounts feature handles and removes them when their panel closes", async () => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div><div id="panel" data-feature-id="f"></div>';
  // The handles' update loops are not under test; a frame request that never fires keeps jsdom quiet at teardown.
  (window as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame = () => 0;
  const panel = document.getElementById("panel")!;
  const radius = document.createElement("input"); radius.value = "2"; radius.dataset.canonicalFactor = "1";
  const angle = document.createElement("input"); angle.value = "90"; angle.dataset.canonicalFactor = "1";
  mountPreviewHandles(panel, { size: radius, angle }, { length: "mm", angle: "deg" }, { radius: "size" });
  window.addEventListener("aether-native-extrusion-handle", (e) => (e as CustomEvent).detail.respond({ x: 10, y: 10, depthAt: () => 0 }));
  window.addEventListener("aether-native-angle-handle", (e) => (e as CustomEvent).detail.respond({ x: 20, y: 20, points: [{ x: 0, y: 0 }], valueAt: () => 0 }));
  panel.dispatchEvent(new CustomEvent("aether-feature-preview-state", { bubbles: true, detail: { pending: false, model: { previewFeatureId: "f", previewHandles: [
    { parameter: "radius", kind: "linear", originMillimeters: [0, 0, 0], direction: [0, 0, 1] },
    { parameter: "angle", kind: "angular", originMillimeters: [0, 0, 0], direction: [0, 1, 0] },
    { parameter: "ghost", kind: "linear", originMillimeters: [0, 0, 0], direction: [1, 0, 0] },
  ] } } }));
  expect(document.querySelectorAll(".cad-extrusion-handle")).toHaveLength(1); // radius → size; ghost has no control
  expect(document.querySelectorAll(".cad-angle-handle")).toHaveLength(1);
  panel.remove();
  // Let the real disposal observers run while their owning window still exists.
  await Promise.resolve();
  expect(document.querySelectorAll(".cad-extrusion-handle, .cad-angle-handle")).toHaveLength(0);
});
