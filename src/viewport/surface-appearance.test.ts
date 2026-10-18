import { expect, it } from "vitest";
import { MeshStandardMaterial } from "three";
import { defaultCADAppearance } from "../cad-appearance-store";
import { cadDisplayStylePolicy } from "../viewport-appearance";
import { resolveAppearance } from "./appearance-themes";
import { applySurfaceAppearance } from "./surface-appearance";

it("updates actual material color, transparency and finish without replacing selection color", () => {
  const part=new MeshStandardMaterial();
  const selection=new MeshStandardMaterial({color:0xffaa00});
  const resolved=resolveAppearance({...defaultCADAppearance,bodyColor:'#ff3045',bodyOpacityPercent:40,roughness:0.2,metalness:0.8});
  applySurfaceAppearance([part,selection],cadDisplayStylePolicy('shaded',true),resolved);
  expect(part.color.getHex()).toBe(0xff3045);
  expect(selection.color.getHex()).toBe(0xffaa00);
  expect(part.opacity).toBe(0.4);
  expect(part.transparent).toBe(true);
  expect(part.depthWrite).toBe(false);
  expect(part.roughness).toBe(0.2);
  expect(part.metalness).toBe(0.8);
  applySurfaceAppearance([part,selection],cadDisplayStylePolicy('hidden-line',true),resolved);
  expect(part.color.getHex()).toBe(resolved.background);
  expect(part.opacity).toBe(1);
  applySurfaceAppearance([part,selection],cadDisplayStylePolicy('shaded',true),resolveAppearance(defaultCADAppearance));
  expect(part.transparent).toBe(false);
  expect(part.depthWrite).toBe(true);
  part.dispose();selection.dispose();
});


it('separates coplanar CAD edges from filled faces and keeps finish during selection', () => {
  const base = new MeshStandardMaterial(), selected = new MeshStandardMaterial({color:0xffaa00});
  const resolved = resolveAppearance({...defaultCADAppearance,roughness:0.3,metalness:0.4});
  applySurfaceAppearance([base,selected],cadDisplayStylePolicy('shaded-edges',true),resolved);
  expect(base.polygonOffset).toBe(true);
  expect(base.polygonOffsetFactor).toBeGreaterThan(0);
  expect(selected.polygonOffset).toBe(true);
  expect(selected.roughness).toBe(base.roughness);
  expect(selected.metalness).toBe(base.metalness);
  expect(selected.color.getHex()).toBe(0xffaa00);
  applySurfaceAppearance([base,selected],cadDisplayStylePolicy('shaded',true),resolved);
  expect(base.polygonOffset).toBe(false);
  base.dispose(); selected.dispose();
});

it('applies self-illumination to the real part material and restores hidden-line masks',()=>{
  const part=new MeshStandardMaterial(),selected=new MeshStandardMaterial({emissive:0xffaa00});
  const r=resolveAppearance({...defaultCADAppearance,emissiveColor:'#22aa44',emissiveIntensity:2});
  applySurfaceAppearance([part,selected],cadDisplayStylePolicy('shaded-edges',true),r);
  expect(part.emissive.getHex()).toBe(0x22aa44);expect(part.emissiveIntensity).toBe(2);expect(selected.emissive.getHex()).toBe(0xffaa00);
  applySurfaceAppearance([part],cadDisplayStylePolicy('hidden-line',true),r);expect(part.emissive.getHex()).toBe(r.background);
  part.dispose();selected.dispose();
});
