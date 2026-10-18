/** Sheet Metal — folded plate with bend rules.
 *
 *  Onshape's sheet metal toolbar, in its order. Entirely greyed: this needs
 *  FreeCAD's SheetMetal add-on, which the engine neither ships nor translates,
 *  and a sheet metal body carries bend rules and a flat pattern that Aether's
 *  document has no room for yet. Named now so the gap is a review item rather
 *  than a mystery, and so the tab is not an empty promise.
 */
import { sheetMetalProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const sheetMetalWorkspace: CADRibbonWorkspaceDefinition = {
  id: "sheet-metal",
  label: "Sheet Metal",
  groups: [
    { id: "sheet-create", label: "Create", tools: [
      tool("sheet-model", "Sheet metal model", "sheet", undefined, sheetMetalProducer),
      tool("sheet-flange", "Flange", "draft", undefined, sheetMetalProducer),
      tool("sheet-hem", "Hem", "offset", undefined, sheetMetalProducer),
      tool("sheet-tab", "Tab", "rectangle", undefined, sheetMetalProducer),
      tool("sheet-bend", "Bend", "hinge", undefined, sheetMetalProducer),
      tool("sheet-jog", "Jog", "curve", undefined, sheetMetalProducer),
      tool("sheet-form", "Form", "emboss", undefined, sheetMetalProducer),
      tool("sheet-loft", "Sheet metal loft", "loft", undefined, sheetMetalProducer),
    ] },
    { id: "sheet-modify", label: "Modify", tools: [
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
