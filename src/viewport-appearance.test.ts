import { describe, expect, it } from "vitest";
import { cadDisplayStylePolicy, cadFloorVisibility } from "./viewport-appearance";

describe("CAD display style policy", () => {
  it("keeps shaded and shaded-with-edges distinct", () => {
    expect(cadDisplayStylePolicy("shaded", true).edgesVisible).toBe(false);
    expect(cadDisplayStylePolicy("shaded-edges", true).edgesVisible).toBe(true);
    expect(cadDisplayStylePolicy("shaded-edges", false).edgesVisible).toBe(false);
  });

  it("uses surface depth to occlude rear edges in hidden-line mode", () => {
    const policy = cadDisplayStylePolicy("hidden-line", false);
    expect(policy).toMatchObject({
      surfaceWireframe: false,
      surfaceOpacity: 1,
      surfaceDepthWrite: true,
      edgesVisible: true,
      masksSurfaceWithBackground: true,
    });
  });

  it("makes ghost mode translucent without writing depth", () => {
    expect(cadDisplayStylePolicy("ghost", true)).toMatchObject({
      surfaceOpacity: 0.22,
      surfaceDepthWrite: false,
      edgesVisible: true,
    });
  });
});

it("uses the user's environment visibility preference", () => {
  expect(cadFloorVisibility("grid")).toEqual({ grid: true, floor: false });
  expect(cadFloorVisibility("floor")).toEqual({ grid: false, floor: true });
  expect(cadFloorVisibility("both")).toEqual({ grid: true, floor: true });
  expect(cadFloorVisibility("none")).toEqual({ grid: false, floor: false });
});
