import { MOUSE, Vector2, Vector3, type PerspectiveCamera, type OrthographicCamera } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

/** Motion matched to the Model Studio reference viewport (OrbitControls with
 * damping): 2π per viewport height of drag, 5% per 100px wheel step, a
 * cursor-locked perspective pan and a similar release glide. Trackball's damped
 * pan/zoom re-applies the remaining offset every frame, so those speeds are
 * multiplied by the damping factor to keep their totals equal to the reference. */
export const cadCameraMotion = {
  damping: 0.1,
  /** ln(1/0.95) per 100px wheel step ÷ (100 × Trackball's 0.00025/px wheel factor). */
  zoomPerStep: Math.log(1 / 0.95) / (100 * 0.00025),
  orthographicPan: 0.8,
} as const;

type Internals = {
  _lastAngle: number; _panStart: Vector2; _panEnd: Vector2; _zoomStart: Vector2; _zoomEnd: Vector2;
  screen: { left: number; top: number; width: number; height: number };
};

class CADTrackballControls extends TrackballControls {
  // Assigned lazily: the base constructor already calls update().
  private settled?: { position: Vector3; up: Vector3; target: Vector3 };

  /** Drop residual glide, pan and zoom. */
  stopMotion(): void {
    const self = this as unknown as Internals;
    self._lastAngle = 0;
    self._panStart.copy(self._panEnd);
    self._zoomStart.copy(self._zoomEnd);
  }

  override update(): this {
    const camera = this.object as PerspectiveCamera | OrthographicCamera;
    // A camera placed by a view snap, frame or animation stays exactly there:
    // residual user motion must not pull a normal view away from its plane.
    const settled = this.settled ??= { position: camera.position.clone(), up: camera.up.clone(), target: this.target.clone() };
    if (!camera.position.equals(settled.position) || !camera.up.equals(settled.up) || !this.target.equals(settled.target)) this.stopMotion();
    const { damping, zoomPerStep, orthographicPan } = cadCameraMotion, screen = (this as unknown as Internals).screen;
    this.rotateSpeed = Math.PI * screen.width / Math.max(1, screen.height);
    this.zoomSpeed = zoomPerStep * damping;
    this.panSpeed = ((camera as PerspectiveCamera).isPerspectiveCamera ? 2 * Math.tan((camera as PerspectiveCamera).fov * Math.PI / 360) : orthographicPan) * damping;
    super.update();
    settled.position.copy(camera.position); settled.up.copy(camera.up); settled.target.copy(this.target);
    return this;
  }

  /** Perspective pan normalizes both axes by height, so the model follows the cursor. */
  _getMouseOnScreen(pageX: number, pageY: number): Vector2 {
    const { screen } = this as unknown as Internals;
    const point = new Vector2((pageX - screen.left) / screen.width, (pageY - screen.top) / screen.height);
    if ((this.object as PerspectiveCamera).isPerspectiveCamera) point.x *= screen.width / Math.max(1, screen.height);
    return point;
  }
}

export type CADCameraControls = CADTrackballControls;

/** Quaternion trackball rotation carries camera.up through the poles. A
 * world-up spherical orbit clamps at Top/Bottom and cannot provide full tilt.
 * Explicit views use the camera's supplied up vector, including Y/Z-up workspaces. */
export function createCADCameraControls(
  camera: PerspectiveCamera | OrthographicCamera,
  element: HTMLElement,
  onChange: () => void,
  target = new Vector3(),
): CADCameraControls {
  const controls = new CADTrackballControls(camera, element);
  controls.target.copy(target);
  controls.staticMoving = false;
  controls.dynamicDampingFactor = cadCameraMotion.damping;
  controls.mouseButtons.LEFT = -1 as MOUSE;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.ROTATE;
  // A/S/D belong to CAD tools and text fields, never camera gesture modes.
  controls.keys = ["", "", ""];
  controls.update();
  controls.addEventListener("change", onChange);
  return controls;
}
