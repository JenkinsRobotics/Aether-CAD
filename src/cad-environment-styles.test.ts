import { expect, it } from 'vitest';
import { defaultCADAppearance, normalizeCADAppearance, reduceCADAppearance } from './cad-appearance-store';
import { captureEnvironment } from './cad-environment-presets';
import { resolveAppearance } from './viewport/appearance-themes';
import { EnvironmentGrid } from './viewport/environment-grid';
import { environmentLightDirection } from './viewport/environment-light-direction';
import type { styledLines } from './viewport/styled-lines';

it.each(['fusion360', 'onshape', 'blender'] as const)('%s replaces previous manual values and survives saved-preset reload', theme => {
  const a = reduceCADAppearance({...defaultCADAppearance, activePresetId:'old', gridSpacingMillimeters:77, roughness:.99, edgeWidthPx:7}, {type:'apply-environment-theme',theme});
  expect(a.activePresetId).toBeUndefined(); expect(a.gridSpacingMillimeters).not.toBe(77); expect(a.roughness).not.toBe(.99);
  expect(a.edgeWidthPx).not.toBe(7); expect(normalizeCADAppearance(a)).toEqual(a);
  const r = resolveAppearance(a), saved = captureEnvironment(a);
  expect(resolveAppearance(normalizeCADAppearance(JSON.parse(JSON.stringify(saved))))).toEqual(r);
  const suite = resolveAppearance(a, {background:0x010101,gridMinor:0xffffff,gridMajor:0xffffff,gridOpacityScale:.01,sketchStroke:0xffffff});
  expect(suite.background).toBe(r.background); expect(suite.gridOpacity).toBe(r.gridOpacity); expect(suite.sketchStroke).toBe(r.sketchStroke);
});

it('draws separate X/Y ground axes, changes to X/Z in Y-up, and keeps grid geometry stable', () => {
  const r = resolveAppearance({...defaultCADAppearance, gridXAxisColor:'#ff0000', gridYAxisColor:'#00ff00', gridZAxisColor:'#0000ff'});
  const grid = new EnvironmentGrid(); grid.apply(r);
  const [, , x, cross] = grid.children as ReturnType<typeof styledLines>[];
  expect(x.material.color.getHex()).toBe(0xff0000); expect(cross.material.color.getHex()).toBe(0x00ff00);
  expect(x.geometry.instanceCount).toBe(1); expect(cross.geometry.instanceCount).toBe(1);
  const geometry = cross.geometry; grid.setUpAxis('y'); grid.apply(r);
  expect(cross.geometry).toBe(geometry); expect(cross.material.color.getHex()).toBe(0x0000ff);
  grid.apply(resolveAppearance({...defaultCADAppearance, gridAxisColor:'#123456'}));
  expect(x.material.color.getHex()).toBe(0x123456); expect(cross.material.color.getHex()).toBe(0x123456);
});

it('positions key/fill/rim lights in modeling coordinates and clamps unsafe saved angles', () => {
  expect(environmentLightDirection(0, 0, 'z')).toEqual([10, 0, 0]);
  const z = environmentLightDirection(45, 30, 'z'), y = environmentLightDirection(45, 30, 'y');
  expect(Math.hypot(...z)).toBeCloseTo(10); expect(z[2]).toBeCloseTo(5);
  expect(y).toEqual([z[0], z[2], -z[1]]);
  const a = normalizeCADAppearance({keyLightElevationDegrees:120,fillLightAzimuthDegrees:-720,rimLightAzimuthDegrees:Infinity});
  expect(a.keyLightElevationDegrees).toBe(90); expect(a.fillLightAzimuthDegrees).toBe(-180); expect(a.rimLightAzimuthDegrees).toBeUndefined();
});

it('keeps standard palette colors unchanged as exposure adjusts lights, and captures the transform in presets', () => {
  const a = reduceCADAppearance(defaultCADAppearance, {type:'apply-environment-theme',theme:'fusion360'});
  const normal = resolveAppearance(a), brighter = resolveAppearance({...a,exposure:2});
  expect(normal.colorTransform).toBe('standard'); expect(normal.background).toBe(0xffffff);
  expect(brighter.background).toBe(normal.background); expect(brighter.gridMinor).toBe(normal.gridMinor);
  expect(brighter.lights.key).toBeCloseTo(normal.lights.key*2);
  expect(captureEnvironment(a).colorTransform).toBe('standard');
  expect(resolveAppearance({...a,colorTransform:'filmic',exposure:2}).lights.key).toBe(normal.lights.key);
});
