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


## 2026-10-24 — Saved Assembly pose consistency

The broader nonzero-value probe is now addressed. Ball coordinates use composed
local X/Y/Z rotations; full quaternion orientation residuals retain the intended
pose across gimbal lock, half turns and multi-turn input. Pin Slot uses the
canonical Rz(angle) then Tx(travel) convention by reversing the solver endpoints
and negating both coordinates. Relation ratios and offsets transform with those
coordinates. The workspace already stores signed ratios, so CAD no longer
applies its display reversal flag a second time.

The CAD solver resolves known coordinates through relations before pose solving,
retains whole turns for fractional ratios, and verifies relation residuals as well
as mate residuals. Conflicting/invalid coordinates, unresolved partial Ball
coordinates and invalid relations refuse without publishing placements. A free
Ball without specified coordinates remains free; a driven Ball needs all three
coordinates, directly authored or resolved through relations. Job input remains
unchanged. The browser, exact contact checks and saved worker now share the
same derived pose seed in `assemblyJobFor`; the headless-only seed rewrite is
removed. Saved rest transforms remain untouched and the numerical constraints
still validate/correct the initial guess. This also keeps floating mated groups
from choosing different arbitrary rigid placements between those entry points.

The metadata audit also demonstrated two independent canonical bugs: grounding
a mate's second endpoint left the first at rest, and creating a downstream
relation before its driver evaluated the chain in the wrong order. Animation
source commit `855619103608f0c6edd79e29141af30dde39db60` corrects tree traversal,
checks conflicting grounded anchors, and resolves relation dependencies before
posing components. Cycles are rejected atomically and on loading. The schema
and authored rest transforms are unchanged. CAD adopts this only through
immutable codec21; all five bundled modules match the commit. The installed
Animation app remains unchanged.

Source qualification: 1,830 app tests pass with one existing skip; 1,137 engine
tests pass. After final validation guards and shared pose seeding, 37 focused
engine and 90 affected app tests pass. App/engine types and the final
frontend/worker build pass. Canonical
source has 76 passing workspace/bridge/Part-version tests. The final packaged
worker includes 39 saved/reopened pose comparisons covering all eight mate types,
both grounding directions, rotated connectors, reversed relations with offsets,
multi-turn relation chains, and a floating mated pair with a separate ground.
All 307 final native tests pass. Fresh-process exact geometry, STEP/kernel/zipapp
and saved sketch-region checks pass. The existing eight-instance UI/scripted
provider composition, history and save/reopen regression passes, along with its
Animation-client regression; no real model inference is claimed.

Final worker SHA-256:
`75569b0425185c9d2b813dd7ffa466314d20f15a48a2884bb056fc22d1bbe3b4`.
Codec21 SHA-256:
`9c1b9eef4d47a2a831b74242e0cfb9da13a53a971e1ce4b65a94e5e4012d8083`.
Source and frozen-package evidence are under
`.verification/baseline-2026-10-24/joint-pose-*`.
The final `joint-pose-qualified-browser/results.json` records all eight real
MCP/browser flows passing, with contacts verified, no browser errors and no
`/cad/rpc` requests. Ball XYZ and Pin Slot nonzero edits are contact-checked again
after saved reopen. The two earlier runs failed only during fixture connection
cleanup (duplicate names, then an overlong name truncated by the UI); the final
fixture uses short unique names and verifies their value immediately. Both
failed attempts are retained. The matching disposable-host Animation regression
also passes. No installed app, host, database, network or security setting changed.

Remaining assembly work includes multi-step UI/agent history, the UI editor for
multi-DOF mates, contact set editing/list panels, broader floating-component
qualification, nested editing, cam and sweep joints. The canonical format still
requires an acyclic mate tree with at most one incoming mate per instance;
general closed-loop assemblies remain unsupported and joint.create is marked
partial in the tracker. Contacts remain discrete pose checks, not swept collision detection. No full parity claim is made.


## 2026-10-24 — Qualified assembly editing continuity

Assembly edits from the UI and live agents now share bounded session history
(up to 64 steps and 64 MiB of archive text). Undo/redo restores qualified archives;
new edits discard the redo branch. Cmd/Ctrl-Z and Shift redo use that same
history while text fields and open authoring dialogs keep their own shortcuts.
A BOM view change preserves history, while
opening/refreshing/closing a workspace clears it. Failed or stale edits preserve
both model and history. Each UI mutation now uses an isolated candidate and the
same solve/contact gates as agents. A successful mutation adopts its already
qualified candidate directly instead of reopening it and repeating metadata
solve/projection requests. Authored file history and Studio versions are separate.
Compound insertion, independent copy, body moves, as-built joints and rigid groups
run in one private candidate and publish once. One undo restores the entire action;
a failure during any intermediate operation leaves the original model and history
unchanged. Read-only transitions, closing and concurrent edits are guarded.

