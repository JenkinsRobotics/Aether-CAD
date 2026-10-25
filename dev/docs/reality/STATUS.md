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


## 2026-10-24 — Guarded Assembly editing for live agents

Qualified source, not an installed-release claim.
The existing Assembly editor now exposes explicit-ID updates for instance names,
rest placement/visibility, grounding and suppression; connectors and mates;
DOF values/limits; linear, gear, screw and rack/pinion relations; and guarded
removal. Contacts are capability-gated: the pinned codec does not offer contact
editing, and the tool refuses it rather than claiming a simulated result.

Edits reuse the UI's payload validators and native workspace operations on an
isolated serialized workspace. Only a solved, revision-coherent result replaces
the open document. Expected revision, document context, writable access and
cancellation are rechecked after asynchronous work. Failed edits preserve the
live handle, authored placements and history. Direct DOF editing requires a free,
active DOF; dependent values are changed through their relation. Source Part
geometry and rest transforms are never replaced by a solved occurrence pose.

Inspection pages parts, instances, connectors, mates, relations, contacts, solve
results and BOM in groups of 25 without embedding Part geometry. Canonical output
uses meters/radians; edit inputs explicitly use millimeters/degrees. Relation
ratios use driven SI units per driver SI unit. Existing compose/undo/redo tools
now require expected_revision too, including the Studio test-provider consumer.
One atomic edit/recipe undo step is available and invalidated by intervening
ordinary Assembly edits; this is not a full assembly history implementation.

Qualification: 1,816 app tests pass (one existing skip), including isolated
handle atomicity, stale/context/read-only/cancellation races, failed solves and
unit/ID/suppression validation. TypeScript and frontend/worker builds pass. The
worker remains exactly SHA-256
`0939774f6b26b9b2018ccee3640a6d786059e19e83137b73fa1c2fd7b31673b2`,
identical to the previous 260-test worker qualification; engine sources are unchanged.
All six actual MCP/browser steps pass: compose/inspect, joint values and limits,
stale refusal/undo/redo, relation edits and dependent-value refusal, mate
create/edit/remove and visibility, connector dependency refusal, and stored-file
reopen with exact authored placements. The contact-capability refusal is tested,
not contact functionality. No browser errors were recorded. The Animation
browser regression also passes. The existing eight-instance UI/provider-fixture regression also passes.
Final review identified an additional stale-edit ABA case: the native revision
counter repeats after undo. Live tools now require an opaque projection token
and expose source_revision separately for archive comparisons. The old token is
refused after undo/divergent edit or reopen, even if the numeric counter repeats.
All 64 focused assembly/controller/context tests pass after the token change,
and the type/frontend/worker build passes again. Both final browser suites pass
on those frozen bytes: all six actual MCP flows including the divergent undo
branch and stale request after reopening, plus the eight-instance UI/provider
recipe, history and reopen workflow. Evidence: `.verification/baseline-2026-10-24/assembly-edit-*`
and `release-assembly-edit-browser/results.json`. No installed update,
other-app change, database/settings mutation or remote push is claimed.
Remaining: general UI/agent history, nested assembly editing, cam/sweep joints,
contact support from a qualified codec, component/Parts panel consistency,
assembly drawings and broader SolidCraft tool variants. The overall CAD baseline
goal remains active.


## 2026-10-24 — CAD-owned Assembly runtime and contact validation

Source implementation under qualification; no installation change.
Portable Assembly metadata now uses CAD's own immutable worker and codec20 through
an explicit workspace operation on the existing authorized `/api/cad/assembly`
service. The browser retains separate archive handles; the server receives bytes,
not paths or stateful Animation handles. Legacy assembly-solve requests and all
host limits remain unchanged. Cancellation, concurrent edits, closed handles and
malformed/mismatched responses cannot replace the cached archive. New workspace
identity derives from a unique editor handle.

Canonical Animation commit 453b382 protects contact sets, enable-all intent and
cam metadata with graph schema 2. Plain files retain graph schema 1 and exact
old/new/old roundtrips; buggy legacy unversioned contact archives upgrade on save.
The old reader now rejects new intent instead of silently discarding it. The
Animation app itself is unchanged; only CAD's immutable five-module dependency
snapshot is updated. Cam authoring/profile sampling remains unsupported in CAD.

Live contact-enabled edits, whether UI or agent initiated, use an isolated archive
and exact Aether/OCCT validation before the live swap. Overlapping endpoints,
missing exact Part geometry and incomplete placements refuse the edit. Suppressed
sets stay off; suppressed occurrences are omitted. With no named sets, all active
occurrences are checked. Hidden occurrences remain physical participants.
Checks are discrete at evaluated poses, not continuous swept collision detection.
Kernel failure paths release retained shapes and propagate measurement failures.

Initial qualification: 1,824 app tests (one existing skip), 1,126 engine tests,
268 native worker tests, type/build checks and saved headless geometry/region
flows passed. The first real browser run then found a pose mismatch: the native
workspace's editable DOFs are marked `free`, but the Aether job translator only
forwarded values marked `driven`. Contact checking therefore evaluated a slider
at zero despite its saved 25 mm value. The translator now preserves authored
free/explicitly-driven values while leaving dependent values to relations. Two
actual solver regressions cover translation and rotation without altering rest
placements. All 76 affected tests and the new build pass. The rebuilt worker passes all 268
native tests and fresh-process geometry/region workflows. All six MCP/browser
flows pass, including actual overlap rejection, suppressed sets, clear slider
movement and schema-2 save/reopen (`contactsVerified: true`, no browser errors).
The browser asserts no calls to `/cad/rpc`; the existing Animation regression
also passes. The existing eight-instance UI/scripted-provider recipe regression also passes,
including history and reopen; no real model inference is claimed. This failure is retained
in `assembly-owned-browser.log` and its evidence, not presented as a passing run. General assembly history, contact
set editing/list panels, nested editing and cam/sweep joints remain separate gaps.

A deliberate nonzero-DOF probe across the seven movable mate kinds found two
additional pre-existing interoperability gaps: combined Ball XYZ rotations use
different angle conventions between the saved workspace and the TS solver
(quaternion agreement 0.997972 instead of 1), and Pin Slot travel is translated
as Z instead of X. Its canonical rotation/translation order also requires review.
These are recorded as the next bounded assembly task, not hidden by the passing
slider/revolute tests. Other probed kinds agree in position and orientation.
Evidence: `.verification/baseline-2026-10-24/assembly-owned-pose-probe.log` and
`probe-assembly-values.py`. No full assembly parity is claimed.

Final worker SHA-256: `acdfefceed193f27f0669b585160a43b59a210562892743acb6bb75e107606fd`.
Frontend and worker are verified together. Frozen evidence: `assembly-owned-pose-*`,
`assembly-owned-browser/results.json`, and `assembly-owned-regression-browser/`
under `.verification/baseline-2026-10-24/`. Type checks pass for app and engine;
all 268 final native tests pass. This is a local source/staging checkpoint only:
no running host, installed app, database, network setting or remote was changed.
