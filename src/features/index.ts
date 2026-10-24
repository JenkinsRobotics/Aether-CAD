import {transformEditor} from './part-transform';
import {offsetFaceEditor} from './offset-face';
import {importCADEditor} from "./import-cad";
import {faceExtrudeEditor} from "./face-extrude";
import {booleanEditor} from "./boolean";
import {patternEditor} from "./pattern";
import {draftEditor} from "./draft";
import {loftEditor} from "./loft";
import {holeEditor} from "./hole";
import {splitEditor} from "./split";
import {deleteFaceEditor} from "./delete-face";
import {pipeEditor} from "./pipe";
import {boundingSolidEditor} from "./bounding-solid";
import {threadEditor} from "./thread";
import {coilEditor} from "./coil";
import {surfaceEditors} from "./surface";
import {sheetMetalEditors} from "./sheet-metal";
import {removeBodyEditor} from "./remove-body";
import {bossEditor} from "./boss";
import {restEditor} from "./rest";
import { importSTEPEditor } from "./import-step";
/** The feature editor registry. Adding a feature is one file plus one line
 *  here — not an edit to three parallel if/else chains, which is what this
 *  directory replaced. */
import { extrudeEditor } from "./extrude";
import { revolveEditor } from "./revolve";
import { mirrorEditor } from "./mirror";
import { chamferEditor, filletEditor } from "./edge-finish";
import { sweepEditor } from "./sweep";
import { shellEditor } from "./shell";
import { curve3dEditor } from "./curve3d";
import { lipEditor } from "./lip";
import { snapFitEditor } from "./snap-fit";
import { boundaryFillEditor } from "./boundary-fill";
import { splitFaceEditor } from "./split-face";
import { surfaceTrimEditor } from "./surface-trim";
import type { FeatureEditor } from "./shared";

export const featureEditors: readonly FeatureEditor[] = [
  transformEditor,
  offsetFaceEditor,
  faceExtrudeEditor,
  importSTEPEditor,
  importCADEditor,
  extrudeEditor,
  revolveEditor,
  sweepEditor,
  mirrorEditor,
  filletEditor,
  chamferEditor,
  shellEditor,
  holeEditor,
  splitEditor,
  deleteFaceEditor,
  pipeEditor,
  boundingSolidEditor,
  threadEditor,
  coilEditor,
  ...surfaceEditors,
  ...sheetMetalEditors,
  removeBodyEditor,
  bossEditor,
  restEditor,
  loftEditor,
  draftEditor,
  patternEditor,
  booleanEditor,
  curve3dEditor,
  lipEditor,
  snapFitEditor,
  boundaryFillEditor,
  splitFaceEditor,
  surfaceTrimEditor,
];

export function featureEditor(type: string): FeatureEditor | undefined {
  return featureEditors.find((editor) => editor.type === type);
}

export type { FeatureEditor, FeatureEditorContext, Controls } from "./shared";
