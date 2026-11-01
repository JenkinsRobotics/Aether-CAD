/** Build — the Assembly workspace's first tab: what is in the assembly.
 *
 *  Onshape's BUILD. Bringing parts in, copying and replacing them, and the
 *  per-instance state (grounded, suppressed, removed). Mates are a tab of
 *  their own; this one is about the components.
 */
import { assemblyProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const assemblyBuildWorkspace: CADRibbonWorkspaceDefinition = {
  id: "assembly-build",
  label: "Build",
  groups: [
    { id: "build-document", label: "Assembly", tools: [
      tool("assembly-new", "New Assembly", "assembly", "new-assembly"),
      tool("assembly-open", "Open Assembly", "open", "open-assembly"),
      tool("assembly-save", "Save Assembly", "save", "save-assembly"),
    ] },
    { id: "build-insert", label: "Insert", tools: [
      tool("assembly-insert", "Insert Part", "insert", "assembly-insert-component"),
      tool("assembly-json", "From JSON", "assembly", "assembly-from-json"),
      tool("assembly-template", "Define Part", "part", "assembly-part-template"),
      tool("assembly-fastener", "Standard Part", "thread", "assembly-insert-standard-part"),
      tool("assembly-resize-part", "Change Part Size", "thread", "assembly-resize-standard-part"),
      tool("assembly-linked", "Linked Copy", "link", "assembly-linked-copy"),
      tool("assembly-variant", "Variant", "copy", undefined, assemblyProducer),
      tool("assembly-replace", "Replace", "replace-face", undefined, assemblyProducer),
      tool("assembly-independent", "Make Independent", "part", "assembly-make-independent"),
      tool("assembly-from-bodies", "Bodies to Component", "part", "assembly-bodies-to-component"),
    ] },
    { id: "build-modify", label: "Modify", tools: [
      tool("assembly-array-linear", "Linear array", "pattern", "assembly-linear-array"),
      tool("assembly-array-circular", "Circular array", "pattern", "assembly-circular-array"),
      tool("assembly-recipe-undo", "Undo edit", "back", "assembly-undo-recipe"),
      tool("assembly-recipe-redo", "Redo edit", "back", "assembly-redo-recipe"),
      tool("assembly-cut", "Assembly Cut", "cut", undefined, assemblyProducer),
      tool("assembly-drag", "Drag with Mates", "move", undefined, assemblyProducer),
      tool("assembly-placement", "Move / Rotate", "move", "assembly-edit-component"),
      tool("assembly-edit", "Open Part", "sketch", "assembly-open-component-part"),
      tool("assembly-return", "Return", "back", "show-mates"),
    ] },
    { id: "build-instance", label: "Instance", tools: [
      tool("assembly-ground", "Ground", "ground", "assembly-toggle-grounded"),
      tool("assembly-suppress", "Suppress", "suppressed", "assembly-toggle-suppressed"),
      tool("assembly-remove", "Remove", "remove", "assembly-remove-instance"),
      tool("assembly-part-props", "Part Properties", "settings", "assembly-part-properties"),
    ] },
  ],
};
