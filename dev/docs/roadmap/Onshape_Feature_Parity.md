# Onshape feature parity — control by control

Each feature's window must carry the controls of Onshape's (Jonathan, 2026-11-02), checked
against Onshape's help pages, not memory. One table per feature; a row is Done when the
window, the document record, the kernel and the agent path (`feature_add` / `feature_update`
on the same record) all carry it. Kernel gaps name the capability OCCT lacks today.

Source pages: https://cad.onshape.com/help/Content/fillet.htm,
https://cad.onshape.com/help/Content/chamfer.htm

## Qualification pass — 2026-11-04

Requested order: **Extrude, Revolve, Chamfer, Fillet**. Shared interaction fixes
below are a prerequisite, not a declaration of complete Onshape parity. A row
marked Done in the older tables is bounded by its stated geometry restrictions;
a matching dialog, a disabled option or a single successful fixture is not a
release qualification for the entire feature. “Kernel gap” means missing Aether
implementation or exposed binding unless separately established as an OCCT limit.

The canonical presentation is Aether UI `mountValueManipulator`: white linear
arrows, blue pivot, dashed projected orbits with tangent ribbons, and an editable
value. Section now uses that same component instead of its own orbit/readout
renderer. CAD owns projections, units, native preview and validated document edits.
Existing providers retain correct disabled state after preview updates, typed
expressions target the last adjusted parameter, Escape cancels a typed draft,
and Enter followed by blur commits only once.

| Feature | Verified interaction change | Remaining qualification scope |
| --- | --- | --- |
| Extrude | Native handles use the resolved direction and starting offset; both symmetric ends share total depth; independent second ends keep their own value. Stop-bound ends do not show a depth control that has no effect. Starting offset uses the shared value control. Oblique extrusion and explicit-unit secondary-depth edits survive saved reopen. | Surface mode integration; draft/Thin/oblique and stopping-limit combinations; handles for remaining enabled parameters; complete reference-control coverage. |
| Revolve | Orbit ribbon follows the actual angle. Angular keyboard edits produce a valid native preview; cancel restores the document. Shared readout accepts complete unit expressions. | Every extent/axis/Thin combination and remaining offset controls. |
| Chamfer | A native quarter-revolved stepped shaft's circular shoulder can be selected, changed with the shared size handle, applied, reselected while editing earlier history, and saved with the exact curved-edge reference. | Second-distance and angle handles, all direction/measurement combinations and general geometry coverage. |
| Fillet | The same shoulder fixture passes selection, radius manipulation, native preview, apply, history reselection and save. | Partial/asymmetric/conic/curvature controls, arbitrary variable-radius points, overflow/corners, and general full-round geometry remain incomplete. |

History preview previously ignored mixed edge/face picking and returned a face.
It now uses the main viewport's selection rule. The browser gate checks the saved
shoulder midpoint is at z=10 mm, rather than accepting the visually overlapping
upper rim at z=25 mm. The fixture is an editable sketch and Revolve, with actual
Chamfer/Fillet features; it contains no imported solids.

Qualification evidence: [native and browser checks](../reality/data/Feature_Controls_2026_11_04.json). The actual modeling browser gate also passes sketch creation, Extrude New/Add/Remove/Intersect, Revolve, Fillet, Shell, Mirror, Pattern, Boolean, Hole, surfaces, sheet metal and 3D Sketch, with no server geometry requests.

