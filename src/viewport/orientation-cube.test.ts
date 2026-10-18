import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import {
  buildOrientationCube,
  orientationCubeFraming,
  disposeOrientationCube,
  paintOrientationHover,
  plateCameraAction,
  plateUnderRay,
} from "./orientation-cube";

const boundsOf = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

describe("the orientation envelope", () => {
  it("is a beveled cube: six faces, twelve edges, eight corners", () => {
    const cube = buildOrientationCube(boundsOf([-50, -30, -20], [50, 30, 20]));
    expect(cube.plates).toHaveLength(6 + 12 + 8);
  });

  it("gives every plate a camera move, so no plate is a dead click", () => {
    const cube = buildOrientationCube(boundsOf([-50, -30, -20], [50, 30, 20]));
    for (const plate of cube.plates) expect(plateCameraAction(plate)).not.toBeNull();
    // Exactly the six flat faces are named views; edges and corners are
    // directions, which is what lets them be diagonal.
    const named = cube.plates.filter((p) => p.userData.view).length;
    expect(named).toBe(6);
  });

  it("names the six views once each", () => {
    const cube = buildOrientationCube(boundsOf([-10, -10, -10], [10, 10, 10]));
    const views = cube.plates.map((p) => p.userData.view).filter(Boolean).sort();
    expect(views).toEqual(["back", "bottom", "front", "left", "right", "top"]);
  });

  it("stays at world origin for offset models and has equal side lengths", () => {
    const cube = buildOrientationCube(boundsOf([100, 200, 300], [140, 240, 340]));
    expect(cube.center.toArray()).toEqual([0, 0, 0]);
    expect(cube.group.position.toArray()).toEqual([0, 0, 0]);
    expect(cube.outer.x).toBe(cube.outer.y);
    expect(cube.outer.y).toBe(cube.outer.z);
  });

  it("keeps a usable size for an empty scene", () => {
    // No model yet: the envelope still has to be big enough to click.
    const cube = buildOrientationCube(new THREE.Box3());
    expect(cube.center.toArray()).toEqual([0, 0, 0]);
    expect(Math.min(cube.outer.x, cube.outer.y, cube.outer.z)).toBeGreaterThan(0);
    expect(cube.plates).toHaveLength(26);
  });

  it("grows with the model", () => {
    const small = buildOrientationCube(boundsOf([-30, -30, -30], [30, 30, 30]));
    const large = buildOrientationCube(boundsOf([-300, -300, -300], [300, 300, 300]));
    expect(large.outer.x).toBeGreaterThan(small.outer.x);
  });

  it("corner directions are unit length and point outward", () => {
    const cube = buildOrientationCube(boundsOf([-10, -10, -10], [10, 10, 10]));
    const corners = cube.plates
      .map((p) => p.userData.direction as number[] | undefined)
      .filter((d): d is number[] => Array.isArray(d) && d.every((v) => Math.abs(v) > 0.4));
    expect(corners).toHaveLength(8);
    for (const d of corners) expect(Math.hypot(...d)).toBeCloseTo(1, 9);
  });

  it("lights only the hovered plate", () => {
    const cube = buildOrientationCube(boundsOf([-10, -10, -10], [10, 10, 10]));
    expect(paintOrientationHover(cube, 3)).toBe(true);
    expect(cube.hover).toBe(3);
    const lit = cube.plates.filter(p => (p.material as THREE.MeshBasicMaterial).color.equals(p.userData.hoverColor));
    expect(lit).toHaveLength(1);
    // -1 means nothing under the pointer, and nothing stays lit.
    expect(paintOrientationHover(cube, -1)).toBe(false);
    expect(cube.plates.every(p => (p.material as THREE.MeshBasicMaterial).color.equals(p.userData.idleColor))).toBe(true);
    expect(cube.plates.every(p => (p.material as THREE.MeshBasicMaterial).transparent && (p.material as THREE.MeshBasicMaterial).opacity === 0.08 && !(p.material as THREE.MeshBasicMaterial).depthWrite)).toBe(true);
  });

  it("disposes without throwing, so reopening does not leak", () => {
    const cube = buildOrientationCube(boundsOf([-10, -10, -10], [10, 10, 10]));
    expect(() => disposeOrientationCube(cube)).not.toThrow();
  });

  it("has no action for a plate that is not there", () => {
    expect(plateCameraAction(undefined)).toBeNull();
  });

  it("ray-picks every shared face, bevel and corner from outside", () => {
    const cube = buildOrientationCube(boundsOf([-50,-20,-5],[50,20,5]));
    cube.group.updateMatrixWorld(true);
    for (const plate of cube.plates) {
      const direction = new THREE.Vector3(...plate.userData.direction as [number,number,number]);
      const ray = new THREE.Raycaster(direction.clone().multiplyScalar(cube.outer.x*4),direction.clone().negate());
      expect(cube.plates[plateUnderRay(cube,ray)]?.userData.regionId).toBe(plate.userData.regionId);
    }
  });
});

