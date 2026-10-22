/** Sheet Metal — folded plate with bend rules.
 *
 *  Onshape's sheet metal toolbar, in its order. The base plate carries its rule
 *  (thickness, bend radius, K factor); Flange and Hem bend from picked edges;
 *  Unfold lays the bends flat with the bend allowance and Refold brings them
 *  back; Flat pattern DXF sections the sheet at mid-thickness. The rest stays
 *  greyed and says so (`aether-engine/src/document/sheet-metal.ts`).
 */
import { sheetMetalProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const sheetMetalWorkspace: CADRibbonWorkspaceDefinition = {
  id: "sheet-metal",
  label: "Sheet Metal",
  groups: [
    { id: "sheet-create", label: "Create", tools: [
      tool("sheet-model", "Sheet metal model", "sheet", "feature-sheet-base"),
      tool("sheet-flange", "Flange", "draft", "feature-sheet-flange"),
      tool("sheet-hem", "Hem", "offset", "feature-sheet-hem"),
      tool("sheet-tab", "Tab", "rectangle", undefined, sheetMetalProducer),
      tool("sheet-bend", "Fold", "hinge", "feature-sheet-fold"),
      tool("sheet-jog", "Jog", "curve", undefined, sheetMetalProducer),
      tool("sheet-form", "Form", "emboss", undefined, sheetMetalProducer),
      tool("sheet-loft", "Sheet metal loft", "loft", undefined, sheetMetalProducer),
    ] },
    { id: "sheet-modify", label: "Modify", tools: [
      tool("sheet-unfold", "Unfold", "sheet", "feature-sheet-unfold"),
      tool("sheet-refold", "Refold", "hinge", "feature-sheet-refold"),
      tool("sheet-flat-dxf", "Flat pattern DXF", "export", "sheet-export-flat-dxf"),
      tool("sheet-make-joint", "Make joint", "weld", undefined, sheetMetalProducer),
      tool("sheet-corner", "Corner", "chamfer", undefined, sheetMetalProducer),
      tool("sheet-bend-relief", "Bend relief", "trim", undefined, sheetMetalProducer),
      tool("sheet-corner-break", "Corner break", "fillet", undefined, sheetMetalProducer),
    ] },
    { id: "sheet-finish", label: "Finish", tools: [
      tool("sheet-finish-model", "Finish sheet metal model", "check", undefined, sheetMetalProducer),
      tool("sheet-flex-pcb", "Flex PCB model", "frame", undefined, sheetMetalProducer),
      tool("sheet-finish-flex-pcb", "Finish flex PCB model", "commit", undefined, sheetMetalProducer),
    ] },
  ],
};
