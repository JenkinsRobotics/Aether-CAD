import { Group } from 'three/webgpu';
import type { ResolvedAppearance } from './appearance-themes';
import { styledLines } from './styled-lines';

export function gridSegments(spacing: number, extent: number, majorEvery: number) {
  // Bound GPU geometry without silently changing the requested spacing.
  const half = Math.min(extent / 2, spacing * 1000);
  const halfCount = Math.floor(half / spacing);
  const minor: number[] = [], major: number[] = [], axes: number[] = [];
  for (let index = -halfCount; index <= halfCount; index++) {
    const target = index === 0 ? axes : index % majorEvery === 0 ? major : minor;
    const p = index * spacing;
    target.push(-half, 0, p, half, 0, p, p, 0, -half, p, 0, half);
  }
  return { minor, major, axes, extent: half * 2 };
}
export class EnvironmentGrid extends Group {
  private key = '';
  private minor = styledLines([], 0);
  private major = styledLines([], 0);
  private axes = styledLines([], 0);
  private crossAxis = styledLines([], 0);
  private upAxis: 'y' | 'z' = 'z';
  constructor() { super(); this.add(this.minor, this.major, this.axes, this.crossAxis); }
  setUpAxis(axis: 'y' | 'z') { this.upAxis = axis; }
  apply(appearance: ResolvedAppearance) {
    const g = appearance.grid, key = JSON.stringify([g.spacing, g.extent, g.majorEvery]);
    if (key !== this.key) {
      this.key = key;
      const data = gridSegments(g.spacing, g.extent, g.majorEvery);
      for (const [line, positions] of [[this.minor, data.minor], [this.major, data.major], [this.axes, data.axes.slice(0, 6)], [this.crossAxis, data.axes.slice(6)]] as const) {
        line.geometry.dispose();
        const replacement = styledLines(positions, 0); line.geometry = replacement.geometry; replacement.material.dispose();
      }
    }
    for (const [line, color, width, opacity] of [
      [this.minor, appearance.gridMinor, g.minorWidth, appearance.gridOpacity],
      [this.major, appearance.gridMajor, g.majorWidth, g.majorOpacity],
      [this.axes, g.xColor, g.axisWidth, g.axisOpacity],
      [this.crossAxis, this.upAxis === 'z' ? g.yColor : g.zColor, g.axisWidth, g.axisOpacity],
    ] as const) { line.material.color.setHex(color); line.material.linewidth = width; line.material.opacity = opacity; line.visible = opacity > 0; }
  }
}
