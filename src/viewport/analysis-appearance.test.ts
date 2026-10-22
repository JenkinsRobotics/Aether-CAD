import { expect, it } from "vitest";
import { MeshStandardMaterial } from "three/webgpu";
import { applySurfaceAppearance } from "./surface-appearance";
import { cadDisplayStylePolicy } from "../viewport-appearance";
import { resolveAppearance } from "./appearance-themes";
import { cadAppearance } from "../cad-appearance-store";

it("installs and removes the analysis shader patch as the display style changes", () => {
  const material = new MeshStandardMaterial();
  const resolved = resolveAppearance(cadAppearance.snapshot());
  applySurfaceAppearance([material], cadDisplayStylePolicy("zebra", true), resolved);
  const node = material as unknown as { colorNode: unknown };
  expect(material.userData.analysis).toBe("zebra");
  expect(node.colorNode).toBeTruthy();
  const zebra = node.colorNode;
  applySurfaceAppearance([material], cadDisplayStylePolicy("draft-analysis", true), resolved);
  expect(material.userData.analysis).toBe("draft");
  expect(node.colorNode).toBeTruthy(); expect(node.colorNode).not.toBe(zebra);
  applySurfaceAppearance([material], cadDisplayStylePolicy("shaded-edges", true), resolved);
  expect(material.userData.analysis).toBe("none");
  expect(node.colorNode).toBeNull();
});
