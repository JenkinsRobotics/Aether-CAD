import { describe, expect, it } from "vitest";
import { asBuiltConnectorFrames, asBuiltJointDraftIssues, defaultAsBuiltJointDraft, frameInPart, rotate } from "./cad-joint-authoring";

const quarterZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe("as-built joint frames", () => {
  it("rotates by a quaternion and expresses a world frame in a turned part", () => {
    near(rotate(quarterZ, [1, 0, 0]), [0, 1, 0]);
    const local = frameInPart({ origin_m: [1, 1, 0], primary_axis_xyz: [0, 0, 1], secondary_axis_xyz: [1, 0, 0] }, { position_m: [1, 0, 0], rotation_quaternion_xyzw: quarterZ });
    near(local.origin_m, [1, 0, 0]); near(local.primary_axis_xyz, [0, 0, 1]); near(local.secondary_axis_xyz, [0, -1, 0]);
  });
  it("puts the joint at b's origin by default and both connectors agree in the world", () => {
    const a = { position_m: [0, 0, 0] as const, rotation_quaternion_xyzw: [0, 0, 0, 1] as const }, b = { position_m: [0.2, 0.1, 0] as const, rotation_quaternion_xyzw: quarterZ };
    const frames = asBuiltConnectorFrames(a, b);
    near(frames.world.origin_m, [0.2, 0.1, 0]);
    near(frames.a.origin_m, [0.2, 0.1, 0]);
    near(frames.b.origin_m, [0, 0, 0]);
    // b's connector, placed back into the world, lands on the joint frame.
    near(rotate(b.rotation_quaternion_xyzw, frames.b.primary_axis_xyz), frames.world.primary_axis_xyz);
    const custom = asBuiltConnectorFrames(a, b, [0.5, 0, 0], [1, 0, 0]);
    near(custom.world.primary_axis_xyz, [1, 0, 0]); near(custom.world.secondary_axis_xyz, [0, 1, 0]);
  });
  it("needs two different occurrences", () => {
    expect(asBuiltJointDraftIssues(defaultAsBuiltJointDraft)).toEqual(["Choose two occurrences."]);
    expect(asBuiltJointDraftIssues({ ...defaultAsBuiltJointDraft, aInstanceID: "i", bInstanceID: "i" })).toEqual(["Choose two different occurrences."]);
    expect(asBuiltJointDraftIssues({ ...defaultAsBuiltJointDraft, aInstanceID: "i", bInstanceID: "j" })).toEqual([]);
  });
});