References reviewed: [Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)
and [Fillet](https://cad.onshape.com/help/Content/PartStudio/fillet.htm). Onshape's
second-end draft controls and partial/variable fillet controls remain explicit
requirements, not optional cosmetic additions.

## Fillet (`src/features/fillet.ts`, `aether-engine/src/kernel/features/edge-finish.ts`)

| Onshape control | Ours | Status |
| --- | --- | --- |
| Fillet type: Edge / Full round | Edge / Full round tabs; Full round takes Side face, Opposite side face, Faces to replace, Tangent propagation | Done for parallel planar side faces with planar faces between (inscribed cylinder, exact volume test); other side faces refused with the reason (kernel gap: general full-round blend) |
| Entities: edges or faces | Entities to fillet, faces expand to their edges | Done (alpha-0.1.91) |
| Tangent propagation (default on) | Tangent propagation | Done |
| Measurement: Radius / Width | Measurement: Radius / Width (width = 2 r sin(β/2) through the dihedral angle) | Done (alpha-0.1.91) |
| Control: Distance / Conic (rho) / Curvature (magnitude) | Control picker with all three; Conic and Curvature refuse with the gap named, Rho and Magnitude rows disabled | Kernel gap: OCCT fillets are circular |
| Radius with drag manipulator | Radius with the preview handle | Done |
| Asymmetric: second radius, flip | Asymmetric sub-setting with Second radius and flip, disabled with the gap named | Kernel gap: elliptical blend |
| Partial fillet: start/end by position, entity or offset | Partial fillet sub-setting with Start position, End type, Second bound, disabled with the gap named | Kernel gap: edge split before blending |
| Variable fillet: per-vertex radii, points on edge, smooth transition | Variable fillet sub-setting: End radius live; Add point on edge and Smooth transition disabled with the gap named | Partial: start and end radius (kernel gap: radius law through points) |
| Allow edge overflow (default on) + edges to keep | Allow edge overflow sub-setting, checked and disabled (always on here) with the Edges to keep box disabled | Kernel gap: keep-edge control |
| Smooth fillet corners + corners to exclude | Smooth fillet corners sub-setting with Corners to exclude, disabled with the gap named | Kernel gap: vertex blends |

Fillet and Chamfer have no Target body box (Onshape names none): the body is the picked entities' body.
Every disabled control names its kernel gap in its tooltip (alpha-0.1.98).

## Chamfer (`src/features/chamfer.ts`)

| Onshape control | Ours | Status |
| --- | --- | --- |
| Entities: edges or faces | Entities to chamfer, faces expand to their edges | Done (alpha-0.1.91) |
| Measurement: Offset / Tangent | Measurement: Offset / Tangent distance (equal distance only) | Partial |
| Chamfer type: Equal distance / Two distances / Distance and angle | Same | Done |
| Distance, second distance, angle (45° default) | Same | Done |
| Direction flip (all edges) | Reference face (optional) decides the first leg | Different; flip + overrides next |
| Direction overrides (per edge) | — | Open |
| Tangent propagation | Tangent propagation | Done |
| Tolerance options | — | Open (document-level precision) |

## Shell (`src/features/shell.ts`) — https://cad.onshape.com/help/Content/shell.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Faces to shell (faces to remove) | Faces to remove | Done |
| Hollow | Hollow | Done |
| Shell thickness | Shell thickness | Done |
| Opposite direction arrow (inside / outside) | Flip beside the thickness | Done |

## Boolean (`src/features/boolean.ts`) — https://cad.onshape.com/help/Content/booleanparts.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Union / Subtract / Intersect | Same tabs | Done |
| Tools (parts or surfaces) | Tools, picked | Done (parts) |
| Keep tools | Keep tools | Done |
| Targets (Subtract) | Target body box | Done |
| Offset (Subtract): Offset all, Faces to offset, distance, flip, Reapply fillet | Offset sub-setting with all five, disabled with the gap named | Kernel gap: offset subtract |
| Surfaces as tools | — | Open |

## Mirror (`src/features/mirror.ts`) — https://cad.onshape.com/help/Content/mirror.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Feature / Face mirror | Part / Feature / Face tabs; Part and Face disabled with the gap named (parts mirror with Transform › Mirror) | Partial: features only |
| New / Add / Remove / Intersect | New / Add / Remove / Intersect tabs; New and Intersect disabled with the gap named | Partial (New, Intersect) |
| Entities to mirror | Features to mirror | Done (features) |
| Mirror plane: planar face, standard plane, Plane feature, mate connector | Plane box: tree plane, Plane feature, face | Done (no mate connectors) |
| Reapply features | Reapply features row, disabled with the gap named | Kernel gap |
| Merge scope / Merge with all | Merge with all, or the target plus additional parts (Extrude's scope, now shared by Revolve); a new revolve starts with the explicit target because the automatic scope's overlap test refused the region-pick gate's edge-touching revolve | Done (alpha-0.1.98); automatic scope on revolves open |

## Split (`src/features/split.ts`) — https://cad.onshape.com/help/Content/PartStudio/split.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Face tabs | Part / Face switch as the window's first row, opening the Face split feature | Done |
| Parts to split (parts, surfaces, curves) | Part to split (one part) | Partial |
| Entity to split with: plane, cylinder, mate connector, surface, face | Plane box: tree plane, Plane feature, planar face, sketch line | Partial (surfaces, cylinders) |
| Keep tools, Trim to face boundaries | Both rows present, disabled with the reason | Kernel gap: surface tools, trim to face |
| Keep both sides + opposite direction arrow | Keep both sides with the Opposite direction button | Done |

## Revolve (`src/features/revolve.ts`) — https://cad.onshape.com/help/Content/revolve.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin | Solid / Surface / Thin tabs | Done |
| New / Add / Remove / Intersect | New / Add / Remove (Intersect shown) | Partial: Intersect |
| Faces and sketch regions | Same | Done |
| Revolve axis: line, edge, cylindrical edge, circular entity, arc, mate connector | Sketch line, Axis feature, solid edge, principal axis | Partial: cylindrical/circular entities |
| Full revolve; Blind with angle, flip, Symmetric | Same | Done |
| Up to next / face / part / vertex | Same, both ends | Done (alpha-0.1.90) |
| Angle offset; Offset distance + flip | Offset sub-setting (distance, flip) for Up-to ends, disabled with the gap named | Kernel gap: revolve end offset |
| Second end position | Same controls as the first end | Done (alpha-0.1.90) |
| Thin: Mid plane, Thickness 1/2, flip | Thin options | Check against sweep/thin module |
| Merge scope / Merge with all | Target body | Partial |

## Sweep (`src/features/sweep.ts`) — https://cad.onshape.com/help/Content/sweep.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin, operations | Tabs | Done |
| Faces and sketch regions to sweep | Same | Done |
| Sweep path + opposite direction arrow | Sweep path box with the Opposite direction button, disabled with the gap named | Partial: flip open |
| Profile control: None / Keep profile orientation / Lock profile faces / Lock profile direction | Profile control picker with all four; Lock profile faces refuses with the gap named; Lock profile direction takes the up direction | Partial: lock profile faces |
| Twist: Turns / Angle / Pitch, opposite, extend | Twist sub-setting with its rows, disabled with the gap named | Kernel gap: twist |
| Scale: scale factor | End scale | Done |
| Thin: Mid plane, thickness, Trim ends | Thin tab and Trim ends disabled with the gap named | Kernel gap: thin sweep |
| Merge scope | Merge scope box (one part) | Partial: one part |

## Loft (`src/features/loft.ts`) — https://cad.onshape.com/help/Content/loft.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Profiles, reorder | Sections | Partial: reorder |
| Start/End profile condition: Normal, Tangent, Match tangent, Match curvature | Start and End profile condition rows, disabled with the gap named | Kernel gap: loft constraints |
| Guides and continuity, Trim guides, Trim profiles | Guides and continuity sub-setting, disabled with the gap named | Kernel gap |
| Path + section count | Path sub-setting, disabled with the gap named | Kernel gap |
| Connections (vertex pairs) | Connections sub-setting, disabled with the gap named | Kernel gap |
| Show isocurves | Show isocurves row, disabled with the gap named | Gap: isocurve overlay |
| Thin, Merge scope | Thin tab disabled (gap); Merge scope box (one part) | Partial |

## Hole (`src/features/hole.ts`) — https://cad.onshape.com/help/Content/hole.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Inch / Metric | Metric / Inch tabs choose the standard family (ISO metric or UNC/UNF) | Done (alpha-0.1.98) |
| Simple / Counterbore / Countersink | Simple / Counterbore / Countersink tabs (a saved counterdrill keeps a fourth) | Done (alpha-0.1.98) |
| Sketch points to place holes (+ implicit mate connectors) | Sketch points to place holes: points from the list or every point of a sketch picked in the tree; one hole per point, square to its sketch | Done (alpha-0.1.98); viewport picking of sketch points and mate connectors open |
| Merge scope | Merge scope box (one part) | Partial: one part |
| Hole type: Drilled / Clearance / Tapped / PEM, with Standard, Size, fit, threads/inch, class | Hole type picker with all four; Standard, Size, Fastener fit, Thread class; PEM and pipe taps refuse with the gap named | Partial: PEM, pipe taps |
| Diameter | Diameter | Done |
| Start plane: part / sketch plane / selected plane | Start plane picker with all three; part and selected plane refuse with the gap named | Kernel gap: start from part / selected plane |
| Termination: Blind / Up to next / Up to entity / Through all, flip | Termination picker with all four and the flip; Up to next and Up to entity refuse with the gap named | Kernel gap: up-to terminations |
| Counterbore / countersink diameter and depth or angle | Counterbore diameter and depth; Countersink diameter and angle rows | Done |
| Tip angle: 118 / 135 / Flat / Custom | Tip angle style picker: 118 degrees / 135 degrees / Flat / Custom with Tip angle | Done (alpha-0.1.98) |

## Patterns (`src/features/pattern.ts`) — linearpattern.htm, circularpattern.htm, curvepattern.htm

One window today with a Pattern type select; Onshape has three tools. Split into
`linear-pattern.ts`, `circular-pattern.ts`, `curve-pattern.ts` over one pattern core.

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Feature / Face pattern | Part / Feature / Face tabs; Face disabled with the gap named | Partial: faces |
| New / Add / Remove / Intersect | New / Add / Remove / Intersect tabs; a feature pattern repeats its feature's own result, a part pattern is New; the others disabled with the reason | Partial |
| Entities to pattern | Parts to pattern box + feature chips | Done (parts, features) |
| Linear: Direction (plane, face, edge, line, curve, mate connector) + flip, Distance, Instance count, Centered, Second direction, Skip instances | Direction box (principal axes or a picked straight edge) with flip, Distance, Instance count, Centered, Second direction with its own direction, flip, distance, count and Centered; Skip instances disabled with the gap named | Partial: direction by plane/face/curve/mate connector and skipping open |
| Circular: Axis of pattern + flip, Angle, Instance count, Equal spacing, Centered, Skip instances | Axis of pattern box (principal axes or a picked straight edge) with flip, Angle, Instance count, Equal spacing (off: the angle is between instances), Centered; Skip instances disabled with the gap named | Partial: axis by cylindrical face/mate connector and skipping open |
| Curve: Path, Equal spacing / Distance, Instance count, Orientation (Tangent / Normal to face / Locked + lock faces), Skip instances | Path sketch, spacing/distance, count, orientation identical/path | Partial |
| Reapply features, Merge scope | Reapply features disabled with the gap named; Merge scope box (one part) | Partial |

## Transform (`src/features/part-transform.ts`) — https://cad.onshape.com/help/Content/transform.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Entities to transform or copy | Transform part IDs (selection) | Done |
| Translate by line (line or two points) | Translate by line | Done |
| Translate by distance (direction + distance + arrow) | Listed, disabled with the gap named | Kernel gap |
| Translate by XYZ (fields + manipulator) | Translate XYZ + handles | Done |
| Transform by mate connectors (from / to + flips) | Transform by faces or points (named as such) | Different: no mate connectors |
| Rotate (axis + angle + arrow) | Rotate | Done |
| Copy in place | Copy | Done |
| Scale (uniform or XYZ, about point) | Scale (about a picked point) and Scale about XYZ, uniform or per axis | Done |
| Copy part | Copy part | Done |

## Thicken and Enclose (`src/features/surface.ts`) — thicken.htm, enclose.htm

Both live in surface.ts today; move each to its own file.

| Onshape control | Ours | Status |
| --- | --- | --- |
| Thicken: New / Add / Remove / Intersect; faces and surfaces; Mid plane, Thickness 1 / 2, flip, Keep tools, Merge scope | New / Add / Remove (Intersect disabled), Faces and surfaces to thicken, Mid plane with Thickness, else Thickness 1 with the flip; Thickness 2 and Keep tools disabled with the gap named; Merge scope box | Partial: second thickness, keep tools |
| Enclose: New / Add / Remove / Intersect; Entities (surfaces, faces, planes, parts); Keep tools; Merge scope | Boundary fill | Rework to the reference layout |

## External thread (`src/features/thread.ts`) — https://cad.onshape.com/help/Content/PartStudio/external_thread.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Cylinder edges (same size) | Cylindrical face box (one face) | Different: the face, not its edges |
| Standard ANSI / ISO, Size (auto from diameter), Threads per inch / Pitch | Standard (ISO metric, UNC/UNF, BSP, NPT), Size, Pitch or Threads per inch read from the size | Partial: size from the diameter open |
| End type Blind / Up to next, Length | End type picker Blind (Length) / Up to next | Done |
| Add chamfer (distance, angle), Add undercut (diameter, length), Split face | All three present, disabled with the gap named | Kernel gap |

## Extrude (`src/features/extrude.ts`) — https://cad.onshape.com/help/Content/extrude.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin; New / Add / Remove / Intersect | Same | Done |
| Faces and sketch regions | Same | Done |
| End type Blind / Up to next / face / part / vertex / Through all, flip | Same | Done |
| Offset (up-to types) + distance | End offset | Done |
| Direction (axis or mate connector) | Direction subsection | Done (axis, line, edge) |
| Starting offset: Blind distance / Entity (part, face, mate connector), Symmetric, flip | Starting offset sub-setting: Start type Blind / Entity: face / Entity: plane with the Offset and flip | Partial: part and mate connector entities open |
| Symmetric (Blind, Through all) | Symmetric | Done |
| Draft angle + flip | Draft | Done |
| Second end position: own end type, depth, draft | Same | Done |
| Merge scope / Merge with all | Merge scope mode + parts | Done |
| Thin: Mid plane, Thickness 1 / 2, flip | Thin options | Done |

## Draft (`src/features/draft.ts`) — https://cad.onshape.com/help/Content/draft.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Neutral plane / Parting line tabs | Neutral plane / Parting line tabs; Parting line disabled with the gap named | Kernel gap: parting-line draft |
| Neutral plane (face or mate connector) | Neutral plane box (planar face), first as Onshape's | Done (alpha-0.1.98); mate connectors open |
| Entities to draft | Entities to draft box | Done |
| Draft angle + arrow manipulator, flip | Draft angle with the flip button | Partial: handle open |
| Tangent propagation | Tangent propagation row, disabled with the gap named | Kernel gap |
| Reapply fillets | Reapply fillets row, disabled with the gap named | Kernel gap |
| Parting line: pull direction, parting edges, propagation, One sided / Symmetric / Two sided, flip | — | Open |

## Body draft (reference sent 2026-11-02)

Draft scope (Parts to draft / …), Parts, Faces to exclude, Draft on self, Pull direction, Parting
entity, Angle, Symmetric, Corner type (Extend / …), Keep material. Not implemented; needs a
parting-entity draft in the kernel. Status: Open.

## Rib (`src/features/rib.ts`?) — https://cad.onshape.com/help/Content/rib.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Sketch profiles (rib centrelines) | — | Open: no Rib feature yet |
| Parts | — | Open |
| Thickness | — | Open |
| Parallel / Normal to sketch plane + flip | — | Open |
| Draft angle + flip | — | Open |
| Extend profiles to part | — | Open |
| Merge ribs | — | Open |

## Face blend — https://cad.onshape.com/help/Content/face-blend.htm

Side 1 / Side 2 with flips; Propagation (Tangent / Adjacent / Custom angle); Cross section
(Rolling ball / Swept profile + spine; Measurement Radius / Width; Asymmetric second radius or
ratio); Control (Circular / Conic rho / Curvature magnitude / Chamfer); Constraints and limits
(tangent and conic hold lines, cliff edges, caps, plane / face / edge limits, help point); Trim
type (Wall / Short / Long / No trim); Detached; Show isocurves. Not implemented; a rolling-ball
blend between two face sets is the kernel step to take first. Status: Open.

## Next batch (order)

1. Chamfer: direction flip and per-edge Direction overrides (kernel: selectedFace per edge).
2. Patterns: `linear-pattern.ts`, `circular-pattern.ts`, `curve-pattern.ts` over one pattern core;
   Direction and Axis pick boxes (plane, face, edge, line, mate-connector-less), Centered,
   Equal spacing, Skip instances, New/Add/Remove/Intersect; Face pattern after.
3. Mirror: Part / Feature mirror in one window; New / Intersect; parts through the part box.
4. Split: surfaces and cylinders as the splitting entity, Keep tools, side flip; Face split tab.
5. Sweep: Profile control picker (None / Keep orientation / Lock faces / Lock direction with a
   direction pick box), path flip, Twist, Thin, Trim ends.
6. Thicken and Enclose in their own files with the reference layout; Boolean Subtract Offset.
7. Draft: Neutral plane / Parting line tabs, tangent propagation, flip, angle handle.
8. Hole: Inch/Metric, Simple/Counterbore/Countersink tabs, sketch points, termination, start
   plane, tip angle. Thread: cylinder edges, auto size, pitch, Blind / Up to next, chamfer,
   undercut, split face.
9. Loft end conditions, guides, path; Rib; Body draft; Face blend (kernel work first).

## Requirements for the next update (Jonathan, 2026-11-02, consolidated)

### Open after alpha-0.1.95 (2026-11-03)
- Section view: dragging the foreshortened X orbit from an oblique camera (normal 1,-1,1) leaves Rotation X
  unchanged (`verify-concurrent-inspection-browser`, `inspection-parity.mjs`); the Y orbit drag works. Not
  touched by the document-format change; the hook `aether-section-normal` still fires.
- Three browser gates still assert controls from before the header, panel and ribbon reworks and need
  rewriting against the current UI: `verify-toolbar-presets-browser` (the "Modify tools" menu no longer
  lists Union/Subtract/Intersect as menu items), `verify-assembly-insert-browser` (the command palette
  input selector), `verify-part-assembly-browser` (the component context menu). Their document-format
  steps already pass up to those points.

Every item below is a requirement, not a suggestion; each is closed only with a test or a gate.

1. **Every reference window, every control.** The tables above are the checklist: Fillet (Edge /
   Full round, Measurement, Control, Asymmetric, Partial, Variable with vertices, Allow edge
   overflow, Smooth corners), Face blend, Chamfer (Direction flip, Direction overrides),
   Extrude, Revolve (angle offset, offset distance), Sweep (Profile control, Twist, Thin),
   Loft (end conditions, guides, path, connections), Thicken, Enclose, Draft (both modes),
   Body draft, Rib, Shell, Hole, External thread, Linear / Circular / Curve pattern, Mirror,
   Boolean (Subtract offset), Split (Part / Face). Kernel gaps are named in the tables and
   closed by kernel work, never by a control that does nothing.
2. **One file per feature** under `src/features/`; shared pieces (part box, plane box, entity
   box, value handles) are their own modules. Thicken and Enclose leave surface.ts; the three
   patterns leave pattern.ts.
3. **Selection:** one rule, as Onshape's — a vertex within 6 px, else an edge within 12 px, else
   the face under the pointer; filters only restrict; the Selection Priority variants are deleted
   (alpha-0.1.92). Faces, edges, vertices, sketches, planes, parts and axes pick from the
   viewport or tree into pick boxes; no dropdowns for geometry; no buttons inside pick boxes.
4. **One manipulator:** every adjustable value shows Aether UI's value manipulator (axis
   arrow, rotation ribbon, guide, editable readout): extrude depth, revolve angle, fillet
   radius, chamfer distance, shell thickness, pattern distance / angle, draft angle, hole
   depth, section offset. Done in CAD for extrude, revolve and the preview handles; the
   section view, pattern and draft follow.
5. **Aether UI owns chrome:** flips are glyph icon buttons; tree and window conventions live in
   Aether UI; header pins offer the layout switch, Windows and the app tray.
6. **Ribbon:** a tool is listed once per workspace (shared sections on Solid only, done); the
   catch-all Features tab is gone, search still reaches every feature (done); workspaces follow
   the open document (done); tabs per document type come from the layouts.
7. **Agents use the same pipeline:** every window commits the canonical feature record that
   `feature_add` / `feature_update` validate; schemas regenerate from the document types.
8. **Bare-minimum verification per feature:** a window serialization test, an engine test with
   a closed-form or self-consistency expectation, and a browser gate step for viewport picks.

## Selection (alpha-0.1.93)

- alpha-0.1.96: an edge with sampled points behind the camera's near plane (a large rim while zoomed in
  close) was unpickable because one unprojectable sample made the whole edge's distance infinite; the
  distance now skips those samples, and straight edges are sampled too. The engine also keeps a pick
  candidate for every edge even when its analytic inspection fails or its midpoint coincides with another
  node (`part-evaluator.test.ts`: every edge of every face has a candidate).
  Gate note: `verify-modeling-browser` failed once at the Sheet Base step (Hole 13 and Revolve 14
  reported "Cut removes no material" on a full-timeline replay) and passed on an immediate rerun of the
  same build; the replay nondeterminism is open.
