import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { itemsInsideSelectionBox, type SelectablePart } from "./box-selection";

/** A part whose surface is a unit box at the origin, with one face range and
 *  one topology entry carrying an edge midpoint and a vertex. */
function part(id: string, options: { visible?: boolean } = {}): SelectablePart {
  const geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  geometry.setIndex([...Array(geometry.getAttribute("position").count).keys()]);
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  surface.updateMatrixWorld(true);
  return {
    data: { id, name: `Part ${id}` },
    group: { visible: options.visible ?? true, matrixWorld: new THREE.Matrix4() },
    surface: surface as never,
    faceRanges: [{ start: 0, count: 6, faceId: 7 }],
    topology: new Map([[7, {
      id: 7,
      surfaceType: "PLANE",
      candidates: [
        { id: "m1", kind: "edge-midpoint", label: "Edge 1", origin: [0, 0, 0] },
        { id: "v1", kind: "vertex", label: "Vertex 1", origin: [10, 10, 0] },
      ],
    } as never]]),
  };
}

/** Project x/y straight through, so screen space is world space. */
const flat = (world: THREE.Vector3) => ({ x: world.x, y: world.y });
const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom });

describe("what a drag rectangle selects", () => {
  it("Window needs the whole body inside; Crossing only needs a touch", () => {
    // The box spans -1..1. A rectangle covering only its left half touches it
    // but does not contain it.
    const half = rect(-5, -5, 0, 5);
    expect(itemsInsideSelectionBox([part("a")], "body", "window", half, flat)).toHaveLength(0);
    expect(itemsInsideSelectionBox([part("a")], "body", "crossing", half, flat)).toHaveLength(1);
    // A rectangle around the whole thing satisfies both.
    const all = rect(-5, -5, 5, 5);
    expect(itemsInsideSelectionBox([part("a")], "body", "window", all, flat)).toHaveLength(1);
  });

  it("selects nothing when the rectangle is somewhere else entirely", () => {
    expect(itemsInsideSelectionBox([part("a")], "body", "crossing", rect(50, 50, 60, 60), flat))
      .toHaveLength(0);
  });

  it("skips hidden parts", () => {
    expect(itemsInsideSelectionBox([part("a", { visible: false })], "body", "crossing", rect(-5, -5, 5, 5), flat))
      .toHaveLength(0);
  });

  it("labels a body and a component differently from the same geometry", () => {
    const all = rect(-5, -5, 5, 5);
    expect(itemsInsideSelectionBox([part("a")], "body", "window", all, flat)[0])
      .toMatchObject({ id: "body:a", kind: "body", detail: "Exact Body" });
    expect(itemsInsideSelectionBox([part("a")], "component", "window", all, flat)[0])
      .toMatchObject({ id: "component:a", kind: "component", detail: "Component occurrence" });
  });

  it("selects faces, carrying the surface type through as the detail", () => {
    const found = itemsInsideSelectionBox([part("a")], "face", "crossing", rect(-5, -5, 5, 5), flat);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "face:a:7", kind: "face", faceId: 7, detail: "PLANE" });
  });

  it("selects an edge midpoint or a vertex by containment, not by overlap", () => {
    // The midpoint sits at the origin, the vertex out at (10,10). A point has
    // no extent, so Window and Crossing cannot differ for it.
    const nearOrigin = rect(-1, -1, 1, 1);
    expect(itemsInsideSelectionBox([part("a")], "edge", "crossing", nearOrigin, flat))
      .toMatchObject([{ id: "edge:a:m1", detail: "Exact edge" }]);
    expect(itemsInsideSelectionBox([part("a")], "vertex", "crossing", nearOrigin, flat))
      .toHaveLength(0);
    expect(itemsInsideSelectionBox([part("a")], "vertex", "crossing", rect(5, 5, 15, 15), flat))
      .toMatchObject([{ id: "vertex:a:v1", detail: "Exact vertex" }]);
  });

  it("ignores anything the projector cannot place on screen", () => {
    // Behind the camera: the real projector returns null, and nothing it
    // refuses may end up selected.
    expect(itemsInsideSelectionBox([part("a")], "body", "crossing", rect(-5, -5, 5, 5), () => null))
      .toHaveLength(0);
  });

  it("returns each item once, even across several parts", () => {
    const found = itemsInsideSelectionBox([part("a"), part("b")], "body", "crossing", rect(-5, -5, 5, 5), flat);
    expect(found.map((item) => item.id)).toEqual(["body:a", "body:b"]);
    expect(new Set(found.map((item) => item.id)).size).toBe(found.length);
  });
});