it("Z-up and Y-up native cube picks agree with the named camera views", () => {
  for (const axis of ["z", "y"] as const) {
    const cube = buildOrientationCube(new THREE.Box3(), axis);
    const direction = axis === "z" ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1);
    cube.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(direction.clone().multiplyScalar(300), direction.clone().negate());
    const plate = cube.plates[plateUnderRay(cube, ray)];
    expect(plateCameraAction(plate)).toEqual({ view: "front" });
    expect(cube.plates.find(p => p.userData.view === "right")!.userData.direction).toEqual([1, 0, 0]);
    disposeOrientationCube(cube);
  }
});


it("contains offset and separated bodies inside the beveled walls, not just an enclosing box", () => {
  const cases = [
    boundsOf([100,200,300],[140,240,340]),
    boundsOf([-1200,-30,-50],[480,70,180]),
    boundsOf([999990,999990,999990],[1000010,1000010,1000010]),
  ];
  for (const bounds of cases) for (const axis of ["y", "z"] as const) {
    const cube = buildOrientationCube(bounds,axis);
    for (const plate of cube.plates) {
      const normal = new THREE.Vector3(...plate.userData.direction);
      const position = plate.geometry.getAttribute("position");
      const wall = normal.dot(new THREE.Vector3().fromBufferAttribute(position,0));
      for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
        expect(normal.dot(new THREE.Vector3(x,y,z))).toBeLessThan(wall);
      }
    }
    disposeOrientationCube(cube);
  }
});

it("has no rendered labels and stays highly transparent during hover", () => {
  const cube=buildOrientationCube(new THREE.Box3());
  expect(cube.group.children).toEqual(cube.plates);
  paintOrientationHover(cube,0);
  expect((cube.plates[0].material as THREE.MeshBasicMaterial).opacity).toBe(0.18);
  for (const plate of cube.plates) expect((plate.material as THREE.MeshBasicMaterial).map).toBeNull();
  disposeOrientationCube(cube);
});

it("preserves projected cube size across model scales and keeps all facets inside portrait and wide viewports", () => {
  for (const aspect of [0.45,1,2.4]) for (const fov of [25,42,90]) {
    let reference = 0;
    for (const scale of [1,10000]) {
      const cube=buildOrientationCube(boundsOf([-50*scale,-40*scale,-20*scale],[50*scale,40*scale,20*scale]));
      const framing=orientationCubeFraming(cube.outer,fov,aspect);
      const camera=new THREE.PerspectiveCamera(fov,aspect,framing.near,framing.far);
      camera.position.set(1,-1,0.72).normalize().multiplyScalar(framing.distance);
      camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
      let extent=0;
      for (const plate of cube.plates) {
        const points=plate.geometry.getAttribute("position");
        for (let i=0;i<points.count;i++) {
          const p=new THREE.Vector3().fromBufferAttribute(points,i).project(camera);
          expect(Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))).toBeLessThan(1);
          extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
        }
      }
      if (scale===1) reference=extent; else expect(extent).toBeCloseTo(reference,6);
      disposeOrientationCube(cube);
    }
  }
});
