import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "../kernel/node-kernel";
import { evaluatePartDocument } from "../kernel/part-evaluator";
import { solveAssemblyJob } from "../kernel/assembly-solver";
import { driveJoint, findJointLimits, solveAssemblyIK, sweepJoint } from "../kernel/assembly-kinematics";
import {
  bomToCSV,
  buildAssemblyBom,
  computeAssemblyMassProperties,
  exportAssemblyURDF,
  renumberBomItems,
  setBomItemNumber,
  type AssemblyOccurrenceMass,
} from "./index";
import {
  createRectanglePartDocument,
  resolveFastenerSeats,
  standardPartDocument,
  standardPartLibrary,
  standardPartVolume,
  type PartFeature,
} from "../document/index";
import type { AssemblyJobInput } from "../contracts/assembly";

describe("SolidCraft 0.47 Parity — Assembly Kinematics, Mass/BOM, Fasteners & URDF", () => {
  it("enforces joint limits and evaluates periodic piecewise-linear cam relations", () => {
    const camJob = (camAngleDeg: number): AssemblyJobInput => ({
      parts: [{ id: "p" }],
      instances: [
        { id: "base", part: "p", grounded: true },
        { id: "cam", part: "p", placement_mm: [0, 0, 0] },
        { id: "follower", part: "p", placement_mm: [0, 0, 0] },
      ],
      joints: [
        {
          id: "j-cam",
          kind: "revolute",
          a: { instance: "base" },
          b: { instance: "cam" },
          parameters: { dofs: [{ name: "rotation", kind: "rotation", axis: "z", value: camAngleDeg, min_value: 0, max_value: 360 }] },
        },
        {
          id: "j-foll",
          kind: "prismatic",
          a: { instance: "base" },
          b: { instance: "follower" },
          parameters: { limits: [{ dof: "translation", min: 0, max: 25 }] },
        },
      ],
      relations: [
        {
          id: "cam-rel",
          kind: "cam",
          driver: { joint: "j-cam", dof: "rotation" },
          driven: { joint: "j-foll", dof: "translation" },
          ratio: 1,
          periodic: true,
          camTable: [[0, 0], [180, 20], [360, 0]],
        },
      ],
    });

    // At 90° the follower lift should be halfway = 10 mm along +Z
    const s90 = solveAssemblyJob(camJob(90));
    expect(s90.status).toBe("ok");
    const foll90 = s90.instances.find((i) => i.id === "follower")!;
    expect(foll90.placement_mm[2]).toBeCloseTo(10, 4);

    // At 270° it returns to 10 mm
    const s270 = solveAssemblyJob(camJob(270));
    expect(s270.status).toBe("ok");
    expect(s270.instances.find((i) => i.id === "follower")!.placement_mm[2]).toBeCloseTo(10, 4);

    // Violating joint limit (>360°) fails cleanly with diagnostic
    const overLimit = solveAssemblyJob(camJob(400));
    expect(overLimit.status).toBe("error");
    expect(overLimit.message).toMatch(/Joint limit violated/);
  });

  it("solves 2-link planar arm Inverse Kinematics (joint.reach), drives with contact stop, sweeps, and finds limits", () => {
    const twoLinkArm: AssemblyJobInput = {
      parts: [{ id: "link" }],
      instances: [
        { id: "base", part: "link", grounded: true },
        { id: "link1", part: "link", placement_mm: [0, 0, 0] },
        { id: "link2", part: "link", placement_mm: [100, 0, 0] },
      ],
      joints: [
        {
          id: "j1",
          kind: "revolute",
          a: { instance: "base", placement_mm: [0, 0, 0] },
          b: { instance: "link1", placement_mm: [0, 0, 0] },
          parameters: { limits: [{ dof: "rotation", min: -170, max: 170 }] },
        },
        {
          id: "j2",
          kind: "revolute",
          a: { instance: "link1", placement_mm: [100, 0, 0] },
          b: { instance: "link2", placement_mm: [0, 0, 0] },
          parameters: { limits: [{ dof: "rotation", min: -170, max: 170 }] },
        },
      ],
    };

    // Reach (100, 100, 0) with tip at local [100, 0, 0] on link2 -> exact solution is (0°, 90°) or (90°, -90°)
    const ik = solveAssemblyIK(twoLinkArm, {
      targetInstanceId: "link2",
      localPointMm: [100, 0, 0],
      targetWorldMm: [100, 100, 0],
      toleranceMm: 0.1,
    });
    expect(ik.status).toBe("ok");
    expect(ik.reached).toBe(true);
    expect(ik.positionErrorMm).toBeLessThan(0.05);

    // Drive joint j1 with simulated obstacle contact when link1 rotation > 45° (y of [100,0,0] > 70.7)
    const driven = driveJoint(twoLinkArm, "j1", "rotation", 90, {
      fromValue: 0,
      steps: 18,
      isInContact: (sol) => {
        const l2 = sol.instances.find((i) => i.id === "link2")!;
        return l2.placement_mm[1] > 71;
      },
    });
    expect(driven.stoppedAt).toBe("contact");
    expect(driven.achievedValue).toBeGreaterThanOrEqual(40);
    expect(driven.achievedValue).toBeLessThanOrEqual(50);

    // Sweep j1 from 0° to 90°
    const sweep = sweepJoint(twoLinkArm, "j1", "rotation", 0, 90, 5);
    expect(sweep.okCount).toBe(5);
    expect(sweep.failedCount).toBe(0);

    // Find feasible limits with contact wall at y > 50 (30°) and y < -50 (-30°)
    const limits = findJointLimits(twoLinkArm, "j1", "rotation", -90, 90, {
      originValue: 0,
      coarseSteps: 18,
      precision: 0.5,
      isInContact: (sol) => Math.abs(sol.instances.find((i) => i.id === "link2")!.placement_mm[1]) > 50,
    });
    expect(limits.maxFeasible).toBeGreaterThan(28);
    expect(limits.maxFeasible).toBeLessThan(31);
    expect(limits.minFeasible).toBeLessThan(-28);
    expect(limits.minFeasible).toBeGreaterThan(-31);
  });

  it("computes parallel-axis assembly mass/COM/inertia, builds hierarchical/flattened BOMs, and exports ROS URDF", () => {
    const occs: AssemblyOccurrenceMass[] = [
      {
        instanceId: "inst-base", partId: "p-base", partNumber: "PN-100", name: "Base",
        material: "Steel", bomType: "normal", rigidGroupId: "rg-1",
        massKg: 2, volumeMm3: 254777, centerOfMassLocalMm: [0, 0, 0], inertiaLocalKgMm2: [100, 100, 100, 0, 0, 0],
        placementMm: [0, 0, 0], rotation: [0, 0, 0, 1],
      },
      {
        instanceId: "inst-arm", partId: "p-arm", partNumber: "PN-200", name: "Arm",
        material: "6061-T6", bomType: "normal", rigidGroupId: "rg-1",
        massKg: 2, volumeMm3: 740740, centerOfMassLocalMm: [0, 0, 0], inertiaLocalKgMm2: [100, 100, 100, 0, 0, 0],
        placementMm: [100, 0, 0], rotation: [0, 0, 0, 1],
      },
      {
        instanceId: "inst-ref", partId: "p-ref", partNumber: "PN-REF", name: "Jig Reference",
        material: "Steel", bomType: "reference",
        massKg: 50, volumeMm3: 999999, centerOfMassLocalMm: [0, 0, 0],
        placementMm: [500, 0, 0], rotation: [0, 0, 0, 1],
      },
      {
        instanceId: "inst-kit", partId: "p-kit", partNumber: "PN-KIT", name: "Hardware Kit",
        bomType: "phantom", massKg: 0, volumeMm3: 0, centerOfMassLocalMm: [0, 0, 0],
        placementMm: [0, 0, 0], rotation: [0, 0, 0, 1],
      },
      {
        instanceId: "inst-bolt1", partId: "p-bolt", partNumber: "ISO-4762-M6", name: "M6 Bolt",
        parentInstanceId: "inst-kit", bomType: "purchased", massKg: 0, volumeMm3: 0,
        centerOfMassLocalMm: [0, 0, 0], placementMm: [0, 0, 0], rotation: [0, 0, 0, 1],
      },
      {
        instanceId: "inst-bolt2", partId: "p-bolt", partNumber: "ISO-4762-M6", name: "M6 Bolt",
        parentInstanceId: "inst-kit", bomType: "purchased", massKg: 0, volumeMm3: 0,
        centerOfMassLocalMm: [0, 0, 0], placementMm: [10, 0, 0], rotation: [0, 0, 0, 1],
      },
    ];

    const mass = computeAssemblyMassProperties(occs);
    // Reference jig (50 kg) must be excluded! Total = 2 + 2 = 4 kg, COM = [50, 0, 0]
    expect(mass.totalMassKg).toBeCloseTo(4, 9);
    expect(mass.excludedReferenceCount).toBe(1);
    expect(mass.centerOfMassWorldMm).toEqual([50, 0, 0]);
    // Parallel axis: Izz = 100 + 2*50^2 + 100 + 2*50^2 = 10200 kg·mm²
    expect(mass.inertiaWorldKgMm2.izz).toBeCloseTo(10200, 6);
    expect(mass.inertiaWorldKgMm2.ixx).toBeCloseTo(200, 6);
    expect(mass.rigidGroups["rg-1"].massKg).toBeCloseTo(4, 9);

    // Flattened BOM excludes reference & phantom, groups M6 bolts to qty=2
    const flatBom = buildAssemblyBom(occs, "flattened");
    expect(flatBom.map((r) => [r.partNumber, r.quantity])).toEqual([
      ["PN-100", 1],
      ["PN-200", 1],
      ["ISO-4762-M6", 2],
    ]);
    // Hierarchical BOM promotes phantom kit's bolts to root
    const hierBom = buildAssemblyBom(occs, "hierarchical");
    expect(hierBom.some((r) => r.partNumber === "ISO-4762-M6" && r.quantity === 2)).toBe(true);
    expect(hierBom.some((r) => r.partNumber === "PN-KIT")).toBe(false);

    // Lock an item number and renumber around it
    const locked = setBomItemNumber(flatBom, "PN-200", "20", true);
    expect(() => setBomItemNumber(locked, "PN-100", "20", true)).toThrow(/already in use/);
    const renumbered = renumberBomItems(locked, { start: 10, step: 10, preserveLocked: true });
    expect(renumbered.map((r) => [r.partNumber, r.itemNumber])).toEqual([
      ["PN-100", "10"],
      ["PN-200", "20"],
      ["ISO-4762-M6", "30"],
    ]);
    expect(bomToCSV(renumbered)).toContain("ISO-4762-M6");

    // URDF export with SI conversion (mm->m, deg->rad)
    const urdf = exportAssemblyURDF({
      robotName: "Test Bot",
      occurrences: occs.slice(0, 2),
      joints: [
        {
          id: "shoulder",
          kind: "revolute",
          a: { instance: "inst-base", placement_mm: [100, 0, 0] },
          b: { instance: "inst-arm" },
          parameters: { limits: [{ dof: "rotation", min: -90, max: 90 }] },
        },
      ],
    });
    expect(urdf).toContain('<robot name="Test_Bot">');
    expect(urdf).toContain('type="revolute"');
    expect(urdf).toContain('xyz="0.1 0 0"');
    expect(urdf).toContain('lower="-1.570796" upper="1.570796"');
  });

  it("expands standard parts (M2–M30, button/countersunk, ASME inch) and resolves cylindrical fastener seats from OCCT topology", async () => {
    const lib = standardPartLibrary();
    expect(lib.length).toBe(13);
    expect(lib.find((e) => e.family === "socket_head_cap_screw")?.sizes).toContain("M2");
    expect(lib.find((e) => e.family === "socket_head_cap_screw")?.sizes).toContain("M30");
    expect(lib.find((e) => e.family === "asme_hex_bolt")?.sizes).toContain("1/4-20");

    // Generate button-head, countersunk, and ASME 1/4-20 screws and check positive analytic volumes
    const csk = standardPartDocument({ family: "countersunk_screw", size: "M6", length: 16 });
    expect(csk.features.some((f) => f.type === "loft")).toBe(true);
    expect(standardPartVolume({ family: "countersunk_screw", size: "M6", length: 16 })).toBeGreaterThan(400);
    expect(standardPartVolume({ family: "asme_socket_screw", size: "1/4-20", length: 25.4 })).toBeGreaterThan(700);

    // Build a real plate with a Ø6.4 mm M6 clearance bore in OCCT and detect its fastener seat
    await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)));
    const plate = createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 40, depthMillimeters: 10 });
    plate.features.push(
      { id: "p-hole", type: "profile", name: "HoleProfile", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: 3.2 } } as PartFeature,
      { id: "e-hole", type: "extrude", name: "HoleCut", profileFeatureId: "p-hole", distanceMillimeters: 10, operation: "cut", suppressed: false } as PartFeature,
    );
    const geom = evaluatePartDocument(plate);
    const seats = resolveFastenerSeats(geom.parts[0].topology);
    expect(seats).toHaveLength(1);
    expect(seats[0].boreDiameterMillimeters).toBeCloseTo(6.4, 2);
    expect(seats[0].depthMillimeters).toBeCloseTo(10, 2);
    expect(seats[0].recommendedMetricSize).toBe("M6");
    expect(seats[0].recommendedInchSize).toBe("1/4-20");
  }, 30_000);
});
