# Part document format

## Current v21 file boundary — 2026-10-14 (source; installation pending)

Part21 adds `kind: "pierce"` to the existing drawing constraint array. Its only
fields are `id`, `kind`, target entity `a`, and `source`. The source identifies an
earlier sketch curve with `kind: "sketch-curve"`, `sourceFeatureId`,
`sourceContourId`, optional `sourceSegmentId` (omitted for circles), and a selected
intersection `branch`: signed crossing direction, ordinal, and three direction
counts. The branch must still exist; a changed intersection count does not silently
attach the target to another branch. Finite curve targets retain their bounded
sliding contact parameter; point/center/control targets remain ordinary entities.

The intersection is derived from the current exact source and target sketch plane.
`pierceContext` is transient solver state and is refused in saved files. Source
dependencies participate in suppression, removal, reordering, and rebuilding.
Source identities and the new relationship are authored in one atomic candidate.
Independent clipboard copies drop external Pierce relationships.

Versions 1–20 remain readable. Codec18 preserves Part21 in portable workspaces;
the frozen Part20 reader and codec17 refuse it. Native jobs require `sketch-pierce`
and independently check the actual source B-rep contact and target geometry.
This validation does not imply all sketch equations run through native Sketcher.
The shared sketch editor now authors and repairs sketch-curve Pierce constraints
through selected-target or repeated tool-first selection (Shift+G). Exact contact
markers and named source/intersection choices preserve branch identity; source
identity patches share the drawing's undo, redo, cancel and save transaction.
Missing relationships remain explicit and prevent Finish until repaired or removed.
Solid curved-edge references, actual browser acceptance and installation remain open.
Evidence: `.verification/sketch-pierce-ui-2026-10-14/RESULTS.md`; the file/native
boundary remains Part21/codec18, as qualified by the previous integration candidate.

Exact Split and Trim now remap Pierce targets onto retained finite curve pieces.
Splitting a circle selects the arc that contains the original derived contact;
circle centers remain separate point targets. Trimming away the contacted span
removes that relationship through ordinary undoable editing. Replacing an upstream
source edge still refuses orphaned references; it never chooses a new source edge
implicitly. See `.verification/sketch-pierce-topology-2026-10-14/RESULTS.md`.

## Previous v20 file boundary — 2026-10-14 (source; installation pending)

Part20 adds an exact `conic` path segment with `end`, `control` (the tangent
intersection), and dimensionless `rho` strictly between 0 and 1. Its start is
the preceding path vertex. The rational quadratic has weights
`[1, rho/(1-rho), 1]`; saved geometry is never a display polyline or cubic fit.
Endpoints and one `control: 0` point use the ordinary entity references.

`conic-rho` dimensions reference the segment as `kind: "curve"`. They measure
the whole segment, so no contact parameter is required. Literal, linked,
reference and formula dimensions are scalar, unaffected by document length or
angle units. Ordinary finite curve-contact references still need a parameter.
Split/trim remaps account for rational reparameterization; unsupported driving
constraint remaps fail atomically instead of changing the constrained shape.

Versions 1–19 remain readable. Codec17 retains Part20 in portable workspaces;
the frozen Part19 reader and codec16 reject it before interpreting geometry.
Native conics require the live worker's `sketch-conic` capability. The parked
kernel refuses them rather than substituting lines. Authoring uses the existing
Aether feature editor. Source/native/mounted qualification is recorded in
`.verification/sketch-conic-integration-2026-10-14/RESULTS.md`; actual browser
acceptance and installation remain pending.

## Previous v19 file boundary — 2026-10-14 (source; installation pending)

New Parts and modeling saves use `formatVersion: 19`; v1–v18 remain readable.
Extrude, Revolve, Sweep profiles and Loft sections can retain a joined face as
`profileRegion: { contourIds: ["curve-id", "closing-line-id"] }` alongside its
`profileFeatureId`. Each contributor is an existing nonconstruction open contour
in that sketch. The group contains at least two distinct stable IDs, is mutually
exclusive with `profileContourId`, and is independent of source ordering. Extrude
also retains it in each `profileSelections` entry. Duplicate selected groups are
rejected regardless of contributor order.

The group is a reference, not another saved geometry object. Original curves and
constraints remain authoritative. It must resolve to the same single closed,
unambiguous loop on rebuild; deleted, branched, open or crossing contributors
produce a repairable feature error. Native `sketch-region` links the original
exact wires before creating a solid. Thin profiles, Sweep paths, Hole and direction
references continue to use individual curves. Intersecting/shared-edge region
arrangements are not represented by this group contract.

Canonical workspace codec build16 preserves embedded Part19; the frozen Part18
reader and codec15 refuse it. Legacy opening does not rewrite the source. Browser
acceptance and installation remain pending. Qualification evidence:
`.verification/sketch-connected-region-integration-2026-10-14/RESULTS.md`.

## Previous v18 file boundary — 2026-10-14 (source; installation pending)

New Parts and modeling saves use `formatVersion: 18`; v1–v17 remain readable.
An existing `spline-shape` constraint may contain `splineFreeEnds: ["start"]`,
`["end"]` or `["start", "end"]`. Those open-spline endpoint controls become
independent tangent inputs to C2 interpolation. Omitted ends keep natural
interpolation. Fit points and tangent handles remain the existing exact cubic
geometry; no second coordinate array is stored. Closed splines retain periodic
interpolation and reject independent end flags.

Dragging an endpoint tangent activates its end and holds the fit knots and any
independent opposite handle for that gesture. Temporary drag targets are removed
before saving. Handle dimensions use ordinary constraints. Copy, point insertion,
whole-entity Fix and undo preserve the interpolation contract. Exact cubic native
translation remains unchanged; only display tessellation settings are explicit.

Canonical workspace codec build15 accepts embedded Part18. The frozen Part17
reader and codec14 refuse Part18; legacy files migrate by header and are not
rewritten on opening. The Part17 Fix/ellipse candidate remains frozen separately.
Current evidence: `.verification/sketch-end-tangents-2026-10-14/RESULTS.md`.