The approved shared DOF dialog now selects any free coordinate on an active mate,
including Ball XYZ and mixed rotation/travel mates, with display-unit conversion
and independent limits. Dependent/suppressed coordinates cannot be edited. The
lower left panel shows canonical Assembly occurrences as Components instead of
an empty Part-only body list; hidden/suppressed occurrences remain visible as
such and select their canonical IDs. Original Part workspace presentation stays
unchanged. No new shared widget design was introduced.

The real copy workflow exposed an existing identity error hidden by mock clients:
new definitions were receiving an embedded Part with its old/generated document ID.
Geometry is now attached after the codec assigns the definition ID, inside the
same compound action. Definition updates also preserve that ownership when
extracting bodies or resizing standard parts. Original geometry remains unchanged.

Fresh full app suite: 1,840 pass, one existing skip. Final compound-action and
controller/history/presentation/agent/dialog checks: 71 pass; types/build pass.
All nine final MCP/browser flows pass on the rebuilt frontend: multi-step history,
stale/ABA refusals, relation and contact edits, save/reopen, Ball/Pin Slot UI values
and limits, keyboard undo and agent redo, canonical component selection, and
compound independent copy. The copy gate checks both embedded Part ownership and
preserved feature geometry, one-step undo/redo and saved reopen. Browser errors
and legacy /cad/rpc requests are empty. The existing eight-instance
UI/scripted-provider recipe and Animation-client regression also pass. No real
model inference is claimed.

Earlier failures remain in evidence: a stale-import unit run, a checkbox selector
that omitted accessible help text, and the real copy identity bug fixed above.
The final full browser run and final 71 focused checks use fixed source. The
native worker/codec and engine outputs are byte-identical to the prior qualified
release (worker 75569b0425185c9d2b813dd7ffa466314d20f15a48a2884bb056fc22d1bbe3b4),
retaining its 307 native/1,137 engine-test evidence. Source/codec/zipapp equality
is rechecked after the build. Evidence: `.verification/baseline-2026-10-24/assembly-continuity-*`
and `assembly-copy-identity-*`.

Unlocking multiple fixed mates still needs the same compound-action grouping;
contact-set list/edit UI remains next. Body moves between two occurrences of the
same definition need an explicit refusal check. No installation or other app changes;
overall baseline remains incomplete.


## 2026-10-24 — Assembly contact management (source qualified)

The existing Mates panel now projects saved contact sets through shared list,
menu and dialog widgets. Users can create, rename, change members, suppress,
restore and remove sets, and enable/disable checks. Suppressed occurrences stay
in authored membership and are shown explicitly. Their inactive geometry remains
excluded from checks. Editing a dialog whose canonical contact object changed
(including undo/reopen with a repeated saved revision) is refused. Read-only
controls are disabled; controller mutations retain the same atomic native and
exact-contact validation as agents. Contact failures now produce visible feedback.

Unlock runs as one compound edit; failure at a later removal leaves all original
mates intact. An Unlock with no mates to remove preserves history and redo. Body
moves between distinct occurrences of the same Part definition are refused,
avoiding the append-then-replace loss of shared bodies. These source paths are
covered by focused tests and the qualified frontend.
Initial focused checks: 78 pass. Final fixed-source full app suite: 1,852 pass,
one existing skip, including the no-op history guard. Final 80 focused checks,
types and build pass. The first browser attempt found the contact action menu was
not rendered because the shared disclosure section omits header actions; using
its standard static action header fixes it, with a regression test. Browser
qualification passes: actual UI creation, rename/member changes, suppression, retained
suppressed occurrence membership, visible overlap refusal with unchanged revision,
restore, delete, undo and saved reopen. The same fixture also passes the actual
Animation-client load/pose/serialize/reopen regression. No browser errors or legacy
/cad/rpc requests. Evidence: `.verification/baseline-2026-10-24/contacts-*`, especially
`contacts-qualified-browser/results.json`. The worker and pinned codec are byte-identical
to the previous qualified release. No installation or other app changes. Contact
checks still validate discrete solved positions, not continuous swept collision detection.


## 2026-10-24 — Contextual history controls (source qualified)

The common bottom Undo/Redo controls now route to the active Sketch, Part or
Assembly history, using the same registered operations as keyboard and agent
actions. They disable for unavailable history or an unopened Assembly. The Part
history boundary refuses stepping when its retained source snapshot belongs to
an inactive or read-only workspace, or while a sketch editor owns the interaction.
Keyboard Part undo also respects modal dialogs. Drawings keep their own history
controls and focus handling.

