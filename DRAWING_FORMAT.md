# Aether Drawing format 1

`.acdrw` is a self-contained CAD Drawing document; `.acdrawing` remains accepted as an alias. Its canonical authoring
contract is `aether-engine/src/drawing/document.ts`; the UI and headless runner
apply the same validated commands. This does not change the Part format or the
Studio database. Drawings use the existing Studio document storage, autosave, revision and conflict-recovery transport, with their own file identity.

The JSON root contains `format: "aether-drawing"`, `formatVersion: 1`,
`documentId`, `name`, an embedded `source` Part document, `activeSheetId` and
`sheets`. An optional `sourceReference` stores `{fileId, partId?, branch?, revision?}`. The app interprets this locator through Studio permissions; the kernel never performs network reads. IDs must be unique within the drawing. Coordinates, paper dimensions
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
from the saved source file/branch (and project Part element, when applicable), or the currently open local Part, with the same `documentId`. An explicit source revision stays pinned; otherwise refresh reads the latest saved revision of that branch. An unrelated Part cannot
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
is independent. This raw runner surface is local. The open Drawing editor separately exposes the same validated commands to AI and explicitly shared live MCP sessions; closed-file worker drawing tools remain unregistered. Run `node scripts/verify-drawings.mjs` after
building to qualify it in fresh processes.

## Studio lifecycle and live agents

Creating a drawing flushes the current Part and builds the new drawing before
switching to a new file identity. Opening a downloaded drawing likewise creates
an independent draft. Edits immediately enter the normal durable recovery queue;
Save flushes Studio, while Download drawing exports the portable file. Opening
an existing drawing rebuilds its embedded source snapshot. Returning to 3D opens
its original source locator; a local snapshot without a locator opens as a new
Part copy. No drawing edit writes to its source Part. Failed source reads or
projection retain the last drawing and history.

The active Drawing's AI/live MCP catalog contains `aether_cad_drawing_inspect`,
`_edit`, `_refresh`, `_undo`, `_redo`, and `_export`, plus CAD discovery. These are
available through Studio's existing explicit Share this editor flow. Mutation
and export require the inspected `expected_revision`; mutation also rechecks
permissions, cancellation and document context after exact projection. Annotation
inspection is paged, and exports above 2 MiB use the UI download control. Tool
exports return text; they do not publish a file. A hosted read-only revision
refuses edits while still allowing sheet browsing and SVG/DXF export. CAD metadata operations can rename/copy the drawing and edit its properties without changing the embedded source. Real-provider inference and closed-file MCP drawing operations are
not claimed by this implementation.
