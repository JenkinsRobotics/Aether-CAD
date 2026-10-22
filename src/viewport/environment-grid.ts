import { float, positionView, uniform } from 'three/tsl';
import { Group, LineSegments, BufferGeometry, Float32BufferAttribute, LineBasicNodeMaterial } from 'three/webgpu';
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
/** WebGPU's native lines can drop an entire camera-crossing segment. Short
 * collinear pieces preserve the foreground while keeping the exact grid cells. */
export function subdivideGridLines(positions: readonly number[], spacing: number): number[] {
  const result: number[] = [];
  for (let i=0;i<positions.length;i+=6) {
    const start=positions.slice(i,i+3),delta=start.map((value,axis)=>positions[i+3+axis]-value);
    const steps=Math.min(128,Math.max(1,Math.ceil(Math.hypot(...delta)/spacing)));
    for (let step=0;step<steps;step++) {
      for (const t of [step/steps,(step+1)/steps]) result.push(...start.map((value,axis)=>value+delta[axis]*t));
    }
  }
  return result;
}
/** 1-2-5 series step at or below `value` (mm). */
export function niceGridStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1e-3)));
  const unit = value / power;
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power;
}
/** The reference stage around the framed model: ~5 cells across its diagonal and
 * wide enough that its edge always lies beyond the fade. */
export function stageGridFraming(diagonal: number, distance: number, fog: StageFog = DEMO_FOG) {
  const spacing = niceGridStep(diagonal / 5);
  return { spacing, extent: spacing * 120, ...stageGridFade(spacing, spacing * 120, diagonal, distance, fog) };
}
type StageFog = { nearCells: number; farCells: number };
const DEMO_FOG: StageFog = { nearCells: 14, farCells: 32 };
/** The theme's fog for the floor, following the camera every frame like the
 * demo's: fully visible to the model (≥ fog.nearCells), dissolved into the
 * background by three camera distances (≥ fog.farCells), gone before the edge. */
export function stageGridFade(spacing: number, extent: number, diagonal: number, distance: number, fog: StageFog = DEMO_FOG) {
  const far = Math.min(Math.max(fog.farCells * spacing, distance * 3), extent * 0.45);
  return { near: Math.min(Math.max(fog.nearCells * spacing, distance + diagonal / 2), far * 0.45), far };
}
export class EnvironmentGrid extends Group {
  private key = '';
  private stage: (ReturnType<typeof stageGridFraming> & { diagonal: number }) | null = null;
  private appearance: ResolvedAppearance | null = null;
  private fadeNear = uniform(0);
  private fadeFar = uniform(1);
  private fadeEnabled = uniform(0);
  private opacities = [uniform(1), uniform(1), uniform(1), uniform(1)];
  private minor = styledLines([], 0);
  private major = styledLines([], 0);
  private axes = styledLines([], 0);
  private crossAxis = styledLines([], 0);
  private reference = new Group();
  private referenceLines = Array.from({length:4},()=>new LineSegments(new BufferGeometry(),new LineBasicNodeMaterial({transparent:true,depthWrite:false,toneMapped:true})));
  private upAxis: 'y' | 'z' = 'z';
  constructor() {
    super(); this.add(this.minor, this.major, this.axes, this.crossAxis);
    // Native line primitives match THREE.GridHelper in the reference. The wide
    // line renderer remains available for explicitly customized pixel widths.
    const fade = float(1).sub(positionView.z.negate().smoothstep(this.fadeNear, this.fadeFar).mul(this.fadeEnabled));
    this.referenceLines.forEach((line,index)=>{
      line.material.opacityNode=this.opacities[index].mul(fade);
      this.reference.add(line);
    });
    this.add(this.reference);
  }
  setUpAxis(axis: 'y' | 'z') { this.upAxis = axis; }
  /** Fit the Model Studio stage to a framed model (other environments keep their settings). */
  frameStage(diagonal: number, distance: number) {
    this.stage = { ...stageGridFraming(diagonal, distance, this.appearance?.stage?.fog ?? undefined), diagonal };
    if (this.appearance) this.apply(this.appearance);
  }
  private get fitted() { return this.appearance?.stage?.gridFitsModel && this.appearance.stage.fog ? this.stage : null; }
  /** Per frame: the stage fade tracks the camera like the demo's fog. */
  followCamera(distance: number) {
    const stage = this.fitted;
    if (!stage) return;
    const fade = stageGridFade(stage.spacing, stage.extent, stage.diagonal, distance, this.appearance!.stage.fog!);
    this.fadeNear.value = fade.near; this.fadeFar.value = fade.far;
  }
  /** How far from the origin the visible grid reaches, for the camera depth range. */
  reach(): number {
    if (!this.visible || !this.appearance) return 0;
    return (this.fitted?.extent ?? this.appearance.grid.extent) / 2;
  }
  apply(appearance: ResolvedAppearance) {
    this.appearance = appearance;
    const stage = this.fitted;
    const g = stage ? { ...appearance.grid, spacing: stage.spacing, extent: stage.extent, fade: { near: stage.near, far: stage.far } } : appearance.grid;
    const key = JSON.stringify([g.spacing, g.extent, g.majorEvery]);
    if (key !== this.key) {
      this.key = key;
      const data = gridSegments(g.spacing, g.extent, g.majorEvery);
      let index = 0;
      for (const [line, positions] of [[this.minor, data.minor], [this.major, data.major], [this.axes, data.axes.slice(0, 6)], [this.crossAxis, data.axes.slice(6)]] as const) {
        line.geometry.dispose();
        const replacement = styledLines(positions, 0); line.geometry = replacement.geometry; replacement.material.dispose();
        const reference=this.referenceLines[index++];reference.geometry.dispose();
        reference.geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(subdivideGridLines(positions,g.spacing),3));
      }
    }
    this.fadeNear.value = g.fade?.near ?? 0;
    this.fadeFar.value = g.fade?.far ?? 1;
    this.fadeEnabled.value = g.fade ? 1 : 0;
    const thin = g.toneMapped && g.minorWidth === 1 && g.majorWidth === 1 && g.axisWidth === 1;
    this.reference.visible=thin;
    let index = 0;
    for (const [line, color, width, opacity] of [
      [this.minor, appearance.gridMinor, g.minorWidth, appearance.gridOpacity],
      [this.major, appearance.gridMajor, g.majorWidth, g.majorOpacity],
      [this.axes, g.xColor, g.axisWidth, g.axisOpacity],
      [this.crossAxis, this.upAxis === 'z' ? g.yColor : g.zColor, g.axisWidth, g.axisOpacity],
    ] as const) {
      const reference=this.referenceLines[index];this.opacities[index++].value=opacity;
      reference.material.color.setHex(color);reference.visible=opacity>0;
      line.material.color.setHex(color);line.material.linewidth=width;line.material.opacity=opacity;
      line.material.toneMapped=g.toneMapped;line.visible=!thin && opacity>0;
    }
  }
}
