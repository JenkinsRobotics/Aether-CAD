# Aether CAD source status

## 2026-10-24 — shared sketch-region selection for UI and agents

Source on `alpha-0.1`; this entry does not mean the installed release has changed.
The baseline goal and remaining acceptance gates are in
`../roadmap/CAD_Baseline_0_1.md`. Full SolidCraft baseline parity is not complete.

### Functional changes

- Mouse region picking classifies authored circles, arcs, elliptical arcs,
  cubic splines and rational conics using curve intersections. Display chords
  no longer decide whether a click is inside a disc or its surrounding ring.
  Boundary or numerically ambiguous points do not select a region.
- Agent Extrude and Revolve select an individual closed cell with
  `profile_point_mm` in local sketch millimeters. Extrude also accepts explicit
  `all_regions: true`. Omitting a choice on a multi-region sketch is rejected.
  Both adapters use the same persistent source references as feature dialogs.
- Agent sketch inspection pages closed-region geometry and holes alongside
  authored contours and constraints. Indices are transient, not saved references.
- Rectangle, circle and polygon agent tools accept a principal plane or an
  explicit frame with perpendicular unit axes, normal offset and local-axis
  flip. Contradictory or malformed placements are rejected without changing the
  source. Convenience tools do not yet bind live construction-plane or face
  references; body-face support remains available through the canonical profile
  contract. Associative construction-plane binding needs separate verification.
- Selected regions support exact extrude/new/add/cut/revolve, driving-dimension
  changes, stable body identities and serialization/reopen. Failed or stale
  candidates retain the existing editor/program atomic-commit boundary.

### Verification

- Full app suite: 1,771 passed, one pre-existing integration skip.
- Full engine suite: 1,114 passed. Engine type check and frontend/worker build pass.
- Eight curve-containment tests cover near-edge positions, joins, tangencies,
  reversed curves, boundaries and all supported curve families. Eleven region
  workflow tests assert analytic volumes, world bounds and stable identities.
- `node scripts/verify-sketch-regions.mjs` passes against the rebuilt packaged
  runner in fresh processes: discovery, explicit overlap selection, extrusion,
  dimension edit, reopen, explicit rotated/offset/flipped planes and qualified
  program references. No Studio connection is used.
- Two old engine test fixtures failed type checking on unchanged HEAD too.
  Their stored expression field and single-body tuple annotations now match the
  real contracts; the 58 affected tests and engine type check pass.
- The mouse workflow passes all seven steps on a disposable Studio/PostgreSQL
  instance: offset plane, overlap regions, extrusion, face cut/add, upstream edit
  and reopen. There are no browser errors. All five saved stages match analytic
  volumes; the final edited and reopened body is 4,511.327050554948 mm³ with the
  same body identity. The existing Animation client regression also passes.
- Native project/settings tests now import CAD's hash-pinned codec wheel, as the
  packaged worker does. Previously they compared against a newer editable
  Animation checkout and failed deterministic byte comparisons in 15 cases.
  The five shipped codec modules are byte-for-byte unchanged from starting CAD
  commit `67c7b6a`; no dependency or document-format upgrade was made here.
- All 258 packaged-worker tests pass with the native release gates enabled;
  the 21 project/settings checks also pass independently. Fresh-process kernel
  build, exact properties, STEP export, lazy full-kernel loading and extraction
  of the standalone zipapp pass. Final inspection metadata checks pass (15 tests).

Detailed evidence, including the initially failing curved-edge regression, is
under `.verification/baseline-2026-10-24/`. Browser and worker qualification are
complete. No live host, database, settings or other app
has been changed by this source work.

### Remaining baseline work

The following drawing increment connects the authoring producer for local Part drawings. Complete the remaining drawing variants, assembly/agent editing coverage, and reference tool variants before claiming the baseline.
The reference command matrix contains historical claims that still need workflow
verification; an enabled control or a generic feature schema is not proof of parity.


## 2026-10-24 — initial functional Part drawings

This is qualified source, not an installed release claim.
The existing Drawing route now uses a canonical CAD Drawing document and the
same OCCT engine as the modeler. `.acdrawing` embeds its source Part snapshot and
saved sheet/view/annotation intent; projected edges are derived, never the saved
truth. See `DRAWING_FORMAT.md` at the repository root.

- Real base views (six orthographic directions plus isometric), hidden edges,
  and first/third-angle projected views with inherited scale and alignment.
- Multiple editable sheets, view position/scale/visibility, notes and overall
  width/height dimensions measured from geometric extrema. Source refresh
  rebuilds dimensions; changed open Parts mark their drawings stale.
- Transactional commands and undo/redo: failed validation or geometry retain the
  previous drawing and history. Drawing keyboard undo never edits the Part.
- Local save/open, SVG and DXF active-sheet export. Lines, circles and circular
  arcs remain analytic; other curve display/export chords are explicitly reported
  at 0.01 mm model-space tolerance. Overall dimension values do not use chords.
