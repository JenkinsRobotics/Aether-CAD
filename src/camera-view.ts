import { viewportVectorForUpAxis, type ViewportUpAxis } from "@aether/ui";

export type StandardCameraView =
  | "isometric"
  | "dimetric"
  | "trimetric"
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

export type CameraQuaternion = readonly [number, number, number, number];
export type CameraVector = readonly [number, number, number];

export interface CameraOrientationBasis {
  /** Unit vector from the orbit target toward the camera. */
  direction: CameraVector;
  /** Unit camera-up vector, kept perpendicular to direction. */
  up: CameraVector;
}

export interface CameraViewDefinition {
  id: StandardCameraView;
  label: string;
  direction: readonly [number, number, number];
  up: readonly [number, number, number];
}

export const standardCameraViews: readonly CameraViewDefinition[] = [
  { id: "isometric", label: "Isometric", direction: [1, 1, 1], up: [0, 1, 0] },
  { id: "dimetric", label: "Dimetric", direction: [1, 0.6, 1], up: [0, 1, 0] },
  { id: "trimetric", label: "Trimetric", direction: [1, 0.7, 1.35], up: [0, 1, 0] },
  { id: "front", label: "Front", direction: [0, 0, 1], up: [0, 1, 0] },
  { id: "back", label: "Back", direction: [0, 0, -1], up: [0, 1, 0] },
  { id: "left", label: "Left", direction: [-1, 0, 0], up: [0, 1, 0] },
  { id: "right", label: "Right", direction: [1, 0, 0], up: [0, 1, 0] },
  { id: "top", label: "Top", direction: [0, 1, 0], up: [0, 0, -1] },
  { id: "bottom", label: "Bottom", direction: [0, -1, 0], up: [0, 0, 1] },
] as const;

export function cameraViewDefinition(id: StandardCameraView, upAxis: ViewportUpAxis = "z"): CameraViewDefinition {
  const definition = standardCameraViews.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown camera view: ${id}`);
  return { ...definition, direction: viewportVectorForUpAxis(definition.direction, upAxis), up: viewportVectorForUpAxis(definition.up, upAxis) };
}

/** Avoid a collinear camera-up vector when looking straight down/up. */
export function cameraUpForDirection(direction: CameraVector, upAxis: ViewportUpAxis): CameraVector {
  const length = Math.hypot(...direction);
  const vertical = direction[upAxis === "z" ? 2 : 1] / (length || 1);
  return viewportVectorForUpAxis(Math.abs(vertical) > 0.99 ? [0, 0, -Math.sign(vertical)] : [0, 1, 0], upAxis);
}

const dot = (left: CameraVector, right: CameraVector): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const cross = (left: CameraVector, right: CameraVector): CameraVector => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const scale = (vector: CameraVector, amount: number): CameraVector => [
  vector[0] * amount,
  vector[1] * amount,
  vector[2] * amount,
];

const add = (...vectors: CameraVector[]): CameraVector => vectors.reduce<CameraVector>(
  (result, vector) => [
    result[0] + vector[0],
    result[1] + vector[1],
    result[2] + vector[2],
  ],
  [0, 0, 0],
);

const normalize = (vector: CameraVector): CameraVector => {
  const length = Math.hypot(...vector);
  if (length < 1e-9) throw new Error("Camera orientation vector must not be zero.");
  return scale(vector, 1 / length);
};

/** Rotates a vector around a unit axis using Rodrigues' formula. */
function rotate(vector: CameraVector, axis: CameraVector, radians: number): CameraVector {
  const unitAxis = normalize(axis);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return add(
    scale(vector, cosine),
    scale(cross(unitAxis, vector), sine),
    scale(unitAxis, dot(unitAxis, vector) * (1 - cosine)),
  );
}

function orthonormalize(direction: CameraVector, up: CameraVector): CameraOrientationBasis {
  const normalizedDirection = normalize(direction);
  const projectedUp = add(up, scale(normalizedDirection, -dot(up, normalizedDirection)));
  return { direction: normalizedDirection, up: normalize(projectedUp) };
}

/**
 * Applies ViewCube arrow nudges. Positive horizontal turns right; positive
 * vertical turns up. Both axes come from the current screen basis, so Top,
 * Bottom and rolled views behave exactly like Front without a world-up pole.
 */
export function nudgeCameraBasis(
  basis: CameraOrientationBasis,
  horizontalRadians: number,
  verticalRadians: number,
): CameraOrientationBasis {
  const screen = orthonormalize(basis.direction, basis.up);
  let direction = rotate(screen.direction, screen.up, horizontalRadians);
  let up = screen.up;
  const right = normalize(cross(up, direction));
  direction = rotate(direction, right, -verticalRadians);
  up = rotate(up, right, -verticalRadians);
  return orthonormalize(direction, up);
}

/** Applies a ViewCube roll around the current target-to-camera direction. */
export function rollCameraBasis(
  basis: CameraOrientationBasis,
  radians: number,
): CameraOrientationBasis {
  return orthonormalize(basis.direction, rotate(basis.up, basis.direction, radians));
}
