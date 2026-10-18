import { createRequire as createAssetRequire } from "node:module";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sketchTextOutline } from "./outline";
import { contourClosed } from "../drawing";
it("generates distinct closed CAD profiles from all four bundled font styles", async () => {
  const outlines = new Set<string>();
  for (const style of ["Regular", "Bold", "Italic", "BoldItalic"]) {
    const font = Uint8Array.from(
      readFileSync(
        createAssetRequire(import.meta.url).resolve(`@aether/assets/fonts/noto-sans/NotoSans-${style}.ttf`),
      ),
    ).buffer;
    const drawing = await sketchTextOutline(font, "Aether CAD 08", {
      emSizeMillimeters: 10,
    });
    expect(drawing.contours.length).toBeGreaterThan(10);
    expect(drawing.contours.every(contourClosed)).toBe(true);
    expect(drawing.contours.some((c) => c.hole)).toBe(true);
    expect(
      drawing.contours.some(
        (c) => c.type === "path" && c.segments.some((s) => s.type === "bezier"),
      ),
    ).toBe(true);
    outlines.add(JSON.stringify(drawing));
  }
  expect(outlines.size).toBe(4);
}, 30000);