- Local headless runner discovery/create/mutate/inspect/export uses the same
  commands/projector. Fresh processes preserve IDs, dimensions and source hashes.
  It is not yet registered as a Studio MCP or live AI panel tool.

Qualification evidence is in `.verification/baseline-2026-10-24/`:

- All 1,124 engine tests pass. The full app run passed 1,775 tests with one
  existing skip and one obsolete “engine unavailable” text assertion; the
  assertion is corrected, and all 32 affected shell/drawing/controller tests pass.
- Type checking and the frontend/packaged-worker build pass. Fresh-process drawing
  commands prove associative 12 → 24 mm dimensions, inherited projection scale,
  analytic circle exports, save/reopen and invalid-refresh refusal. SVG/DXF tests
  reimport the DXF to verify physical millimeter scale and layers.
- All 258 packaged-worker release tests pass against the finished package.
  An earlier run overlapped a rebuild and failed because the output directory
  temporarily lacked runner.pyz; this was a qualification scheduling error.
  RELEASING.md now requires builds to finish before worker tests start.
- The real authenticated browser flow passes base/projected views, notes and
  dimensions, source-feature editing, explicit rebuild, keyboard undo/redo,
  invalid edits, SVG/DXF downloads, local-file reopen, multiple sheets and
  return to the model. The disposable host also verifies the existing Animation
  browser client. Scripts are saved in `scripts/verify-drawings*.mjs`.
- Two earlier browser attempts used outdated selectors (the old floating Drawing
  button and a sheet label without its tree-expansion prefix). Both are corrected.
  Drawing mode retains the model panel DOM/layout but clears modeling controls;
  responsive drawing layout avoids horizontal sheet clipping.

Native/installed apps, Map, host, database and network settings remain untouched.

Remaining: section and assembly drawings/BOMs, arbitrary edge-attached/angular/
radial dimensions, PDF, title-block editing, placement by dragging, persistent
Studio drawing registration and full live-agent exposure. Current source refresh
is explicit and requires the same Part document ID; no cross-document automatic
update subscription is claimed. The broader CAD baseline goal remains active.


## 2026-10-24 — Drawing storage and live agent editing

Qualified source, not an installed release claim. The Drawing
workspace now saves its own `.acdrw` file through Studio's existing autosave and
recovery adapter. Legacy `.acdrawing` files still open. The embedded Part remains
the reproducible geometry source; an optional file/branch/revision/Part locator
supports explicit source refresh without changing the Drawing's save target.

- New/imported drawings detach into their own file identity after the previous
  file is flushed. Reload reopens the Drawing; returning to 3D opens its source.
  Conflicting recovery retains its original revision instead of overwriting a
  newer stored file. Source reads never retarget autosave.
- The existing new-design menu creates a real Drawing. CAD's portable metadata
  adapter supports rename, copy, properties and Show code without changing the
  embedded source Part. It adds no Python geometry or host/database dependency.
- Live AI/shared-editor MCP discover, inspect, edit, refresh, undo/redo and export
  the open Drawing through the same validated controller as the UI. Edits require
  the inspected revision, writable access and the same context after projection;
  cancellation, invalid input and stale edits preserve the last good drawing.
- Saved read-only drawings allow browsing sheets and exporting without changing
  canonical state or history. Editing is refused. Agent exports return text and
  do not claim a saved or published file.

Qualification: all 1,786 app tests (one existing skip), 1,125 engine tests,
260 packaged-worker release tests, TypeScript checks, frontend/worker builds,
exact fresh-process drawing/region/kernel/STEP/standalone-package checks. The
initial full app run overlapped a controller test edit and observed an old
transform; the final frozen-source run passes. An earlier browser attempt caught
a stale read-only UI projection during Drawing creation, fixed by republishing
after the file transaction; another reached the expected stale-agent rejection
but its harness incorrectly asserted every MCP result must succeed. That
assertion now distinguishes expected failure receipts. Two later browser attempts
used obsolete new-design and document-title selectors; both were corrected
against the shipped shared components, without changing production code.

All ten authenticated browser steps now pass, including new Drawing creation,
separate Studio file IDs, source Part preservation, saved read-only sheet browsing,
actual live-editor MCP edit/stale refusal/undo/redo/export, and packaged metadata
rename/copy/reopen. No browser errors or server geometry requests were recorded.
The existing Animation client regression also passes. The final frozen-worker
SHA-256 is `0939774f6b26b9b2018ccee3640a6d786059e19e83137b73fa1c2fd7b31673b2`.
Evidence: `.verification/baseline-2026-10-24/drawing-lifecycle-qualified-*` and
`release-drawing-browser/results.json`. Earlier failing attempts are retained.

Remaining: sections/hatching, assembly sources/BOM, edge-attached/angular/radial
dimensions, PDF, title-block editing, drag placement and drawing version preview
images. Closed-file Studio MCP Drawing operations are not registered; local
headless and open-editor commands are separate verified paths. Real provider
inference is not claimed from a browser MCP-broker test. No full CAD parity,
installed activation, other-app change or remote push is claimed.