## Previous v17 file boundary — 2026-10-14 (source; installation pending)

New Parts and modeling saves use `formatVersion: 17`; v1–v16 remain readable.
The canonical authority is `aether-engine/src/document/part-format.json` and its
build-generated copy in the isolated native worker. Whole-entity sketch Fix adds
`fixedGeometry` to the existing `kind: "fix"` constraint. It contains a target
circle/path; `a` retains the canonical entity reference. Legacy point Fix keeps
its original `point` field. Targets cannot simultaneously carry dimension/pair
fields. No auxiliary dimensions or construction entities implement the lock.

A picked span of an authored fit spline or full ellipse fixes that whole entity.
Unfix removes matching Fix constraints in one transaction and retains other
relationships. Independent copies transform their fixed targets; moving an
original fixed entity is refused. Changing fixed topology requires Unfix first.
Native translation sends exact Block geometry indices. Elliptical arcs now use
an analytic endpoint-derived frame and native Part ellipse/circular arcs.
`sketch-fixed-geometry` and `sketch-ellipse` capability gates reject older workers
before a geometry request can silently lose these semantics.

Immutable canonical workspace codec build14 accepts embedded Part17 without
interpreting CAD geometry; only its version whitelist changes. Codec13 and the
frozen installed Part16 reader refuse new files. Existing archives are retained.
Part16 files migrate by header only, with feature records and metadata retained. No source file is
rewritten just by opening it. Evidence and remaining browser/install qualification:
`.verification/sketch-fixed-geometry-2026-10-14/RESULTS.md`.

## Previous v15 file boundary — 2026-10-13

New Parts and saves use `formatVersion: 15`. The canonical version manifest is
`aether-engine/src/document/part-format.json`; the native package contains an
exact build-generated copy. The browser, automation and native metadata/project
adapters reject unknown versions before interpreting feature fields. The frozen v14
reader refuses v15 files rather than silently ignoring solid-edge transform references.
Any future change that alters geometry or feature meaning must advance this
version boundary and qualify current and older readers before release.

The reader accepts v1–v15: v1 retains the existing rectangular-sketch migration;
v2/v3/v4/v5/v6/v7/v8/v9/v10/v11/v12/v13/v14 advance only the header, preserving feature records, stable IDs, scopes,
references, rollback position, presentation and document settings. Opening does
not rewrite the source file. A normal modeling save writes v15; a metadata-only
settings edit preserves the legacy header until explicit Update supplies a
canonical migration. Multi-Part Update validates every supplied migration before
changing any Part. Linked revisions still require explicit source updates.

Project containers retain their existing container format and checksums. The
canonical workspace codec now accepts embedded Part versions 2/3/4/5/6/7/8/9/10/11/12/13/14/15; CAD creates
new tabs as v15 and validates incoming saved/linked feature documents. The codec
only stores CAD feature records, without defining geometry or feature meaning.
Legacy standalone v1 files migrate in CAD before insertion into a project.

Unsupported file opens display a dismissible error and retain the active model.
This protects newly saved files; it cannot retroactively make an older v3
reader understand development records previously saved with a v3 header.

## Straight solid-edge transform references (v15)

`translate-reference` and `rotate-reference` accept a `solid-edge` reference:
`sourceFeatureId`, `bodyId`, `label` and `anchor: {start, end}`. Both endpoints
use the existing `SolidVertexAnchor` contract and retain their order. They must
be distinct and belong to the same captured shape. Only earlier solid-producing
features qualify; their identities participate in history dependencies.

FreeCAD resolves both endpoints against the named source snapshot and requires
exactly one current straight native edge connecting them. Full-length moves use
its current vector; signed distance/reversal and referenced rotation use the same
native axis. No `EdgeN` index or baked displacement is persisted. Missing, curved,
replaced or ambiguous edges fail for repair, and export refuses the failed history.
A point pair cannot silently replace a missing edge. Straight edges of imported
exact solids are supported; mesh edges and curved axes are not.

The editor's Solid edge picker can select source geometry through the blue/red
preview. Its exclusive selection filter keeps the transform part scope separate.
Reference removal, editing, distance/rotation handles, copies, Cancel, Undo/Redo
and source dimension changes retain the existing native authoring behavior.
Topology candidates may expose optional `edgeAnchor` values for this picker.

The worker advertises `solid-edge-transform`; older workers are rejected before
building. Part15 and immutable canonical codec12 guard the new saved meaning.
Frozen reader14/codec11 refuse new files/projects. Evidence:
`.verification/edge-transform-2026-10-13/RESULTS.md`. Mate-coordinate transforms,
curved-edge axes and persistent topology repair remain open.

## Geometry-referenced part transforms (v14)

The existing transform feature adds these modes, with the same body/copy IDs:

