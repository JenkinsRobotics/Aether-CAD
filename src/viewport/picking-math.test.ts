import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import {
  faceIdForTriangle,
  hoverKey,
  localBounds,
  projectScreenPoint,
  projectedFaceBounds,
  screenRectForPoints,
} from "./picking-math";

describe("which face a click landed on", () => {
  // Tessellation is per face; ranges are offsets into the index buffer, so a
  // triangle index has to be multiplied by three before it is compared.
  const ranges = [
    { start: 0, count: 6, faceId: 11 },
    { start: 6, count: 3, faceId: 22 },
    { start: 9, count: 9, faceId: 33 },
  ];

  it("maps a triangle to the face whose range contains it", () => {
    expect(faceIdForTriangle(ranges, 0)).toBe(11);
    expect(faceIdForTriangle(ranges, 1)).toBe(11);
    expect(faceIdForTriangle(ranges, 2)).toBe(22);
    expect(faceIdForTriangle(ranges, 3)).toBe(33);
    expect(faceIdForTriangle(ranges, 5)).toBe(33);
  });

  it("returns nothing for a triangle past the last face", () => {
    expect(faceIdForTriangle(ranges, 6)).toBeUndefined();
    expect(faceIdForTriangle([], 0)).toBeUndefined();
  });
});

describe("projecting geometry onto the canvas", () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = { width: 800, height: 600 };

  it("puts a point on the view axis at the centre of the canvas", () => {
    const point = projectScreenPoint(new THREE.Vector3(0, 0, 0), camera, canvas);
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(400, 6);
    expect(point!.y).toBeCloseTo(300, 6);
  });

  it("puts y down the screen, the way the DOM measures it", () => {
    const above = projectScreenPoint(new THREE.Vector3(0, 1, 0), camera, canvas)!;
    expect(above.y).toBeLessThan(300);
  });

  it("refuses a point behind the camera", () => {
    expect(projectScreenPoint(new THREE.Vector3(0, 0, 20), camera, canvas)).toBeNull();
  });
});

describe("screen rectangles", () => {
  it("bounds the points it is given", () => {
    expect(screenRectForPoints([
      { x: 10, y: 40 }, { x: 30, y: 5 }, { x: -2, y: 22 },
    ])).toEqual({ left: -2, top: 5, right: 30, bottom: 40 });
  });

  it("is null for no points, so an off-screen face is not a zero-size hit", () => {
    expect(screenRectForPoints([])).toBeNull();
  });

  it("bounds a face through the projector it is handed", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 1, 1, 0], 3));
    geometry.setIndex([0, 1, 2]);
    const rect = projectedFaceBounds(
      geometry,
      new THREE.Matrix4(),
      { start: 0, count: 3, faceId: 1 },
      (world) => ({ x: world.x * 100, y: world.y * 100 }),
    );
    expect(rect).toEqual({ left: 0, top: 0, right: 100, bottom: 100 });
  });

  it("is null when the geometry carries no index", () => {
    expect(projectedFaceBounds(
      new THREE.BufferGeometry(), new THREE.Matrix4(),
      { start: 0, count: 3, faceId: 1 }, () => ({ x: 0, y: 0 }),
    )).toBeNull();
  });
});

describe("part bounds and hover identity", () => {
  it("bounds a part's own vertices", () => {
    const box = localBounds({ vertices: [0, 0, 0, 2, 4, 6] } as never);
    expect([box.min.x, box.min.y, box.min.z]).toEqual([0, 0, 0]);
    expect([box.max.x, box.max.y, box.max.z]).toEqual([2, 4, 6]);
  });

  it("keys hover targets so re-hovering the same thing is a no-op", () => {
    expect(hoverKey(null)).toBe("");
    expect(hoverKey({
      kind: "candidate", part: { data: { id: "p1" } }, candidate: { id: "c9" },
    })).toBe("candidate:p1:c9");
    expect(hoverKey({ kind: "connector", connector: { id: "k3" } })).toBe("connector:k3");
    // Two candidates on different parts must not collide.
    expect(hoverKey({ kind: "candidate", part: { data: { id: "p2" } }, candidate: { id: "c9" } }))
      .not.toBe("candidate:p1:c9");
  });
});
