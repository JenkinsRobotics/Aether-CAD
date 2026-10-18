import { describe, expect, it } from "vitest";
import { resolveAppearance } from "./appearance-themes";

const snapshot = (over: Record<string, unknown> = {}) => ({
  background: "graphite",
  lightingPreset: "studio",
  materialFinish: "satin",
  environmentPercent: 100,
  gridOpacityPercent: 100,
  displayStyle: "shaded",
  edgesVisible: true,
  contactShadowsVisible: true,
  ...over,
}) as never;

describe("resolving a render environment", () => {
  it("gives each environment its own background and grid", () => {
    const midnight = resolveAppearance(snapshot({ background: "midnight" }));
    const onshape = resolveAppearance(snapshot({ background: "onshape" }));
    expect(midnight.background).toBe(0x090d18);
    expect(onshape.background).toBe(0xf2f5f7);
    expect(midnight.gridMajor).not.toBe(onshape.gridMajor);
  });

  it("falls back to graphite for an environment it does not know", () => {
    // A document from a newer build should restyle the view, not break it.
    const unknown = resolveAppearance(snapshot({ background: "chartreuse" }));
    expect(unknown.background).toBe(resolveAppearance(snapshot()).background);
    expect(unknown.sketchStroke).toBe(resolveAppearance(snapshot()).sketchStroke);
  });

  it("scales grid opacity by the user's percentage", () => {
    expect(resolveAppearance(snapshot({ gridOpacityPercent: 50 })).gridOpacity)
      .toBeCloseTo(0.27 * 0.5, 10);
    // Absent means full strength, not zero.
    expect(resolveAppearance(snapshot({ gridOpacityPercent: undefined })).gridOpacity)
      .toBeCloseTo(0.27, 10);
  });

  it("scales every light by the environment percentage", () => {
    const full = resolveAppearance(snapshot()).lights;
    const half = resolveAppearance(snapshot({ environmentPercent: 50 })).lights;
    for (const key of ["hemisphere", "key", "fill", "rim"] as const)
      expect(half[key]).toBeCloseTo(full[key] / 2, 10);
  });

  it("boosts key and fill in a light environment, but not the rim", () => {
    // cad-light carries a 16/12 boost so a pale scene still reads as lit; the
    // rim is left alone, because boosting it washed the silhouette out.
    const graphite = resolveAppearance(snapshot()).lights;
    const light = resolveAppearance(snapshot({ background: "cad-light" })).lights;
    expect(light.key).toBeCloseTo(graphite.key * (16 / 12), 10);
    expect(light.fill).toBeCloseTo(graphite.fill * (16 / 12), 10);
    expect(light.rim).toBeCloseTo(graphite.rim, 10);
    expect(light.hemisphere).toBeCloseTo(graphite.hemisphere, 10);
  });

  it("carries the material finish through", () => {
    expect(resolveAppearance(snapshot({ materialFinish: "gloss" })).finish)
      .toEqual({ roughness: 0.24, metalness: 0.08 });
    expect(resolveAppearance(snapshot({ materialFinish: "matte" })).finish.roughness)
      .toBeGreaterThan(resolveAppearance(snapshot({ materialFinish: "gloss" })).finish.roughness);
  });

  it("provides readable reference planes in every environment", () => {
    expect(resolveAppearance(snapshot({ background: "onshape" })).planeTheme?.style.labelColor)
      .toBe("#2f5bd7");
    expect(resolveAppearance(snapshot({ background: "midnight" })).planeTheme.style.labelColor).toBe('#a9cfff');
    expect(resolveAppearance(snapshot({ background: "cad-light" })).planeTheme.style.borderOpacity).toBeGreaterThan(.55);
  });

  it("each lighting preset is actually different", () => {
    const keys = (["studio", "softbox", "daylight", "dark-room"] as const)
      .map((lightingPreset) => resolveAppearance(snapshot({ lightingPreset })).lights.key);
    expect(new Set(keys).size).toBe(4);
  });
});

it("resolves preview color and transparency with safe legacy fallbacks", () => {
  expect(resolveAppearance(snapshot({bodyColor:"#ff3045",bodyOpacityPercent:35}))).toMatchObject({bodyColor:0xff3045,bodyOpacity:0.35});
  expect(resolveAppearance(snapshot({bodyColor:"invalid",bodyOpacityPercent:NaN}))).toMatchObject({bodyColor:0x79a9c2,bodyOpacity:1});
});

it("uses physical surface overrides and clamps them", () => {
  expect(resolveAppearance(snapshot({roughness:0.1,metalness:0.9})).finish).toEqual({roughness:0.1,metalness:0.9});
  expect(resolveAppearance(snapshot({roughness:-1,metalness:2})).finish).toEqual({roughness:0,metalness:1});
});

it('manual colors outrank suite palettes and invalid colors fall back',()=>{
 const result=resolveAppearance(snapshot({backgroundColor:'#123456',gridMinorColor:'#ff0000',gridMajorColor:'#00ff00',edgeColor:'#0000ff',edgeOpacityPercent:35}),{background:0xffffff,gridMinor:0xffffff,gridMajor:0xffffff});
 expect(result.background).toBe(0x123456);
 expect(result.gridMinor).toBe(0xff0000);
 expect(result.gridMajor).toBe(0x00ff00);
 expect(result.edgeColor).toBe(0x0000ff);
 expect(result.edgeOpacity).toBe(.35);
 expect(resolveAppearance(snapshot({gridMinorColor:'bad'}),{gridMinor:0xabcdef}).gridMinor).toBe(0xabcdef);
});
