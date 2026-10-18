import { expect, it } from "vitest";
import { Mesh } from "three/webgpu";
import { styledLines } from "./styled-lines";

it("draws non-depth-writing CAD strokes after opaque surfaces while keeping rear edges occluded", () => {
  const lines = styledLines([0, 0, 0, 1, 0, 0], 0x112233, 1.6);
  lines.material.transparent = false; // Hidden-line / 100% edge opacity.
  expect(lines.renderOrder).toBeGreaterThan(new Mesh().renderOrder);
  expect(lines.material.depthTest).toBe(true);
  expect(lines.material.depthWrite).toBe(false);
  expect(lines.geometry.instanceCount).toBe(1);
  lines.geometry.dispose(); lines.material.dispose();
});
