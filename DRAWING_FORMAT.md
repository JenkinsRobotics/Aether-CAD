# Aether Drawing format 1

`.acdrawing` is a local, self-contained CAD document. Its canonical authoring
contract is `aether-engine/src/drawing/document.ts`; the UI and headless runner
apply the same validated commands. This does not change the Part format or the
Studio database. Studio revision/storage integration for drawings is not yet
connected.

The JSON root contains `format: "aether-drawing"`, `formatVersion: 1`,
`documentId`, `name`, an embedded `source` Part document, `activeSheetId` and
`sheets`. IDs must be unique within the drawing. Coordinates, paper dimensions
and model dimensions use millimeters. View `scale` is paper length/model length.

Each sheet owns its paper size, first/third-angle projection standard, views and
annotations. Views specify an orientation, position, scale, hidden-line switch
and optional exact body IDs. An optional `parentId` references an independent
front view on the same sheet. Its top/bottom/left/right projections inherit its
scale and body selection, align on the appropriate coordinate, and follow the
sheet's projection standard. Removing a view with dependent views or dimensions
is refused. Removing a whole sheet is reversible in the editor; at least one
sheet must remain.

Notes store text and a sheet position. Overall width/height dimensions reference
a view ID and a paper position/precision. Their values come from OCCT's projected
curve extrema in model units. They do not reference transient tessellation or
HLR edge indices. Edge-attached, angular and radial dimensions remain future work.

The source Part is an embedded snapshot, so reopening the drawing does not
require the original file or Studio connection. Rebuild explicitly refreshes it
from the currently open Part with the same `documentId`. An unrelated Part cannot
replace it. The workspace marks views stale when the open source Part differs
from the saved snapshot. Rebuild, undo/redo and export use that exact snapshot;
export before a refresh intentionally retains its old geometry.

Projected geometry is disposable. The OCCT worker evaluates source bodies and
classifies their edges together, including occlusion between bodies. Lines,
circles and circular arcs remain analytic. Other curves currently use display
chords at 0.01 mm model-space tolerance and are reported as approximated. Those
chords do not determine overall dimension values. No projected geometry, meshes
or topology indices are saved in the authoring file.

SVG and DXF export the active sheet in physical sheet millimeters. Hidden edges
are dashed; the exports contain the current notes and dimension graphics.
Sections, assembly source drawings/BOMs, PDF, arbitrary edge-attached dimensions,
title-block editing and placement by dragging are not implemented in this slice.

## Local headless commands

The packaged `service/aether_cad_service/runtime/runner.mjs` reads one JSON
request from stdin. `{ "phase": "drawing_docs" }` returns discovery information.
`phase: "drawing"` accepts:

- `operation: "create"`, `content`: a serialized `.acpart`.
- `operation: "mutate"`, `content`: a serialized `.acdrawing`, and `command`:
  a `DrawingCommand` from the canonical contract.
- `operation: "inspect"`, `content`: a serialized `.acdrawing`.
- `operation: "export"`, `content`, `format: "svg" | "dxf"`, and optional
  `sheet_id`.

Create/mutate/inspect return the complete serialized drawing, source/revision
hashes, sheet/view IDs, model/sheet bounds and regenerated dimensions. Failed
validation or geometry returns an error and no replacement content. Each request
is independent. This command surface is local; it is not yet registered as a
Studio MCP or live AI panel tool. Run `node scripts/verify-drawings.mjs` after
building to qualify it in fresh processes.
