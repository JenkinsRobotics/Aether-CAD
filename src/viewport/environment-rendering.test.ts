import { expect, it, vi } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three/webgpu';
import { defaultCADAppearance } from '../cad-appearance-store';
import { tintPlane, updatePlaneVisual } from '../plane-visual';
import { resolveAppearance } from './appearance-themes';
import { EnvironmentGrid, gridSegments } from './environment-grid';
import { gradientBackground } from './environment-background';
import { styledLines } from './styled-lines';

it('separates repeated major grid lines from the axes at the requested spacing', () => {
  const g = gridSegments(10, 100, 5);
  expect(g.extent).toBe(100); expect(g.axes).toHaveLength(12);
  expect(g.major).toHaveLength(24); expect(g.minor).toHaveLength(96);
  for (const positions of [g.minor,g.major,g.axes]) for (const coordinate of positions) expect(coordinate % 10 === 0).toBe(true);
  expect(gridSegments(.1, 100000, 5).extent).toBe(200);
  expect(gridSegments(.1, 100000, 5).minor.length).toBeLessThan(24012);
  const sparse = gridSegments(100, 20, 5);
  expect(sparse.extent).toBe(20); expect(sparse.axes).toHaveLength(12);
  expect(sparse.minor).toEqual([]); expect(sparse.major).toEqual([]);
});

it('changes colors and real mesh line widths live without reallocating the grid', () => {
  const grid = new EnvironmentGrid(), before = resolveAppearance({...defaultCADAppearance,gridMinorOpacityPercent:100});
  grid.apply(before);
  const [minor,major,axes] = grid.children as ReturnType<typeof styledLines>[];
  const geometry = minor.geometry, dispose = vi.spyOn(geometry,'dispose');
  grid.apply(resolveAppearance({...defaultCADAppearance,gridMinorWidthPx:4,gridMinorColor:'#ff0000',gridMinorOpacityPercent:100,gridMajorOpacityPercent:0,gridAxisWidthPx:6}));
  expect(minor.geometry).toBe(geometry); expect(minor.isMesh).toBe(true);
  expect(minor.material.linewidth).toBe(4); expect(minor.material.opacity).toBe(1);
  expect(minor.material.color.getHex()).toBe(0xff0000); expect(major.visible).toBe(false);
  expect(axes.material.linewidth).toBe(6); expect(dispose).not.toHaveBeenCalled();
  grid.apply(resolveAppearance({...defaultCADAppearance,gridSpacingMillimeters:12}));
  expect(dispose).toHaveBeenCalledOnce(); expect(minor.geometry).not.toBe(geometry);
});

it('keeps empty line geometry finite and draws no instances', () => {
  const line = styledLines([],0,3);
  expect(line.geometry.instanceCount).toBe(0);
  expect(Number.isFinite(line.geometry.boundingSphere!.radius)).toBe(true);
});

it('restyles existing hidden/highlighted planes without losing identity or the new base color', () => {
  const plane = new Group(), surface = new Mesh(new PlaneGeometry(110,110),new MeshBasicMaterial({color:0x123456,opacity:.1}));
  const border = styledLines([0,0,0,10,0,0],0x123456);
  surface.userData.planeRole='fill'; border.userData.planeRole='border'; plane.add(surface,border); plane.visible=false;
  tintPlane(plane,0xff0000);
  updatePlaneVisual(plane,0x339977,{sizeMillimeters:220,fillOpacity:.3,borderOpacity:.8,borderWidthPx:4});
  expect(plane.visible).toBe(false); expect(plane.children[0]).toBe(surface); expect(plane.scale.x).toBe(2);
  expect(surface.material.color.getHex()).toBe(0xff0000); expect(border.material.linewidth).toBe(4);
  tintPlane(plane,null);
  expect(surface.material.color.getHex()).toBe(0x339977); expect(surface.material.opacity).toBe(.3);
  expect(border.material.opacity).toBe(.8);
});

it('renders exact gradient endpoints with a bounded texture', () => {
  const texture = gradientBackground(0x123456,0xabcdef), bytes = texture.image.data;
  expect(texture.image.width).toBe(1); expect(texture.image.height).toBe(256);
  expect(Array.from(bytes.slice(0,4))).toEqual([0xab,0xcd,0xef,255]);
  expect(Array.from(bytes.slice(-4))).toEqual([0x12,0x34,0x56,255]);
});
