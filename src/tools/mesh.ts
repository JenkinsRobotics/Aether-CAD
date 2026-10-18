/** Mesh — Fusion's MESH tab. Triangle geometry, not B-rep.
 *
 *  Entirely greyed: Aether has no mesh body type. FreeCAD's Mesh workbench
 *  could back most of this, but nothing carries a mesh across the JSON
 *  boundary yet, so there is no producer to call.
 */
import { meshProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const meshWorkspace: CADRibbonWorkspaceDefinition = {
  id: "mesh",
  label: "Mesh",
  groups: [
    { id: "mesh-create", label: "Create", tools: [
      tool("mesh-insert", "Insert Mesh", "import", undefined, meshProducer),
      tool("mesh-tessellate", "BRep to Mesh", "wireframe", undefined, meshProducer),
    ] },
    { id: "mesh-modify", label: "Modify", tools: [
      tool("mesh-remesh", "Remesh", "grid", undefined, meshProducer),
      tool("mesh-reduce", "Reduce", "scale", undefined, meshProducer),
      tool("mesh-smooth", "Smooth", "curve", undefined, meshProducer),
      tool("mesh-plane-cut", "Plane Cut", "split", undefined, meshProducer),
      tool("mesh-separate", "Separate", "copy", undefined, meshProducer),
    ] },
    { id: "mesh-repair", label: "Repair", tools: [
      tool("mesh-close-holes", "Close Holes", "face", undefined, meshProducer),
      tool("mesh-delete-faces", "Delete Faces", "remove", undefined, meshProducer),
    ] },
  ],
};
