import { draw, genericSweep, isShape3D, makeHelix, measureVolume, Plane, type Shape3D, type Wire } from "replicad";
import { deleteAfterVectorTuple } from "../../geometry/index";
import type { ThreadForm } from "../../document/thread";
import { add, cross, scale, sub, unit, type V3 } from "../vector";

export interface ModeledThreadParams {
  startCenter: V3;
  inwardDirection: V3;
  faceRadius: number;
  isExternal: boolean;
  pitchMillimeters: number;
  lengthMillimeters: number;
  leftHand: boolean;
  starts: number;
  form: ThreadForm;
}

/** Builds a helical cutting solid (1..8 starts) for an external shaft or internal bore thread.
 *  Supports V60 (ISO/UN), Trapezoidal (30°), ACME (29°), and Buttress tooth profiles. */
export function buildModeledThreadCutter(
  params: ModeledThreadParams,
  own: <T>(shape: T) => T,
): Shape3D {
  const { startCenter, inwardDirection, faceRadius, isExternal, pitchMillimeters: pitch, lengthMillimeters: length, leftHand, starts, form } = params;
  const lead = pitch * starts;
  // Standard radial thread engagement depth based on form & pitch.
  const rawDepth =
    form === "trapezoidal" || form === "acme"
      ? 0.5 * pitch
      : form === "buttress"
        ? 0.6 * pitch
        : 0.6134 * pitch;
  const depth = Math.min(rawDepth, faceRadius * 0.45);
  if (depth <= 1e-5) throw new Error("Thread depth is too small for this cylinder.");

  // Flank half-angles in radians for each profile form.
  const halfAngle =
    form === "trapezoidal"
      ? (15 * Math.PI) / 180
      : form === "acme"
        ? (14.5 * Math.PI) / 180
        : (30 * Math.PI) / 180;
  const maxHalfBase = pitch * 0.44;
  const halfBase = Math.min(depth * Math.tan(halfAngle) + (form === "v60" ? 0 : pitch * 0.14), maxHalfBase);
  const halfCrest = form === "v60" ? 0 : Math.min(pitch * 0.15, halfBase * 0.6);
  const clearance = Math.min(0.08, faceRadius * 0.08);

  let combined: Shape3D | undefined;
  for (let s = 0; s < starts; s++) {
    // Shift start axially by s * pitch to generate each start evenly around the lead.
    const origin = add(startCenter, scale(inwardDirection, -lead + s * pitch));
    const helix = own(makeHelix(lead, length + 2 * lead, faceRadius, origin, inwardDirection, leftHand));
    const first = helix.edges[0];
    const startPoint = deleteAfterVectorTuple(first.startPoint) as V3;
    helix.edges.forEach((e) => e.delete());

    // Local profile frame: X = outward radial from axis, Y = along cylinder axis.
    const radialOut = unit(sub(startPoint, origin));
    const planeX = isExternal ? scale(radialOut, -1) : radialOut; // +X points INTO the solid material
    const planeY = inwardDirection;
    const plane = own(new Plane(startPoint, planeX, cross(planeX, planeY)));

    let sketchBuilder;
    if (form === "buttress") {
      // Asymmetric 7° load flank / 45° trailing flank.
      sketchBuilder = draw([-clearance, -halfBase * 0.4])
        .lineTo([depth, -halfCrest])
        .lineTo([depth, halfCrest])
        .lineTo([-clearance, halfBase])
        .close();
    } else if (form === "trapezoidal" || form === "acme") {
      sketchBuilder = draw([-clearance, -halfBase])
        .lineTo([depth, -halfCrest])
        .lineTo([depth, halfCrest])
        .lineTo([-clearance, halfBase])
        .close();
    } else {
      sketchBuilder = draw([-clearance, -halfBase])
        .lineTo([depth, 0])
        .lineTo([-clearance, halfBase])
        .close();
    }

    const section = own(sketchBuilder.sketchOnPlane(plane));
    const swept = genericSweep((section as unknown as { wire: Wire }).wire, helix, {
      frenet: true,
      transitionMode: "transformed",
    });
    if (!isShape3D(swept) || measureVolume(swept) <= 1e-9) {
      throw new Error("The modelled thread groove could not be swept along this cylinder.");
    }
    const ownedSwept = own(swept);
    combined = combined ? own(combined.fuse(ownedSwept)) : ownedSwept;
  }
  return combined!;
}
