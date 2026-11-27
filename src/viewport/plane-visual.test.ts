import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { tintPlane } from "./plane-visual";

/** A stand-in for a reference plane: a filled surface and its outline.
 *  Built here rather than through `createPlaneVisual`, which needs a DOM for
 *  its label canvas — tinting does not, which is why it is testable at all. */
const plane = (fillOpacity = 0.055) => {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshBasicMaterial({ color: 0x336699, transparent: true, opacity: fillOpacity }),
    ),
    new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(110, 110)),
      new THREE.LineBasicMaterial({ color: 0x4477aa, transparent: true, opacity: 0.4 }),
    ),
  );
  return group;
};

const state = (group: THREE.Object3D) =>
  group.children.map((child) => {
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    return [material.color.getHex(), material.opacity] as const;
  });

describe("tinting a reference plane", () => {
  it("colours every part, and restores exactly what it was built with", () => {
    const group = plane();
    const before = state(group);
    tintPlane(group, 0xff0000);
    expect(state(group).every(([color]) => color === 0xff0000)).toBe(true);
    tintPlane(group, null);
    expect(state(group)).toEqual(before);
  });

  it("does not ratchet brighter when tinted repeatedly", () => {
    // The boost multiplies the remembered base, not the current value —
    // otherwise tinting twice would march a datum plane towards opaque.
    const group = plane();
    tintPlane(group, 0xff0000);
    const once = state(group).map(([, opacity]) => opacity);
    tintPlane(group, 0x00ff00);
    tintPlane(group, 0xff0000);
    expect(state(group).map(([, opacity]) => opacity)).toEqual(once);
  });

  it("boosts opacity so the authoring plane reads stronger than a datum", () => {
    const group = plane(0.1);
    tintPlane(group, 0xff0000);
    expect(state(group)[0][1]).toBeCloseTo(0.22, 10);
  });

  it("never pushes opacity past fully opaque", () => {
    const group = plane(0.9);
    tintPlane(group, 0xff0000);
    for (const [, opacity] of state(group)) expect(opacity).toBeLessThanOrEqual(1);
  });

  it("leaves a group with nothing to tint alone", () => {
    expect(() => tintPlane(new THREE.Group(), 0xff0000)).not.toThrow();
  });
});
