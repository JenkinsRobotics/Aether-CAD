import { MOUSE, Vector3, type PerspectiveCamera, type OrthographicCamera } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

export type CADCameraControls = TrackballControls;

/** Quaternion trackball rotation carries camera.up through the poles. A
 * world-up spherical orbit clamps at Top/Bottom and cannot provide full tilt.
 * Explicit views use the camera's supplied up vector, including Y/Z-up workspaces. */
export function createCADCameraControls(
  camera: PerspectiveCamera | OrthographicCamera,
  element: HTMLElement,
  onChange: () => void,
  target = new Vector3(),
): CADCameraControls {
  const controls = new TrackballControls(camera, element);
  controls.target.copy(target);
  // Stop when the pointer stops: residual rotation must not pull a normal view
  // away from its exact plane after the user releases the mouse.
  controls.staticMoving = true;
  controls.rotateSpeed = Math.PI;
  controls.panSpeed = 0.8;
  controls.mouseButtons.LEFT = -1 as MOUSE;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.ROTATE;
  // A/S/D belong to CAD tools and text fields, never camera gesture modes.
  controls.keys = ["", "", ""];
  controls.update();
  controls.addEventListener("change", onChange);
  return controls;
}
