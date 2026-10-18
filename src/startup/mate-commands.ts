/** One command per mate kind, plus the solve.
 *
 *  FreeCAD's Assembly workbench solves thirteen joint types, so the ribbon
 *  offers thirteen buttons rather than one generic "Mate" that then asks which
 *  kind — picking the mate you want is the gesture, the way Onshape does it.
 *
 *  Which kinds are live is asked of the engine, never assumed: a button the
 *  solver would refuse is the bug that shipped Shell and Sweep, and here it
 *  would only surface after the user had authored the whole mate.
 */
import { cadCommands, type CADCommandID } from "../cad-command-registry";
import { cadPresentation } from "../cad-presentation-store";
import { assemblyMateKinds, type AssemblyMateKind } from "../freecad-assembly";
import { assemblyMateTypeOptions } from "../cad-mate-authoring";

/** Every kind Aether names, with the label the ribbon shows. Order is the
 *  ribbon's: the mates people reach for first come first. */
export const MATE_KINDS: readonly (readonly [AssemblyMateKind, string])[] = [
  ["fastened", "Fastened"],
  ["revolute", "Revolute"],
  ["cylindrical", "Cylindrical"],
  ["prismatic", "Slider"],
  ["ball", "Ball"],
  ["distance", "Distance"],
  ["parallel", "Parallel"],
  ["perpendicular", "Perpendicular"],
  ["angle", "Angle"],
  ["rack-pinion", "Rack and Pinion"],
  ["screw", "Screw"],
  ["gears", "Gears"],
  ["belt", "Belt"],
];

export const mateCommandID = (kind: AssemblyMateKind): CADCommandID =>
  `assembly-mate-${kind}` as CADCommandID;

export interface MateCommandHost {
  /** Start authoring a mate of this kind. */
  beginMate(kind: AssemblyMateKind): void;
  /** Re-solve the open assembly. */
  solve(): void;
}

export function registerMateCommands(host: MateCommandHost): void {
  for (const [kind] of MATE_KINDS)
    cadCommands.register(mateCommandID(kind), () => host.beginMate(kind));
  cadCommands.register("assembly-solve", () => host.solve());
}

/** Enable a mate only when it can be authored *and* solved.
 *
 *  Two capabilities, and both are needed. FreeCAD's solver handles thirteen
 *  kinds, but a mate is still committed through the workspace's `add_mate`,
 *  which accepts the three of Assembly v1. Enabling a kind the solver knows
 *  but the workspace refuses would fail only after the user had authored the
 *  whole mate — the Shell and Sweep mistake, later and more expensive.
 *
 *  Unreachable engine means no mate is offered: a button that cannot solve is
 *  worse than a button that is plainly unavailable.
 */
export async function syncMateAvailability(): Promise<readonly AssemblyMateKind[]> {
  let solvable: readonly AssemblyMateKind[] = [];
  try {
    solvable = await assemblyMateKinds();
  } catch {
    solvable = [];
  }
  const authorable = new Set(assemblyMateTypeOptions.map((option) => option.value));
  const usable = new Set(solvable.filter((kind) => authorable.has(kind as never)));
  for (const [kind] of MATE_KINDS)
    cadCommands.setEnabled(mateCommandID(kind), usable.has(kind));
  cadCommands.setEnabled("assembly-solve", usable.size > 0);
  return [...usable];
}

/** Open the mate dialog on a chosen kind. Separate from the command so the
 *  dialog can be reached from the tree and the viewport too. */
export function beginMateAuthoring(kind: AssemblyMateKind): void {
  cadPresentation.patch({ matePreview: null });
  cadPresentation.dispatch({ type: "show-start-dialog", dialog: "create-mate" });
  window.dispatchEvent(new CustomEvent("aether-mate-kind", { detail: kind }));
}
