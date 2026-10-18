/** Output — drawings, export and publishing. */
import { exportProducer, projectProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const outputWorkspace: CADRibbonWorkspaceDefinition = {
  id: "output",
  label: "Output",
  groups: [
    { id: "output-model", label: "Model", tools: [
      tool("output-export", "Export Center", "export", "show-export"),
      tool("output-step", "STEP", "export", "show-export"),
      tool("output-stl", "STL", "export", "show-export"),
      tool("output-amf", "AMF", "export", undefined, exportProducer),
      tool("output-3mf", "3MF", "export", undefined, exportProducer),
    ] },
    { id: "output-drawing", label: "Drawing", tools: [
      tool("output-drawing-workspace", "Drawing", "document", "open-drawing"),
      tool("output-dxf", "DXF", "document", undefined, exportProducer),
      tool("output-pdf", "PDF / Print", "document", undefined, exportProducer),
      tool("output-cut-list", "Cut List", "list", undefined, exportProducer),
    ] },
    { id: "output-project", label: "Workspace", tools: [
      tool("output-save-assembly", "Save Assembly", "save", "save-assembly"),
      tool("output-project-file", "Workspace File", "document", undefined, projectProducer),
    ] },
  ],
};
