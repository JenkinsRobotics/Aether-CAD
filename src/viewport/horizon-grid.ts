/** A ground grid with a view-angle fade, independent of camera distance.
 * A two-triangle surface avoids finite line endpoints and subpixel line aliasing.
 * Its world-space coordinates keep the origin and cells fixed while panning. */
import { cameraPosition, float, mix, positionWorld, uniform, vec2, vec3 } from 'three/tsl';
import { Camera, Color, DoubleSide, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three/webgpu';
import type { ResolvedAppearance } from './appearance-themes';

export const GRID_HORIZON = { hidden: Math.sin(2 * Math.PI / 180), visible: Math.sin(16 * Math.PI / 180) };

/** Same smooth angular envelope used by the shader. Parallel orthographic rays
 * naturally have one opacity; top views stay fully visible at any zoom. */
export function gridAngleOpacity(sine: number): number {
  const t = Math.max(0, Math.min(1, (Math.abs(sine) - GRID_HORIZON.hidden) / (GRID_HORIZON.visible - GRID_HORIZON.hidden)));
  return t * t * (3 - 2 * t);
}

/** Every visible perspective ray lies inside this footprint. Orthographic
 * footprints are centered on the camera's ground intersection instead. */
export function gridFootprint(camera: Camera, up: 'y' | 'z', plane: number) {
  const normal = new Vector3(0, up === 'y' ? 1 : 0, up === 'z' ? 1 : 0);
  const direction = camera.getWorldDirection(new Vector3());
  const center = camera.getWorldPosition(new Vector3());
  const height = center[up] - plane;
  let half: number;
  if (camera instanceof OrthographicCamera) {
    const incidence = direction.dot(normal);
    if (Math.abs(incidence) > 1e-6) center.addScaledVector(direction, -height / incidence);
    const radius = Math.hypot(camera.right - camera.left, camera.top - camera.bottom) / (2 * camera.zoom);
    half = radius / Math.max(Math.abs(incidence), GRID_HORIZON.hidden) * 1.1;
  } else {
    half = Math.max(1, Math.abs(height) / GRID_HORIZON.hidden * 1.1);
  }
  center[up] = plane;
  return { center, half };
}

export function gridLevels(baseSpacing: number, span: number) {
  const level = Math.max(0, Math.log10(span / (baseSpacing * 50)));
  return { spacing: baseSpacing * 10 ** Math.floor(level), blend: level % 1 };
}

export class HorizonGrid extends Mesh<PlaneGeometry, MeshBasicNodeMaterial> {
  private readonly spacing = uniform(25);
  private readonly levelBlend = uniform(0);
  private readonly majorEvery = uniform(5);
  private readonly majorEnabled = uniform(1);
  private readonly zUp = uniform(1);
  private readonly orthographic = uniform(0);
  private readonly direction = uniform(new Vector3(0, 0, -1));
  private readonly colors = [uniform(new Color()), uniform(new Color()), uniform(new Color()), uniform(new Color())];
  private readonly widths = [uniform(1), uniform(1), uniform(1), uniform(1)];
  private readonly opacities = [uniform(1), uniform(1), uniform(1), uniform(1)];
  private upAxis: 'y' | 'z' = 'z';
  private baseSpacing = 25;
  private reachFromCamera = 0;

  constructor() {
    super(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
    this.frustumCulled = false;
    const coordinates = vec2(positionWorld.x, mix(positionWorld.z, positionWorld.y, this.zUp));
    const normal = vec3(0, float(1).sub(this.zUp), this.zUp);
    const ray = mix(positionWorld.sub(cameraPosition).normalize(), this.direction, this.orthographic);
    const horizon = ray.dot(normal).abs().smoothstep(GRID_HORIZON.hidden, GRID_HORIZON.visible);
    const cell = coordinates.div(this.spacing);
    // Derivatives measure spacing in pixels, so distant lines dissolve before
    // aliasing. Width and opacity remain the theme/user's requested values.
    const lines = (coords: typeof cell, width: typeof this.widths[number]) => {
      const derivative = coords.fwidth().max(1e-6);
      const pixels = coords.add(0.5).fract().sub(0.5).abs().div(derivative);
      const coverage = float(1).sub(pixels.smoothstep(width.mul(0.5).sub(0.5), width.mul(0.5).add(0.5)));
      const density = float(1).sub(derivative.smoothstep(0.25, 0.75));
      return coverage.mul(density).max(0);
    };
    const minorFine = lines(cell, this.widths[0]);
    const minorCoarse = lines(cell.div(10), this.widths[0]);
    const majorFine = lines(cell.div(this.majorEvery), this.widths[1]);
    const majorCoarse = lines(cell.div(this.majorEvery.mul(10)), this.widths[1]);
    const minor = mix(minorFine, minorCoarse, this.levelBlend);
    const major = mix(majorFine, majorCoarse, this.levelBlend).mul(this.majorEnabled);
    const axisPixels = coordinates.abs().div(coordinates.fwidth().max(1e-6));
    // X runs along the first coordinate; the cross axis runs along the second.
    const xAxis = float(1).sub(axisPixels.y.smoothstep(this.widths[2].mul(0.5).sub(0.5), this.widths[2].mul(0.5).add(0.5)));
    const crossAxis = float(1).sub(axisPixels.x.smoothstep(this.widths[3].mul(0.5).sub(0.5), this.widths[3].mul(0.5).add(0.5)));
    const masks = [minor.x.max(minor.y), major.x.max(major.y), xAxis, crossAxis];
    let alpha = masks[0].mul(this.opacities[0]);
    let premultiplied = this.colors[0].mul(alpha);
    for (let i = 1; i < masks.length; i++) {
      const next = masks[i].mul(this.opacities[i]);
      premultiplied = premultiplied.mul(float(1).sub(next)).add(this.colors[i].mul(next));
      alpha = alpha.mul(float(1).sub(next)).add(next);
    }
    this.material.colorNode = premultiplied.div(alpha.max(1e-6));
    this.material.opacityNode = alpha.mul(horizon);
  }

  apply(appearance: ResolvedAppearance, spacing: number, up: 'y' | 'z') {
    const grid = appearance.grid;
    this.upAxis = up; this.zUp.value = up === 'z' ? 1 : 0;
    this.baseSpacing = spacing; this.spacing.value = spacing;
    this.majorEvery.value = Math.max(1, grid.majorEvery); this.majorEnabled.value = grid.majorEvery > 0 ? 1 : 0;
    [appearance.gridMinor, appearance.gridMajor, grid.xColor, up === 'z' ? grid.yColor : grid.zColor].forEach((value, i) => this.colors[i].value.setHex(value));
    [grid.minorWidth, grid.majorWidth, grid.axisWidth, grid.axisWidth].forEach((value, i) => { this.widths[i].value = value; });
    [appearance.gridOpacity, grid.majorOpacity, grid.axisOpacity, grid.axisOpacity].forEach((value, i) => { this.opacities[i].value = value; });
    this.material.toneMapped = grid.toneMapped;
  }

  followCamera(camera: Camera, target: Vector3) {
    this.orthographic.value = camera instanceof OrthographicCamera ? 1 : 0;
    camera.getWorldDirection(this.direction.value);
    const plane = this.parent?.position[this.upAxis] ?? 0;
    const { center, half } = gridFootprint(camera, this.upAxis, plane);
    // The parent rotates the grid's XZ plane for Z-up models.
    this.position.copy(this.upAxis === 'z' ? new Vector3(center.x, 0, -center.y) : new Vector3(center.x, 0, center.z));
    this.scale.set(half * 2, 1, half * 2);
    this.reachFromCamera = camera.position.distanceTo(center) + half * Math.SQRT2;
    const span = camera instanceof OrthographicCamera ? (camera.top - camera.bottom) / camera.zoom
      : camera instanceof PerspectiveCamera ? 2 * camera.position.distanceTo(target) * Math.tan(camera.fov * Math.PI / 360) / camera.zoom : 1;
    // Crossfade adjacent world-aligned scales continuously at decade boundaries.
    const levels = gridLevels(this.baseSpacing, span);
    this.spacing.value = levels.spacing; this.levelBlend.value = levels.blend;
  }

  reach() { return this.reachFromCamera; }
}
