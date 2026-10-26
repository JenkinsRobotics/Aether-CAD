import { Camera, Group, Vector3 } from 'three/webgpu';
import { HorizonGrid } from './horizon-grid';
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
/** 1-2-5 series step at or below `value` (mm). */
export function niceGridStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1e-3)));
  const unit = value / power;
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power;
}
/** Fit the initial cell spacing to the model. Coverage is computed from the view. */
export function stageGridFraming(diagonal: number) {
  return { spacing: niceGridStep(diagonal / 5) };
}
export class EnvironmentGrid extends Group {
  private key = '';
  private stage: ReturnType<typeof stageGridFraming> | null = null;
  private appearance: ResolvedAppearance | null = null;
  private minor = styledLines([], 0);
  private major = styledLines([], 0);
  private axes = styledLines([], 0);
  private crossAxis = styledLines([], 0);
  private horizon = new HorizonGrid();
  private upAxis: 'y' | 'z' = 'z';
  constructor() {
    super(); this.add(this.minor, this.major, this.axes, this.crossAxis);
    this.add(this.horizon);
  }
  setUpAxis(axis: 'y' | 'z') {
    if (this.upAxis === axis) return;
    this.upAxis = axis;
    if (this.appearance) this.apply(this.appearance);
  }
  /** Fit the Model Studio stage to a framed model (other environments keep their settings). */
  frameStage(diagonal: number) {
    this.stage = stageGridFraming(diagonal);
    if (this.appearance) this.apply(this.appearance);
  }
  private get fitted() { return this.appearance?.stage.gridFitsModel ? this.stage : null; }
  followCamera(camera: Camera, target: Vector3) {
    if (this.horizon.visible) this.horizon.followCamera(camera, target);
  }
  /** Maximum camera-to-grid distance, independent of distance from the origin. */
  reach(cameraPosition: Vector3): number {
    if (!this.visible || !this.appearance) return 0;
    return this.horizon.visible ? this.horizon.reach() : cameraPosition.length() + this.appearance.grid.extent / Math.SQRT2;
  }
  apply(appearance: ResolvedAppearance) {
    this.appearance = appearance;
    const stage = this.fitted;
    const g = appearance.grid;
    this.horizon.visible = g.horizonFade;
    this.horizon.apply(appearance, stage?.spacing ?? g.spacing, this.upAxis);
    const key = JSON.stringify([g.spacing, g.extent, g.majorEvery]);
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
    ] as const) {
      line.material.color.setHex(color);line.material.linewidth=width;line.material.opacity=opacity;
      line.material.toneMapped=g.toneMapped;line.visible=!this.horizon.visible && opacity>0;
    }
  }
}
