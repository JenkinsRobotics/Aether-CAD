import { describe, expect, it } from "vitest";
import {
  HOLE_THREAD_STANDARDS, capScrewCounterboreFor, countersunkScrewFor, isHoleThreadStandard,
  standardHoleDiameter, threadDesignations, threadSpecification,
} from "./hole-standards";

describe("hole standards", () => {
  it("lists the six standards with sizes smallest first", () => {
    expect(HOLE_THREAD_STANDARDS).toEqual(["iso-metric-coarse", "iso-metric-fine", "unc", "unf", "bsp", "npt"]);
    expect(threadDesignations("bsp")[0]).toBe("G1/8");
    expect(threadDesignations("iso-metric-coarse").slice(0, 4)).toEqual(["M1.6", "M2", "M2.5", "M3"]);
    expect(threadDesignations("unc")[4]).toBe("1/4-20");
    expect(isHoleThreadStandard("unc")).toBe(true);
    expect(isHoleThreadStandard("bsw")).toBe(false);
  });

  it("gives ISO tap drills and clearance fits for metric coarse threads", () => {
    const m8 = threadSpecification("iso-metric-coarse", "m8")!;
    expect(m8.pitchMillimeters).toBe(1.25);
    expect(m8.tapDrillMillimeters).toBe(6.8);
    expect(m8.minorDiameterMillimeters).toBeCloseTo(8 - 1.0825 * 1.25, 3);
    expect(standardHoleDiameter(m8, true)).toBe(6.8);
    expect(standardHoleDiameter(m8, false)).toBe(9);
    expect(standardHoleDiameter(m8, false, "close")).toBe(8.4);
    expect(standardHoleDiameter(m8, false, "loose")).toBe(10);
    expect(threadSpecification("iso-metric-coarse", "M12")!.tapDrillMillimeters).toBe(10.2);
  });

  it("derives fine-pitch tap drills as D − P and interpolates clearance for intermediate sizes", () => {
    const fine = threadSpecification("iso-metric-fine", "M10x1.25")!;
    expect(fine.tapDrillMillimeters).toBe(8.75);
    expect(fine.clearanceMillimeters).toEqual({ close: 10.5, normal: 11, loose: 12 });
    const m18 = threadSpecification("iso-metric-fine", "M18x1.5")!;
    expect(m18.clearanceMillimeters).toEqual({ close: 19, normal: 20, loose: 21 });
    expect(threadSpecification("iso-metric-fine", "M8")).toBeUndefined();
  });

  it("converts unified threads to millimetres", () => {
    const quarter = threadSpecification("unc", "1/4-20")!;
    expect(quarter.majorDiameterMillimeters).toBeCloseTo(6.35, 3);
    expect(quarter.pitchMillimeters).toBeCloseTo(1.27, 3);
    expect(quarter.tapDrillMillimeters).toBe(5.11);
    expect(quarter.clearanceMillimeters.normal).toBeCloseTo(6.76, 2);
    expect(threadSpecification("unf", "#10-32")!.tapDrillMillimeters).toBe(4.04);
  });

  it("offers cap screw counterbores and countersunk heads for metric sizes only", () => {
    const m6 = threadSpecification("iso-metric-coarse", "M6")!;
    expect(capScrewCounterboreFor(m6)).toEqual({ diameterMillimeters: 11, depthMillimeters: 6 });
    expect(countersunkScrewFor(m6)).toEqual({ diameterMillimeters: 13.44, angleDegrees: 90 });
    expect(capScrewCounterboreFor(threadSpecification("iso-metric-coarse", "M2")!)).toBeUndefined();
    expect(capScrewCounterboreFor(threadSpecification("unc", "1/4-20")!)).toBeUndefined();
  });
});