- alpha-0.1.97: Fillet and Chamfer accept picked curved faces (cylinder, cone, sphere, torus and the
  free-form kinds) as Onshape's "Face of Revolve 1": the viewer references a non-planar face by its
  surface type, centre and area (`viewport/planar-face-reference.ts` `nativeFaceReference`), which the
  evaluator already resolved; before, only planar faces produced a reference and every curved-face pick
  was refused as "Select native faces on earlier solid parts". Their Target body box is gone: the body
  is the picked entities' body, as Onshape's. The chamfer types already match (Equal distance, Two
  distances, Distance and angle; Offset or Tangent distance; flip; direction overrides); the Measurement
  row now sits above the type, as Onshape's. Gap: Onshape offers Tangent distance for every chamfer
  type; ours only for Equal distance (`solid-features.ts` refuses it with a second distance or angle).

One rule, no modes: the select tool resolves by proximity to the hit point — a vertex within
6 px, else an edge within 12 px (distance to the engine's sampled polyline), else the face under
the pointer. Hovered and selected edges draw an outline; a face lights up only when the pointer
is on the face. The Selection Priority and the body / face / edge / vertex Selection Filters are
deleted (tools, commands, palette entries, help, store action). Component remains for
assemblies. Open: snapping to vertices and anchor points in sketch-on-face flows; the reported
slowdown while hovering and reselecting over time — the region-pick gate now times a hover
sweep twice and fails if the second pass is 3× slower, so a regression shows in the fixture.
