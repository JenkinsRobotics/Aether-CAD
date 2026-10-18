import { describe, expect, it } from "vitest";
import { readViewportThemeOverride } from "./suite-viewport-theme";
import { resolveAppearance } from "./appearance-themes";
import { defaultCADAppearance } from "../cad-appearance-store";

describe("suite viewport theme", () => {
  it("stands aside when no viewport theme is chosen", () => {
    expect(readViewportThemeOverride(null)).toBeNull();
  });

  it("outranks the render environment for the stage but never for lighting or finish", () => {
    const plain = resolveAppearance(defaultCADAppearance);
    const themed = resolveAppearance(defaultCADAppearance, { background: 0x123456, sketchStroke: 0xabcdef });
    expect(themed.background).toBe(0x123456);
    expect(themed.sketchStroke).toBe(0xabcdef);
    expect(themed.gridMinor).toBe(plain.gridMinor);
    expect(themed.lights).toEqual(plain.lights);
    expect(themed.finish).toEqual(plain.finish);
  });

  it("leaves each value CAD's own when the theme does not define it", () => {
    const plain = resolveAppearance(defaultCADAppearance);
    const partial = resolveAppearance(defaultCADAppearance, { background: 0x010203 });
    expect(partial.background).toBe(0x010203);
    expect(partial.gridMajor).toBe(plain.gridMajor);
    expect(partial.sketchStroke).toBe(plain.sketchStroke);
  });
});