Focused tests: 24 pass; types/build pass. The real browser copies a component,
uses the common Undo button to remove its definition and occurrence together,
uses Redo to restore both, then checks persisted identity/geometry and reopens
with disabled empty-history controls. The Animation-client regression passes.
No page errors or legacy /cad/rpc calls. Two initial DOM fixture attempts lacked
the actual StudioWorkspace context; the corrected test uses the public shared
container. Worker/codec hashes remain unchanged. Evidence:
`.verification/baseline-2026-10-24/contextual-history-*`. No installation changes.


## 2026-10-24 — Principal drawing sections (source qualified)

Independent principal drawing views now author a cut coordinate and paper hatch
spacing through the approved drawing dialog and the same agent command. Exact
OCCT cut solids feed the existing hidden-line projector. Each cap face is intersected
with parallel planes for hatching, retaining holes and disconnected material.
No model or mesh geometry is changed. Source refresh/history/reopen and exports
use saved cut intent. Format 2 prevents old readers from silently losing it;
ordinary drawings remain format 1. Isometric/stepped cuts, cutting-line annotation,
assembly sources and broader dimension/PDF gates remain.

Checks pass for all six orientations, analytic circular edges, holes, invalid cuts
and bounded hatch workloads. The full engine suite passes 1,146 tests; the app
passes 1,856 with one existing skip. Types/build, all 308 native service tests,
fresh-process drawing source refresh/export/reopen, headless kernel and saved
sketch-region scripts pass. The frozen prior reader accepts format 1 and refuses
format 2; the candidate accepts both. All 11 authenticated browser workflows pass
(123.89 seconds), including actual section authoring, invalid-cut refusal, live
MCP cut editing/history, source refresh, SVG/DXF export, local and Studio reopen,
read-only browsing and metadata operations. No page errors. The actual Animation
client load/pose/serialize/reopen regression also passes. The section screenshot
was inspected: hatching fills material and leaves the bore clear. Two early
geometry fixture attempts used the wrong cut operation/direction; corrected to
CAD's existing cut contract. Evidence: `.verification/baseline-2026-10-24/drawing-sections-*`.
No installation changes.

Per Jonathan's maintainability request, the feature keeps document validation,
section geometry/hatching, projection, export, editor UI and agent adapters in
their owning modules. The section module owns and releases its temporary OCCT
objects; entry points only compose it. CAD's contributor contract now records
that structure and readable formatting as the rule for continued baseline work.
After formatting, 14 focused engine checks and types/build pass. All 3,517
frontend files are byte-identical to the browser-qualified output. The rebuilt
worker passes all 308 native checks again (174.32 seconds), fresh-process drawing
checks, old-reader refusal and pinned-codec/package equality. Its final SHA-256
is `360daff4a45cc586fdcd8bc4f5838370d85cbd5aacc9804882150b87f7ede504`.

## 2026-10-24 — Focused kernel feature modules (source qualified)

The existing fillet/chamfer, Boolean and pattern implementations now live under
`aether-engine/src/kernel/features/`. Explicit typed contexts supply only the
needed bodies, references, preview callbacks and step resource ownership. The
evaluator retains ordered replay, cache ownership and transaction commit; modules
do not import it or create another state store. Feature error identities remain
compatible through re-exports. Product-local vector operations are reused.

The evaluator decreases from 3,337 to 3,069 lines in this first extraction.
The larger extrusion/revolve, sheet-metal, surface and other branches remain to
extract. Geometry and authored behavior are unchanged. Full engine: 1,146 pass;
full app: 1,856 pass/one existing skip; engine/app types and build pass. The initial
context declaration incorrectly required legacy contour IDs; it now preserves
their existing optional type. All 308 packaged native tests pass, along with
headless exact-build/export, saved-region/frame/replay, drawing section/export/
reopen and pinned-codec/package checks.

The CAD-owned modeling browser fixture passes all 16 steps (293.61 seconds with
the actual Animation-client regression), including applied hole, revolve cut,
surface/thicken and sheet-metal export after the extracted features. No page
errors or server geometry requests occur. The fixture has no tolerant mode and
retains the saved part before/after the hole for fresh-process checks. The earlier
browser attempts remain recorded: a default-direction hole preview was refused;
a subsequent negative assertion incorrectly assumed that this drill removed no
material. The saved model, after its revolve and union, has material on both sides
of the sketch. Explicit normal direction passes the final browser run. The first
preview refusal was not reproduced by cold builds; this is not claimed as a
separate product fix.

