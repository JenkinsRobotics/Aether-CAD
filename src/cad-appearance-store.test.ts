import { describe, expect, it, vi } from "vitest";
import {
  CADAppearanceStore,
  defaultCADAppearance,
  reduceCADAppearance,
} from "./cad-appearance-store";

describe("CADAppearanceStore", () => {
  it("reduces renderer-only appearance settings and clamps light intensity", () => {
    const midnight = reduceCADAppearance(defaultCADAppearance, {
      type: "set-background",
      background: "midnight",
    });
    expect(midnight.background).toBe("midnight");
    expect(reduceCADAppearance(midnight, {
      type: "set-display-style",
      style: "wireframe",
    }).displayStyle).toBe("wireframe");
    expect(reduceCADAppearance(midnight, {
      type: "set-lighting-preset",
      preset: "daylight",
    }).lightingPreset).toBe("daylight");
    expect(reduceCADAppearance(midnight, {
      type: "set-floor-mode",
      mode: "both",
    }).floorMode).toBe("both");
    expect(reduceCADAppearance(midnight, {
      type: "set-environment-percent",
      percent: 240,
    }).environmentPercent).toBe(200);
    expect(reduceCADAppearance(midnight, { type: "reset" })).toBe(defaultCADAppearance);
  });

  it("publishes one snapshot to React and the renderer adapter", () => {
    const store = new CADAppearanceStore();
    const listener = vi.fn();
    const apply = vi.fn();
    store.subscribe(listener);
    store.registerApplyHandler(apply);
    store.dispatch({ type: "set-contact-shadows-visible", visible: false });
    expect(store.snapshot().contactShadowsVisible).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenLastCalledWith(store.snapshot());
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

it("environment themes apply as bundles and manual edits mark custom", () => {
  const onshape = reduceCADAppearance(defaultCADAppearance, { type: "apply-environment-theme", theme: "onshape" });
  expect(onshape).toMatchObject({
    environmentTheme: "onshape",
    background: "onshape",
    floorMode: "none",
    lightingPreset: "daylight",
    contactShadowsVisible: false,
  });
  const tweaked = reduceCADAppearance(onshape, { type: "set-floor-mode", mode: "grid" });
  expect(tweaked.environmentTheme).toBe("custom");
  const back = reduceCADAppearance(tweaked, { type: "apply-environment-theme", theme: "aether" });
  expect(back).toMatchObject({ environmentTheme: "aether", background: "graphite", floorMode: "grid", lightingPreset: "studio" });
  const dimmed = reduceCADAppearance(defaultCADAppearance, { type: "set-grid-opacity-percent", percent: 40 });
  expect(dimmed.gridOpacityPercent).toBe(40);
  expect(dimmed.environmentTheme).toBe("custom");
});

it("validates preview color and opacity without changing lighting or finish", () => {
  const color = reduceCADAppearance(defaultCADAppearance, {type:"set-body-color",color:"#FF3045"});
  expect(color.bodyColor).toBe("#ff3045");
  expect(color.materialFinish).toBe(defaultCADAppearance.materialFinish);
  expect(color.lightingPreset).toBe(defaultCADAppearance.lightingPreset);
  expect(reduceCADAppearance(color,{type:"set-body-color",color:"broken"})).toBe(color);
  expect(reduceCADAppearance(color,{type:"set-body-opacity",percent:150}).bodyOpacityPercent).toBe(100);
  expect(reduceCADAppearance(color,{type:"set-body-opacity",percent:-1}).bodyOpacityPercent).toBe(0);
  expect(reduceCADAppearance(color,{type:"set-body-opacity",percent:NaN})).toBe(color);
});

it("a finish preset clears manual surface overrides", () => {
  const changed=reduceCADAppearance(defaultCADAppearance,{type:"set-roughness",value:0.15});
  expect(changed.roughness).toBe(0.15);
  const preset=reduceCADAppearance(changed,{type:"set-material-finish",finish:"gloss"});
  expect(preset.roughness).toBeUndefined();
  expect(preset.metalness).toBeUndefined();
});

it('validates manual render colors, clamps edges, and returns to presets',()=>{
 const custom=reduceCADAppearance(defaultCADAppearance,{type:'set-render-color',target:'gridMinorColor',color:'#FF0088'});
 expect(custom.gridMinorColor).toBe('#ff0088');
 expect(custom.environmentTheme).toBe('custom');
 expect(reduceCADAppearance(custom,{type:'set-render-color',target:'gridMinorColor',color:'invalid'})).toBe(custom);
 expect(reduceCADAppearance(custom,{type:'set-edge-opacity',percent:200}).edgeOpacityPercent).toBe(100);
 expect(reduceCADAppearance(custom,{type:'reset-render-overrides'}).gridMinorColor).toBeUndefined();
 expect(reduceCADAppearance(custom,{type:'apply-environment-theme',theme:'onshape'}).gridMinorColor).toBe("#84929d");
});