- `translate-reference`: `reference` is a stable authored `sketch-line` or ordered
  `two-points` pair. With no `distanceMillimeters`, displacement is To minus From
  (the line's complete length). A finite signed distance instead follows the unit
  reference direction. `reversed` reverses that direction independently.
- `rotate-reference`: the same reference defines an axis through From toward To;
  `angleDegrees` follows the right-hand rule.
- `scale-reference`: `centerReference` is a sketch point or native solid vertex;
  positive `scaleFactors` remain relative to the document XYZ axes.

Point references reuse the existing stable sketch contour/vertex IDs and native
solid-vertex signature/fingerprint contract. Only references to earlier features
are valid. Dependencies include both points and their source features. Missing
sources remain loadable for repair; unavailable, suppressed, replaced, ambiguous
or coincident references prevent a successful rebuild/export. No baked coordinate
fallback is stored. Solid-edge references arrive in v15 above; mate coordinate
systems remain open.

The product resolves current constrained sketch coordinates. FreeCAD resolves
native support frames and solid vertices at the named pre-transform snapshot,
then uses the existing validated transform builder. Copies remain independent
stable outputs. Native transient preview metadata optionally supplies a resolved
numeric transform and direction for distance, angle and scale handles. This data
is not persisted. Source vertex selection stays available through preview overlays
only while the point picker owns the selection filter.

Part14 and immutable canonical codec11 protect the new meaning; frozen reader13
and codec10 refuse new files/projects. Numeric v13 features retain their behavior.
Evidence: `.verification/referenced-transform-2026-10-13/RESULTS.md`.

## Solid part transforms (v13)

`transform` stores distinct selected `bodyIds` and one typed `transform`:

- `translate`: `translationMillimeters` is the XYZ displacement.
- `rotate`: `axisOriginMillimeters`, unit `axisDirection`, signed `angleDegrees`.
- `scale`: `centerMillimeters` and positive `scaleFactors` for XYZ. Equal factors
  use native uniform scaling; unequal factors use the native B-rep general transform.
- `copy`: copies in place.

An optional `copyBodyIds` maps every input body ID to a distinct, new output ID.
The Copy mode requires this complete mapping; the other modes omit it to modify
parts in place. Copies remain independent downstream parts and follow source
history changes. Reopening/editing retains their IDs. Native output publication
must match the saved output identity set. `targetBodyId`/`targetBodyIds` are invalid
on this feature because `bodyIds` already owns the targets. Maximum selection256.

The native worker advertises `part-transform`. Build, analysis and export refuse
older workers that lack it. All selected solids are computed and checked before
mutating any body: same solid count, validity, BOP check and determinant-based
volume conservation. Imported exact solids are supported; reference meshes are
excluded. Missing/suppressed sources report repairable history errors. The parked
browser engine explicitly refuses these features.

Move, Rotate, Scale and Copy ribbon entries and the part context menu open the
same editor. Fields respect document units, selection can accumulate parts through
the active preview, and Copy creates persistent output IDs. Existing native
material-difference preview shows arriving material blue and departing material
red. Copy previews add blue material without removing the originals. Cancel,
Apply, Undo/Redo, source dimension edits and saved reopens are verified.

**Current limit:** general nonuniform scaling of some curved parts is refused.
The verified FreeCAD1.1.3 conversion turns an analytic cylinder into C0 rational
surfaces and its reported volume differs from the determinant oracle by~0.86%.
The BOP/volume checks remain strict; the UI explains Uniform scale or source
feature dimensions as alternatives. Nonuniform boxes and uniform curved solids
pass. We do not replace these solids with meshes or silently accept the mismatch.
Numeric XYZ/axis/center entry and the viewport handles below are supported.
Selected lines/points/mate connectors and face Translate/Rotate remain open.

Part13 and canonical workspace codec10 protect the new record. Frozen reader12
and codec9 refuse it. Evidence: `.verification/part-transform-2026-10-13/RESULTS.md`.

### Transient transform handles — 2026-10-13

A valid native transform preview may include `transform_frame` with `center_mm`
and positive `radius_mm`, derived from the selected source solids before the
transform. The adapter strips cached triangulation from temporary shapes and
reads native bounds before preview tessellation, so curved anchors do not drift
with display mesh quality. This is optional evaluated metadata, never saved
geometry or feature meaning; Part13 and codec10 remain unchanged. Older workers
without a frame retain numeric editing. Invalid/nonfinite frames are ignored.

The product projects colored XYZ translation handles, an arbitrary-axis rotation
ring and uniform/XYZ scale handles through the current camera. Rotation uses the
entered origin/axis; scaling uses the entered center. Translation follows the
source selection's center plus its current displacement. Camera geometry maps
pointer rays to millimeters, degrees or factors. End-on axes and edge-on rotation
planes are hidden when a reliable drag is impossible. Numeric fields remain.

A drag freezes its camera projection, updates the existing unit-aware controls
and uses the normal native preview queue. Shift gives fine movement, arrows give
steps, Escape/pointer cancellation restores the starting value, and changing
mode/selection or closing the editor cancels the drag. Rotation unwraps ±180°;
scale cannot cross zero. New drags pause during a pending rebuild; invalid or
foreign preview results remove their handles. The overlay does not make geometry
or create another history path. No saved-version/canonical-codec change.

Evidence: `.verification/transform-handles-2026-10-13/RESULTS.md`. This adds direct
manipulation to the existing numeric transform modes, not selected-entity/mate
transforms or general Move face coverage. Nonuniform curved scaling retains the
native restrictions above.

## Direct face offsets (v12)

`offset-face` stores one or more `faces` and signed `distanceMillimeters`.
Each face uses the shared `SolidFaceReference` contract: `sourceFeatureId`,
`bodyId`, `label`, and either a unit planar `normal` or native `surfaceType`,
with an optional geometric `faceAnchor`. Target bodies are derived from these
references; separate `targetBodyId`/`targetBodyIds` fields are invalid. Multiple
faces and parts share one history operation and one signed distance. Positive
adds material, negative removes. Distance must be finite and nonzero.

CAD's native adapter calls FreeCAD's public `Solid.offsetFaces` API to offset
selected boundaries and extend neighboring surfaces. This differs from the
existing planar `face-extrude`, which adds/removes a prismatic face footprint.
The parked evaluator explicitly refuses the new operation. The current worker
must advertise `offset-face` for build, analysis and export.

Every reference is resolved against both the saved source feature and the current
target. Unique oriented planes/surface kinds can follow upstream dimensions;
ambiguous faces require center/area anchors. Changed or missing anchors require
reselection. This is conservative geometric association, not universal topology
naming. Native meshes are not accepted as exact offset targets.

Each resulting solid must remain valid and retain its material side. Analytic
radius-collapse guards prevent OCCT's apparently valid inverted cylinders,
spheres or toruses. Signed material containment checks and disconnected-solid
overlap checks reject inverted or intersecting results. All selected body shapes
are validated before any target is committed. Failed preview/export cannot
publish a partial offset across parts.

The Solid Push/Pull menu and part context menu open Offset faces. The editor
accumulates viewport faces, supports removable chips and display units, and shows
blue added/red removed material with a signed native drag handle. During picking,
clicks resolve the original model or geometry before the edited history feature;
preview result faces never become new source references. Cancel, Undo/Redo and
source edits retain ordinary document semantics. Source-picking mode ends with
the editor. Preview axes are transient and are never saved as geometry inputs.

Part12 and immutable canonical workspace codec9 guard the new record. Old v11
readers/codec8 refuse it. Existing v1–v11 Parts load without rewriting their files.
Acceptance and remaining boundaries are recorded in
`.verification/offset-face-2026-10-13/RESULTS.md`. General Move face Translate/Rotate,
end-entity offsets, automatic fillet reapplication and arbitrary topology changes
remain separate work; this feature does not establish full direct-editing parity.

## Curved stopping faces (v11)

Either Extrude end can use `endType: "up-to-face"` with an `endReference`
containing `sourceFeatureId`, `bodyId`, `label`, `surfaceType` and an optional
`faceAnchor`. Supported native kinds are `cylinder`, `cone`, `sphere`, `torus`,
`bspline`, `bezier`, `extrusion` and `revolution`. These records cannot also contain
`normal`; existing planar normal/anchor records retain their original meaning.

Each rebuild resolves the referenced source snapshot. A unique surface kind
follows source dimensions. Multiple faces of that kind require an exact native
center/area anchor; changed, missing or unresolved references require reselection.
No transient FaceN is persisted. This is conservative geometric association, not
arbitrary persistent topology naming. Native face topology emits a transient
`surfaceReference` hint for the actual viewport pick; the UI authors the source
feature/body identity. Sketch support and starting-face pickers stay planar.

The native extrusion follows the full underlying surface beyond the selected
face's trim. Parametric spline surfaces retain their natural domain; no invented
extrapolation or tangent plane replaces them. Spline extrusion surfaces use a
finite exact parameter patch covering the construction tool to avoid OCCT's
unusable infinite parameter bounds. Bounds size that patch, never the stop.
Draft uses the original sketch as neutral, signed offsets are axial, and either
independent end uses the same geometry. Complete start contact and termination,
a connected valid solid and pre-apex draft sections are mandatory. Incomplete or
invalid limits cannot publish a partial result, preview or export.

The browser exposes End face and Opposite end face selection, units, clear/reselect,
cancel and normal feature history. Current build/analysis/export require native
`extrude-curved-face`; older workers refuse it. Part11 and immutable canonical
workspace codec8 guard the new reference meaning. Codec8 changes only the embedded
version whitelist; CAD owns geometry. Older readers/codec7 reject the new version;
opening older Parts does not rewrite the source.

Acceptance: `.verification/extrude-curved-face-2026-10-13/RESULTS.md`:640 distinct
checks, full build, actual blue/red browser preview/picking/edit/history, two fresh
saved reopens and exact STEP roundtrips. Also fixes native torus topology's use of
the nonexistent `Part.Torus` class; FreeCAD exposes `Part.Toroid`.
Surface-only stops/output, arbitrary folded/singular surfaces, oblique draft,
broader references, topology association and performance qualification remain
open. Development source only; no installed promotion or whole-product parity.

## Drafted general Up to next (Part v10 unchanged)

Nonzero `draftAngleDegrees` with `endType: "up-to-next"` now supports exact curved,
tilted and stepped solid boundaries. The sketch remains neutral through starting
offsets; each end has its own signed taper/offset. Complete start contact and
termination, valid solid output and pre-apex sections are required. Missing or
incomplete boundaries cannot publish a partial preview or export.

Current clients require `extrude-drafted-general-next` in addition to existing
draft/end capabilities on build, analysis and export. No new saved fields or
version: previously accepted planar results remain compatible. Circular sections
now use native analytic circles where generic small-circle offsets failed.
Part10/codec7 and parked-engine refusal stay unchanged. Oblique draft, surface-only
stops, folded-boundary coverage and broad topology/performance qualification remain
open. Evidence: `.verification/extrude-drafted-next-2026-10-13/RESULTS.md` —348 distinct
checks, full build/lint, real browser previews/history/reopen and native STEP.
Source only; no installed promotion or whole-product parity claim.

## General Up to next boundaries (Part v10 unchanged)

The existing `endType: "up-to-next"` with no draft now uses the first exact solid
boundary encountered along each extrusion ray. Curved/tilted faces and stepped
stops across multiple parts are supported. Complete termination and native solid
validity are required; missing coverage fails. Signed `endOffsetMillimeters` moves
the chosen boundary axially and cannot skip a too-near stop. Inside/coincident
starts find the next exit. Independent ends and thin profiles share this path.

No new persisted field or version: this expands previously refused cases without
reinterpreting accepted planar records. The current client requires native
`extrude-general-next` for non-drafted primary/opposite Next on build, analysis
and export. Drafted curved/tilted Next is covered by the newer acceptance above;
surface-only stops remain unfinished. Invalid folded boundaries require a different
profile or limit. The parked evaluator gains no new feature implementation.

292 distinct targeted tests, production build, actual browser preview/edit/cancel/
Undo/Redo/upstream failure recovery, three saved reopen/STEP cases pass. Evidence:
`.verification/extrude-general-next-2026-10-13/RESULTS.md`. Source only; no installation
promotion or full parity claim. The same regression pass repairs preview-axis
placement for disconnected thin regions by using their first native face.

## Native extrusion preview handles (transient; Part v10 unchanged)

A preview response optionally includes `preview.feature_id` and
`preview.extrusion_axes`. Each axis contains `side` (primary/opposite), `parameter`
(distance/second), `originMillimeters`, evaluated unit `direction`, `scale`
(1 or 0.5), and `reversed`. The native tool path resolves the start and direction
before emitting these hints. They are never stored in Part files or passed back
as geometry inputs. Ordinary rebuilds do not return feature previews.

Blind ends use their actual native start, including face/datum references and
signed offsets. Symmetric ends expose two handles for one total-depth dimension;
each moves by half that depth. An independent opposite Blind end edits only its
own depth. A non-Blind primary can still have an editable opposite Blind end.
Native failure or mismatched feature identity clears the handles; a pending
preview prevents new drags while an existing drag retains its captured axis.
Escape/cancellation restores the values. Document units, keyboard adjustment and
normal editor preview/Apply/Undo/save behavior remain shared.

Older workers retain the simple zero-offset single-sketch Blind handle. They do
not guess referenced starts. Non-Blind limits have no false depth handle; their
existing reference/offset fields remain available. End-on camera projection hides
an unstable handle. The first evaluated profile group supplies a representative
axis for shared dimensions; separate handles per profile group remain open.

Acceptance: `.verification/extrusion-native-handles-2026-10-13/RESULTS.md`.
217 distinct tests, full build, real browser drags/reopen and five exact STEP
roundtrips pass. This changes presentation metadata, not Part10/codec7 meaning.
No installed-generation promotion or complete Extrude/Onshape parity is claimed.

## Automatic extrusion scope (v10)

An Extrude with `scopeMode: "all"` modifies the earlier native solid parts it
actually touches (Add) or overlaps (Remove/Intersect). It cannot carry explicit
`targetBodyId`/`targetBodyIds`, and is invalid for New. Missing scopeMode retains
legacy explicit targeting. New modifying dialogs default to Merge with all;
unchecking it exposes the existing target controls. With no remaining solid,
the next extrusion defaults to New. Reference meshes never enter solid scope.

Native rebuild returns `scope_resolutions[featureId] = {targets, groups}`. Each
group is `{bodyId, sources}`: ordered input IDs and their surviving first identity.
Independent Add groups remain separate. Existing compound inputs retain their
identity. Detached tool-only regions and non-solid edge contact fail. Remove can
consume an entire part; it then has no surviving group. Non-overlapping parts
remain unchanged. Exact geometry, not a cached target list, decides membership.

The saved optional `scopeResolution` is a validated history/presentation cache.
It is never translated into native Boolean inputs. Rebuild replaces it atomically;
malformed, foreign or incomplete results are refused. Producer output IDs remain
in history even when a later merge consumes them. Upstream dimension edits,
suppression and deletion recompute membership. Later body references are checked
against current native availability, allowing a previously consumed part to return.
Automatic scope does not pin cached targets as mandatory feature dependencies.

Preview subtracts each group's original material independently: added material is
blue; removed material is red. Normal Cancel/Undo/Redo, file/project reopening,
agent depth edits and exact STEP exchange share these semantics. The capability
`extrude-automatic-scope` gates build/analysis/export; the parked evaluator refuses
it. Part10 and immutable canonical workspace codec build7 protect forward meaning.
This is development source, without installed promotion or stored-file migration.

Acceptance: `.verification/extrude-automatic-scope-2026-10-13/RESULTS.md`.
Large-model scope performance, feature-pattern sources spanning automatic groups,
surface outputs, arbitrary topology association and complete Onshape parity remain
unqualified or open. Native preview handles now cover referenced starts, as described below.

## Referenced extrusion starts (v9)

An optional `startingReference` on an Extrude is one of:

- `face`: earlier `sourceFeatureId`, `bodyId`, oriented unit `normal`, display
  `label`, and optional `faceAnchor` using the existing planar-face contract.
- `plane`: earlier construction-plane `sourceFeatureId` and display `label`.
- `principal`: `plane` (`XY`, `XZ`, `YZ`) and display `label`.

The reference resolves again for every native rebuild. Its plane must be parallel
to the extrusion's sketch. `startingOffsetMillimeters` remains an additional signed
axial distance; it does not replace the reference with a baked world coordinate.
Blind depth starts at that shifted plane. Independent and symmetric ends share
it, and referenced end limits retain their absolute positions. Draft retains the
original sketch as its neutral plane. The same native path handles New, Add,
Remove, Intersect, thin walls and explicit multiple-target scopes.

Face references use an earlier feature/body snapshot and conservative oriented
planar-face resolution. A unique orientation follows dimensional changes. An
ambiguous face requires its geometric anchor; changes to that anchor require
reselection. This is not arbitrary persistent topology naming. Principal planes
and nested offset/mid datums derived solely from principal planes are associative.
Datums made from captured faces/points/edges are refused as extrusion starts until
their own association is implemented; users can select a solid face directly.
Whole-part, surface and mate-connector starts remain open.

The editor exposes Blind offset, Selected face and Reference plane, signed offsets,
independent start/stop picking, document units, cancel and edit. Plane labels may
change without breaking their identity. The depth field's drag control remains
available. A matching native preview now supplies the resolved start and direction
for the in-canvas Blind and symmetric depth handles, including enabled references
and signed starting offsets; see the transient contract below.

Dependencies participate in suppression/reordering/missing-reference diagnostics.
The `extrude-reference-start` capability gates build, analysis and exact export.
The parked browser engine refuses these features. The immutable canonical workspace
codec build 6 carries Part 9 records without owning geometry. No stored document
migration or running-installation promotion occurs in this packet.

Acceptance: `.verification/extrude-reference-start-2026-10-13/RESULTS.md`.

## Selected-point extrusion limit (v8)

Either Extrude end accepts `endType: "up-to-vertex"` with `endPointReference`:

- `sketch-point`: `sourceFeatureId`, `contourId`, `point: "vertex" | "center"`,
  `vertexId` for endpoints, and `label`. Stable authored identities follow current
  constrained coordinates; a circle center uses its contour identity. Native
  support resolution supplies the current frame. Construction points are valid.
- `solid-vertex`: `sourceFeatureId`, `bodyId`, `label`, and native `anchor` with
  `positionMillimeters`, `signature`, `shapeFingerprint`, and `incidence`.
  The current source feature's native shape supplies the point. An incident
  surface-normal/edge-kind signature must resolve uniquely. Repeated signatures
  additionally require the unchanged source fingerprint and exact coordinate.
  The incidence value is a refusal guard against symmetric corner permutations,
  not a primary selector or a persistent VertexN promise. Missing, ambiguous,
  rotated or reordered topology may require explicit reselection.

The limiting plane passes through the resolved point parallel to the extrusion
sketch. End offsets remain axial distances; positive falls short. Points behind
or at the start, invalid frames and degenerate results fail before commit. Draft,
Thin, custom directions, independent opposite ends, result operations and explicit
scope use the existing native tool path. Native translation emits
`end_point_reference` and requires capability `extrude-up-to-vertex` for geometry,
analysis and export. The parked evaluator refuses this mode.

The editor offers named sketch points and live solid-vertex picking. Face and
point pickers share exclusive selection-filter ownership and restore the prior
filter when closed. Cancel does not stamp sketch identities into the source.
Automation previewoffset/setoffset preserve the point link and validate natively.
Part 8 and immutable canonical workspace codec build 5 guard forward meaning;
frozen v7 readers refuse v8. No stored-user-document migration is performed.

Mate-connector limits, projected/legacy rectangle point sources, arbitrary
persistent topology naming and general oblique draft remain open. This is checked
geometric association, not full Onshape reference or Extrude parity. Evidence:
`.verification/extrude-up-to-vertex-2026-10-13/RESULTS.md`.

## Selected-part extrusion limit (v7)

Either Extrude end can use `endType: "up-to-part"` with `endPartId`, a stable
part ID. The part's current evaluated shape at the extrusion's history position
is authoritative. Dependencies follow its latest unsuppressed modifier; deletion,
suppression or consumption requires repair, with no substitute part or bounding
plane. Switching to another end type removes the part reference.

Native translation emits `end_part_id` and requires `extrude-up-to-part` for
geometry, analysis and export. Signed `endOffsetMillimeters` translates the
stopping shape along the extrusion direction (positive stops short). The native
adapter sizes a finite tool from shape bounds, then uses actual solid booleans
to find the connected region containing the complete starting face. An outside
profile stops at entry; a fully inside profile stops at exit. A profile crossing
the stopping boundary at its start is rejected. The result must contact the
selected part away from its start, preserve that start, pass strict BOP checking,
and have no material reaching the temporary far cap. Near-apex draft caps cannot
masquerade as a stopping boundary. No tessellation defines this geometry.

Planar, tilted and curved solid stops, signed offsets, normal/custom direction,
independent ends, supported draft, Thin and explicit multi-part scope are
qualified against native geometry. Oblique draft remains unsupported by the
shared extrusion path. Surface stopping bodies, mixed inside/outside starts and
broader reentrant/multilayer topology coverage remain open. This is not a claim
of complete Extrude or Onshape parity.

The existing automation previewoffset/setoffset commands also accept Up-to-face
and Up-to-part, retain the selected reference and use normal native validation.
Part7 and immutable canonical workspace codec build4 protect forward meaning;
the frozen v6 reader refuses7. Evidence:
`.verification/extrude-up-to-part-2026-10-13/RESULTS.md`.

## Thin extrusion (v6)

`extrude.thin` optionally defines a wall around each selected sketch contour:
`{ thickness1Millimeters, thickness2Millimeters, midplane?, midplaneThicknessMillimeters?, flipped? }`.
Independent sides are finite nonnegative millimeters with a positive total.
Mid plane uses the positive total `midplaneThicknessMillimeters`, divided equally;
the independent values are retained when switching modes. Each thickness is
bounded to 1000000 mm. Thickness 1 is outside a closed contour and to the right
of an authored open contour in sketch XY; Flip wall exchanges the sides.
Selections use the existing stable sketch/contour IDs, excluding construction
geometry. Legacy extrusion without `thin` keeps filled-region semantics.

CAD's native adapter offsets each wire in its local sketch plane, produces a
wall face with flat open caps and intersection joins, and uses the existing
extrusion direction, extent, draft and explicit result-scope machinery. Closed
walls retain their inner hole; crossing, collapsed, split or invalid boundaries
fail explicitly. Lines/arcs/circles use native analytic geometry; cubic offset
splines use OCCT BSpline conversion with area preservation checked to relative
1e-8 (absolute 1e-8 mm²). That conversion is a kernel approximation, not a proof
of mathematically exact spline offsets. Strict native BOP validity is required.

Translation forces region mode and emits `thin` snake-case fields. Geometry,
analysis and export require worker capability `extrude-thin`. The parked
browser evaluator refuses Thin instead of producing a filled prism. Current
Part/project readers accept v6; the older frozen v5 reader refuses it. Immutable
canonical workspace codec build3 adds only embedded Part6 acceptance.

Open/closed contour authoring, unit-aware thickness, flip/midplane, blue/red
preview, drag/Escape, cancel, edit/undo/redo, upstream changes, suppression,
fresh-tab reopen and native STEP are qualified in
`.verification/thin-extrusion-2026-10-13/RESULTS.md`. Surface extrusion, elliptical
and projected curve coverage, alternate corner/cap treatments, topology-changing
wall repair and broader Onshape parity remain open.

## Associative sketch-line direction (v5)

`extrude.directionReference` stores
`{kind: "sketch-line", sourceFeatureId, contourId, segmentId}`. It is mutually
exclusive with `directionVector`. The referenced source must be an earlier
authored profile sketch. Straight nonzero path segments, including construction
lines, are supported. Stable contour/segment IDs survive coordinate edits and
reordering; missing, curved, suppressed or ambiguous entities fail for repair.
No cached vector replaces an unresolved reference. Projected entities, legacy
rectangle sketches, solid edges and mate connectors are not offered here.

The product translator resolves the line's current constrained sketch coordinates.
The native adapter resolves its current support/frame before deriving the world
direction. Depth/offset/reversal and supported end conditions use the existing
direction contract below. The editor's Sketch line picker and on-model handle
use the same selected line. Non-normal draft remains unsupported. The parked
evaluator refuses this field, and live workers must advertise
`extrude-sketch-line-direction` for build, analysis and export.

## Native feature records (introduced during v3 development)


The authoritative schema and validator are in
`aether-engine/src/document/part-document.ts` and `solid-features.ts`. The v2
section below is a historical baseline, not the current feature inventory.
The current serializer preserves these native feature records under the version boundary above.

`extrude.draftAngleDegrees` is optional and signed: positive narrows material
away from the sketch, negative widens it, absent/zero retains a straight prism.
The sketch is the neutral plane even with `startingOffsetMillimeters`; reversing
the extrusion changes its direction without changing the taper convention.
Holes taper oppositely to outer boundaries. Angles must be finite with magnitude
below 90 degrees. Draft supports Blind, Symmetric, planar Up-to-face, solid-boundary Up-to-next and Through-all.
Symmetric splits the total depth equally and applies the same draft in opposite
directions. Up-to-face uses the infinite plane, including tilted stops, with
axial end offsets. Up-to-next requires complete termination of the actual tapered section against
first native solid boundaries, including curved/tilted and stepped stops.
Through-all reaches the exact directional target bound with a small kernel
clearance; Remove/Intersect result scope is unchanged.

`extrude.directionVector` optionally stores a finite unit world vector. Absent
uses the evaluated sketch normal. Depth, starting offset and signed end offsets
measure travel along the chosen vector. Remove retains its default negative
travel and `reversed` flips it. Tangent directions cannot create solids and fail.
The editor supplies world X/Y/Z axes and a normalized manual XYZ vector; the
on-model depth handle follows the same direction. Referenced lines/mate
connectors are not stored by this field. Oblique draft is not supported: either
end's nonzero draft with a non-normal direction fails before constructing tools.

`endType: "symmetric-through-all"` combines native Through-all tools in opposite
directions with the same draft angle, using the common starting plane and sketch
neutral plane. It supports Remove/Intersect and explicit target scope. The UI
shows Through all plus Symmetric. Independent/legacy opposite ends cannot coexist
with it. Old `endType: "symmetric"` continues to mean symmetric Blind depth.

`extrude.secondEnd` independently defines the opposite side:
`{ endType, distanceMillimeters, endReference?, endOffsetMillimeters?, draftAngleDegrees? }`.
End type is Blind, Through-all, Up-to-next or Up-to-face. Fields use the same
units/reference contract as the primary side, and distance remains positive
(the editor stores 1 for a non-Blind placeholder). The second side grows in the
opposite direction from the common offset starting plane. Each angle uses the
original sketch as neutral. Unequal draft angles with a starting offset can
produce a step at that starting plane. Stopping-face dependencies and implicit
Up-to-next dependencies apply to either side. Through-all is limited to
Remove/Intersect and may be empty on one side when the other reaches the target.

Legacy `secondDistanceMillimeters` remains loadable with its original
`[offset-second, offset+distance]` interval for straight prisms. Editing converts
it into `secondEnd`. It cannot coexist with that object or with Symmetric. A
legacy opposite depth with draft uses that depth as a straight opposite end.
Symmetric and an independent second end are mutually exclusive.

Translation emits `second_end` with snake-case distance/offset/angle keys and
preserved geometric reference objects, on a region-aware native pad/pocket.
Browser build, analysis and export require `extrude-independent-ends` for the new
object or two-sided draft, and `extrude-draft` for any taper, so older workers
cannot silently ignore the operation. Drafted referenced/Through-all ends also
require `extrude-drafted-limits`, including on an independent opposite end.
Drafted Up-to-next additionally requires `extrude-drafted-general-next`.
Custom directions and symmetric Through-all additionally require
`extrude-direction-vector` and `extrude-symmetric-through-all`, respectively.
The parked evaluator refuses these features. Collapse/intersection/topology-changing draft sections fail explicitly.
Up-to-vertex, broader direction entities, oblique draft, surface
extrusions remain unimplemented. Curved stopping limits use v11 above. Thin is described above. These records were introduced during v3 development; v4 now gates newly saved
files against older clients.

`import-cad` persists interchange source in v3: `format` is `step`, `iges`,
`brep`, `stl`, `obj`, `ply` or `off`; `sourceName` must match a supported suffix;
`dataBase64` preserves the original bytes; `operation` is `new`; `bodyId` is a
stable producer identity. Mesh formats also require `meshMode: "reference" |
"solid"` and `meshUnits: "mm" | "cm" | "m" | "in" | "ft"`. These fields are
absent on exact imports. The native adapter decodes every rebuild. The parked
WASM evaluator explicitly refuses the feature. Existing `import-step` records
remain supported without migration. Mesh references participate in history,
rename, visibility, suppression and deletion, but provide no exact faces/edges.
Changing the import interpretation to solid preserves its body and source IDs.
Native geometry tags references with `geometry_kind: "mesh"`; their zero volume
is a transport sentinel, never a physical measurement.

Planar references may include `faceAnchor: { centerMillimeters: [x,y,z],
areaSquareMillimeters }`. The same optional descriptor is used by `face-extrude`,
`profile.support` and `extrude.endReference`; wire translation uses `face_anchor`
for Push/Pull. It disambiguates faces with the same oriented normal using native
centroid and area, in body coordinates. Resolution requires exactly one match,
with centroid tolerance 1e-6 mm and area tolerance max(1e-6 mm², area × 1e-9).
No FaceN index is stored. References without an anchor retain their existing
unique-direction semantics and follow upstream dimensional changes. New selections
need an anchor only when the normal is ambiguous. An anchored centroid/area change,
missing face or unresolved collision requires explicit reselection; resolution
never falls back to a different face. This is geometric disambiguation, not general
topological naming. Change face clears the draft reference and preview so the
user can select pre-feature geometry without mutating the saved document.

Ordinary profile sketches use Change sketch plane to replace or remove a support.
The editor retains local contour coordinates, entity/constraint IDs, dimensions
and their label positions while choosing an earlier planar face or a principal
datum plane. A new choice replaces `frame`/`support` and resets
`offsetMillimeters` to zero; reopening without changing placement retains the
saved offset. Finish requires a selected plane and no known support error.
Cancel leaves the saved feature unchanged. This reuses v3 fields, not a new
format. Projection-derived sketches retain their separate projection editor.

`face-extrude` stores `sourceFeatureId`, `targetBodyId`, outward unit `normal`
(a three-number tuple), human-readable `faceLabel`, and signed
`distanceMillimeters`, alongside the usual id/name/suppressed fields. Positive
extends the selected planar footprint; negative cuts it. Rebuild resolves a
a single planar face by its oriented normal and optional anchor in both the
named source snapshot and target body.
It rejects unresolved ambiguity, missing faces, zero/nonfinite depths, and invalid/split or
empty results. It is not a general translate/rotate/offset-face operator.

An `extrude` may use `endType: "up-to-face"` and
`endReference: { sourceFeatureId, bodyId, normal, label, faceAnchor? }`. The referenced solid
must precede the extrusion. `startingOffsetMillimeters` and
`endOffsetMillimeters` use model millimeters; positive end offset stops short.
The native implementation resolves the infinite plane beneath a unique planar
stop, including tilted faces and profiles extending outside its trimmed edges.
The entire starting profile must lie before the offset stopping plane, and the
extrusion direction must intersect that plane. End offsets are measured along
the extrusion direction. It rebuilds from the selected source snapshot rather
than searching for the nearest body. Curved references use the v11 contract above; changing a planar reference face
orientation requires reselection.

Both reference types participate in history dependencies and source suppression.
Deleted references stay loadable for repair but fail evaluation explicitly;
there is no fallback to a transient FaceN index. The parked WASM evaluator
rejects these operations rather than returning approximate geometry.

An `extrude` with operation `add`, `cut` or `intersect` may specify `targetBodyIds`,
a nonempty list of up to 256 distinct body IDs. The existing `targetBodyId` must
match the first entry. Absence keeps the single-target interpretation. Every
selected part participates in history dependencies and suppression. Missing
parts are repairable evaluation errors, never an implicit scope change.

Native scoped extrusion computes all candidates before committing any result.
A failed/empty target rejects the entire operation. Remove leaves unhit selected
parts unchanged but must remove material from at least one target; Through-all
respects the chosen direction. Successful parts retain their IDs and provide
per-target source snapshots for later face references. Add requires the tool and
all explicitly selected parts to form one valid connected solid. It retains the
first target's body ID and properties and consumes the remaining selected outputs;
historical producers stay unchanged so suppressing the merge restores them. Its
preview compares the union of the selected inputs with the merged result, coloring
only new material blue. Automatic merge-all and Pattern/Mirror repetition of an
entire scoped feature are not implemented.

Native topology projections can include optional exact edge length, face area,
analytic radius, and circular-edge center in millimeter-based units. These are
regenerated B-Rep measurements, not a second persisted geometry representation.

---

# `.cadpart` format v2 (shipped transitional Part projection)

`.cadpart` is UTF-8 JSON containing editable, deterministic Part feature
history. It is not STEP and it is not a cached render mesh.

The long-term native container is the planned unified `.aether` workspace,
where Part, Assembly, and Drawing are views over one Aether Core graph. This
plain JSON format remains the shipped Part-authoring slice and will migrate as
a Part-rooted subgraph; it must never become an independently editable copy of
the same open `.aether` Part.

```json
{
  "format": "aether-part",
  "formatVersion": 2,
  "documentId": "stable-document-id",
  "name": "Bracket",
  "units": "millimeter",
  "features": [
    {
      "id": "stable-sketch-id",
      "type": "sketch",
      "name": "Sketch 1",
      "plane": "XY",
      "profile": {
        "type": "center-rectangle",
        "widthMillimeters": 60,
        "heightMillimeters": 40,
        "centerXMillimeters": 0,
        "centerYMillimeters": 0,
        "construction": false
      },
      "constraints": [
        { "id": "stable-sketch-id:constraint:horizontal", "type": "horizontal", "target": "center-rectangle" },
        { "id": "stable-sketch-id:constraint:vertical", "type": "vertical", "target": "center-rectangle" },
        { "id": "stable-sketch-id:constraint:coincident-origin", "type": "coincident-origin", "target": "center-rectangle" }
      ],
      "dimensions": [
        { "id": "stable-sketch-id:dimension:width", "type": "width", "target": "center-rectangle", "valueMillimeters": 60 },
        { "id": "stable-sketch-id:dimension:height", "type": "height", "target": "center-rectangle", "valueMillimeters": 40 }
      ],
      "suppressed": false
    },
    {
      "id": "stable-extrude-id",
      "type": "extrude",
      "name": "Extrude 1",
      "profileFeatureId": "stable-sketch-id",
      "distanceMillimeters": 12,
      "operation": "new",
      "suppressed": false
    }
  ]
}
```

The `units` field records the source/display convention for this v2 slice.
Contract values are already explicit in their names (`widthMillimeters`,
`heightMillimeters`, `distanceMillimeters`); no bare number inherits semantic
units from `units`. The planned cross-language graph uses `_mm`, `_m`, `_rad`,
and similar suffixes.

## Version 2 limits

- one center-rectangle Sketch;
- one of the three principal planes (`XY`, `XZ`, or `YZ`);
- Horizontal, Vertical, and center-to-Origin Coincident constraints;
- explicit width and height dimensions;
- one positive-distance New Extrude;
- one resulting solid Body;
- millimeters only.

The sketch editor reports remaining degrees of freedom and uses blue geometry
for an under-defined rectangle and black geometry for a fully defined one.
Version 1 center rectangles migrate on open into the equivalent fully defined
version 2 constraint and dimension graph without changing document or feature
IDs. The schema uses stable IDs so later versions can add general sketch
entities, richer constraint graphs, feature references, booleans, fillets,
suppression, diagnostics, migrations, and stable topology naming.

## Rebuild rule

Opening a file validates the complete feature list, evaluates it in order in
the OCCT worker, extracts authoritative B-Rep topology, and then generates a
disposable display mesh. Invalid history fails before replacing the visible
Body.

Files created under the provisional `open-cad-part` identity remain readable;
opening one migrates its identity in memory, and the next save writes
`aether-part` without changing its stable document or feature IDs.