Against the frozen alpha-0.1.10 worker, cold builds of the same saved part and both
hole directions retain volumes, bounds, stable topology IDs, anchor signatures,
shape fingerprints, body outputs, reference scopes and sketch frames. Comparison
uses 1e-9 numeric tolerance and ignores only OCCT traversal ordering and diagnostic
incidence indexes; incidence degrees are retained. An old-to-old control also
passes. Evidence: `.verification/baseline-2026-10-24/evaluator-modules-*`, especially
`evaluator-modules-tools-qualified/log.json` and `evaluator-modules-before-after.json`.
The matching worker SHA-256 is
`09c42ffe5c7d44a7958ea32a43e0fc3e7a01304cce01246f2135d6f143ced3e8`;
the canonical codec21 package remains unchanged. No installed activation or push.

## 2026-10-24 — Vector drawing PDF and shared label alignment

Drawing Export now writes the displayed sheet or all sheets as vector PDF, with
physical paper sizes, visible/hidden edges, section hatching, dimensions and
searchable text. UI, open-editor AI/MCP and the packaged local runner share the
same serializer. Agent PDF results carry `data_base64` and `mime_type`; their
existing 2 MiB reply limit counts the complete encoded result. Export does not
save or publish a document and remains available on read-only revisions.

Implementation is split into focused modules: engine `drawing/pdf.ts` and
`export-result.ts`, browser `drawing/pdf-export.ts`, and the runner's
`automation/drawing-font.ts`. Routers compose these operations. Libraries load
on demand, and the existing pinned Noto Sans font is subset-embedded; unsupported
glyphs are refused. The frontend and worker retain matching font bytes and
licenses, including PDF library/dependency notices. No document, codec, database,
request-limit or host-setting change is needed.

Async exports recheck revision/context/cancellation before returning; UI download
guards invalidate synchronously when the workspace changes or unmounts. Focused
tests cover read-only exports, StrictMode, changed snapshots, leaving and returning
to the workspace, unmounting and aborting a live-agent request. Rendering exposed
height dimension labels crossing their dimension line. Alignment is now part of
the built drawing and consumed by the canvas, SVG, DXF and PDF: width values are
centered, height values start 1.5 mm to the right of the line. The optional
projection field preserves older callers; saved drawing intent is unchanged.

Verification: full engine suite 1,149 pass; full app suite 1,865 pass/one existing
skip. After the alignment correction, 13 engine and 34 app focused checks plus
both type checks pass. The final synchronous route guard passes its five checks
and the app type check. The rebuilt worker passes all 308 native tests in 213.24
seconds. Existing headless exact-build/export and saved-region/frame/replay
checks pass; final drawing section/DXF/reopen checks pass in 12 fresh processes,
and the PDF fixture passes in 10 fresh processes. Separate pypdf/pdfplumber
validation confirms physical pages, embedded Unicode fonts, vector line weights,
searchable dimensions, and hatches excluding the bore. Both rendered pages were
visually checked; dimension text now clears its line with no clipping.

The first complete authenticated browser qualification passes all 11 workflows
and the actual Animation-client regression in 131.31 seconds, with no page errors
or server geometry requests. It covers UI active/portrait/all-sheet downloads,
source refresh/history/reopen, actual MCP binary export, invalid selection refusal,
and read-only export without a stored revision change. Independent parsing also
confirms Unicode and dimension/section/agent text in these actual downloads.
The frontend-only synchronous guard refinement is requalified separately before
staging; its result is recorded below. The worker remains byte-identical.

Earlier failures remain in the evidence: exact floating-point and drawing-title
expectations, test union narrowing, and the independent reader's point-vs-mm line
weight assumption were corrected. The rendered dimension-label overlap was a real
product issue and was fixed across the shared layout consumers. Generated worker
output retains upstream fontkit comment whitespace; source whitespace checks
exclude that generated file. Evidence: `.verification/baseline-2026-10-24/drawing-pdf-*`.
Worker SHA-256: `57bf791c7344dafd3eb1ccbc14b4bd2f0f416421a9aa8d78d4db6b47451223b8`.
Canonical codec21 is unchanged.

Remaining drawing gaps include assembly sources/BOM, edge-attached/angular/radial
dimensions, stepped cuts/cutting-line annotations, title-block editing, placement
by dragging and closed-file MCP tools. PDF supports the bundled font's character
coverage; it preserves authored placement without automatically arranging sheets.
PDF arcs use vector cubic paths; DXF retains analytic circular geometry. This
increment does not complete the overall CAD baseline. No installed activation or
push is performed.

Final frontend requalification: all 11 browser workflows and the actual
Animation-client regression pass again in 133.89 seconds, errors `[]`. Independent
parsing of the final UI/agent/read-only downloads passes. The 3,524 qualified
frontend files and unchanged worker digest are recorded in
`drawing-pdf-qualified-output-final.json`. No code changes follow qualification.
