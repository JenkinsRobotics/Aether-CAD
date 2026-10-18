/** Home contains insertion and selection tools; document actions live in document controls. */
import { tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const homeWorkspace: CADRibbonWorkspaceDefinition = {
  id: "home",
  label: "Home",
  groups: [
    { id: "home-insert", label: "Insert", visibleToolCount: 2, tools: [
      tool("insert-svg", "Insert SVG", "document", "insert-vector-svg"),
      tool("insert-canvas", "Canvas", "document", "insert-canvas"),
      tool("insert-decal", "Decal", "document", "insert-decal"),
      tool("home-import", "Import CAD", "import", "insert-step"),
      tool("insert-mesh", "Insert Mesh", "part", "insert-mesh"),
      tool("insert-mcmaster", "McMaster-Carr", "part", "insert-mcmaster"),
      tool("insert-dxf", "Insert DXF", "import", "insert-vector-dxf"),
    ] },
    { id: "home-selection", label: "Select", singleTool: true, tools: [
      tool("home-select-auto", "Select", "select", "selection-auto"),
      tool("selection-directional-tool", "Directional Selection", "select", "selection-directional"),
      tool("selection-window-tool", "Window Selection", "select", "selection-window"),
      tool("selection-freeform-tool", "Freeform Selection", "select", "selection-freeform"),
      tool("selection-paint-tool", "Paint Selection", "select", "selection-paint"),
      tool("selection-crossing-tool", "Crossing Selection", "select", "selection-crossing"),
      tool("selection-clear-tool", "Clear Selection", "select", "selection-clear"),
      tool("selection-priority-body-tool", "Body", "part", "selection-priority-body"),
      tool("selection-priority-face-tool", "Face", "face", "selection-priority-face"),
      tool("selection-priority-edge-tool", "Edge", "edge", "selection-priority-edge"),
      tool("home-select-component", "Component", "assembly", "selection-component"),
      tool("home-select-body", "Body", "part", "selection-body"),
      tool("home-select-face", "Face", "face", "selection-face"),
      tool("home-select-edge", "Edge", "edge", "selection-edge"),
      tool("home-select-vertex", "Vertex", "vertex", "selection-vertex"),
    ] },
  ],
};
