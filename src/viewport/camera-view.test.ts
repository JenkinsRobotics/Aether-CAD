import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  cameraViewDefinition,
  cameraUpForDirection,
  nudgeCameraBasis,
  rollCameraBasis,
  standardCameraViews,
} from "./camera-view";

describe("standard camera views", () => {
  it("provides all six principal directions plus three axonometric viewpoints", () => {
    expect(standardCameraViews.map((view) => view.id)).toEqual([
      "isometric",
      "dimetric",
      "trimetric",
      "front",
      "back",
      "left",
      "right",
      "top",
      "bottom",
    ]);
  });

  it("uses a non-collinear up vector for the top view", () => {
    const top = cameraViewDefinition("top", "y");
    expect(top.direction).toEqual([0, 1, 0]);
    expect(top.up).toEqual([0, 0, -1]);
  });

  it("nudges the orbit basis in deterministic 15 degree increments", () => {
    const radians = Math.PI / 12;
    const horizontal = nudgeCameraBasis(
      { direction: [0, 0, 1], up: [0, 1, 0] },
      radians,
      0,
    );
    expect(horizontal.direction[0]).toBeCloseTo(Math.sin(radians));
    expect(horizontal.direction[2]).toBeCloseTo(Math.cos(radians));

    const vertical = nudgeCameraBasis(
      { direction: [0, 0, 1], up: [0, 1, 0] },
      0,
      radians,
    );
    expect(vertical.direction[1]).toBeCloseTo(Math.sin(radians));
    expect(vertical.direction[2]).toBeCloseTo(Math.cos(radians));
  });

  it("rolls by 90 degrees while retaining an orthonormal camera basis", () => {
    const rolled = rollCameraBasis(
      { direction: [0, 0, 1], up: [0, 1, 0] },
      Math.PI / 2,
    );
    expect(rolled.direction).toEqual([0, 0, 1]);
    expect(rolled.up[0]).toBeCloseTo(-1);
    expect(rolled.up[1]).toBeCloseTo(0);
  });
});

it.each(['y', 'z'] as const)('uses screen-relative arrows at every principal view, including after roll (%s-up)', axis => {
  const angle = Math.PI / 12;
  for (const view of ['front', 'back', 'left', 'right', 'top', 'bottom'] as const) {
    for (const roll of [0, Math.PI / 2, Math.PI]) {
      const initial = rollCameraBasis(cameraViewDefinition(view, axis), roll);
      const direction = new Vector3(...initial.direction), up = new Vector3(...initial.up);
      const right = new Vector3().crossVectors(up, direction);
      for (const sign of [-1, 1]) {
        const horizontal = nudgeCameraBasis(initial, sign * angle, 0);
        expect(new Vector3(...horizontal.direction).dot(direction)).toBeCloseTo(Math.cos(angle), 10);
        expect(new Vector3(...horizontal.direction).dot(right)).toBeCloseTo(sign * Math.sin(angle), 10);
        expect(new Vector3(...horizontal.up).distanceTo(up)).toBeLessThan(1e-10);
        const vertical = nudgeCameraBasis(initial, 0, sign * angle);
        expect(new Vector3(...vertical.direction).dot(up)).toBeCloseTo(sign * Math.sin(angle), 10);
        expect(new Vector3(...vertical.direction).dot(right)).toBeCloseTo(0, 10);
      }
    }
  }
});

 it("defaults to Z-up with Top on XY and preserves X when choosing Y-up", () => {
   expect(cameraViewDefinition("front").direction).toEqual([0, -1, 0]);
   expect(cameraViewDefinition("front").up).toEqual([0, 0, 1]);
   expect(cameraViewDefinition("top").direction).toEqual([0, 0, 1]);
   expect(cameraViewDefinition("top").up).toEqual([0, 1, 0]);
   for (const axis of ["y", "z"] as const) {
     expect(cameraViewDefinition("right", axis).direction).toEqual([1, 0, 0]);
     expect(cameraViewDefinition("left", axis).direction).toEqual([-1, 0, 0]);
   }
 });
 it("nudges horizontally around screen up when Front uses Z-up", () => {
   const basis = nudgeCameraBasis({ direction: [0, -1, 0], up: [0, 0, 1] }, Math.PI/12, 0);
   expect(basis.direction[0]).toBeCloseTo(Math.sin(Math.PI/12));
   expect(basis.direction[1]).toBeCloseTo(-Math.cos(Math.PI/12));
   expect(basis.direction[2]).toBeCloseTo(0);
   expect(basis.up).toEqual([0, 0, 1]);
 });

it("uses non-collinear up vectors when leaving a Top sketch view in either workspace", () => {
  expect(cameraUpForDirection([0, 0, 100], "z")).toEqual([0, 1, 0]);
  expect(cameraUpForDirection([0, 100, 0], "y")).toEqual([0, 0, -1]);
});

it("isometric has three equal projected axis lengths, dimetric two, and trimetric three distinct lengths", () => {
  for (const axis of ["z", "y"] as const) {
    const lengths = (view: "isometric" | "dimetric" | "trimetric") => {
      const d=cameraViewDefinition(view,axis).direction;
      const length=Math.hypot(...d);
      return d.map(v=>Math.sqrt(1-(v/length)**2)).sort();
    };
    const iso=lengths("isometric");
    expect(iso[0]).toBeCloseTo(iso[1]);expect(iso[1]).toBeCloseTo(iso[2]);
    const di=lengths("dimetric");
    expect(di[0]).toBeCloseTo(di[1]);expect(di[1]).not.toBeCloseTo(di[2]);
    const tri=lengths("trimetric");
    expect(tri[0]).not.toBeCloseTo(tri[1]);expect(tri[1]).not.toBeCloseTo(tri[2]);
  }
});
