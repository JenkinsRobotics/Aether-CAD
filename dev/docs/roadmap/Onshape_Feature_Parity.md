# Onshape feature parity — control by control

Each feature's window must carry the controls of Onshape's (Jonathan, 2026-11-02), checked
against Onshape's help pages, not memory. One table per feature; a row is Done when the
window, the document record, the kernel and the agent path (`feature_add` / `feature_update`
on the same record) all carry it. Kernel gaps name the capability OCCT lacks today.

Source pages: https://cad.onshape.com/help/Content/fillet.htm,
https://cad.onshape.com/help/Content/chamfer.htm

## Fillet (`src/features/fillet.ts`, `aether-engine/src/kernel/features/edge-finish.ts`)

| Onshape control | Ours | Status |
| --- | --- | --- |
| Fillet type: Edge / Full round | Edge only | Kernel gap: full-round blend between two side faces |
| Entities: edges or faces | Entities to fillet, faces expand to their edges | Done (alpha-0.1.91) |
| Tangent propagation (default on) | Tangent propagation | Done |
| Measurement: Radius / Width | Measurement: Radius / Width (width = 2 r sin(β/2) through the dihedral angle) | Done (alpha-0.1.91) |
| Control: Distance / Conic (rho) / Curvature (magnitude) | Distance only | Kernel gap: OCCT fillets are circular |
| Radius with drag manipulator | Radius with the preview handle | Done |
| Asymmetric: second radius, flip | — | Kernel gap: elliptical blend |
| Partial fillet: start/end by position, entity or offset | — | Kernel gap: edge split before blending |
| Variable fillet: per-vertex radii, points on edge, smooth transition | Variable fillet: start and end radius | Partial (two-value only) |
| Allow edge overflow (default on) + edges to keep | Always on | Kernel gap: keep-edge control |
| Smooth fillet corners + corners to exclude | — | Kernel gap: vertex blends |

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
| Offset (Subtract): Offset all, Faces to offset, distance, flip, Reapply fillet | — | Open |
| Surfaces as tools | — | Open |

## Mirror (`src/features/mirror.ts`) — https://cad.onshape.com/help/Content/mirror.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Feature / Face mirror | Feature mirror here; part mirror in Transform › Mirror | Partial: one window with the type picker next |
| New / Add / Remove / Intersect | Add / Remove | Partial (New, Intersect) |
| Entities to mirror | Features to mirror | Done (features) |
| Mirror plane: planar face, standard plane, Plane feature, mate connector | Plane box: tree plane, Plane feature, face | Done (no mate connectors) |
| Reapply features | — | Open |
| Merge scope / Merge with all | Target body | Partial |

## Split (`src/features/split.ts`) — https://cad.onshape.com/help/Content/PartStudio/split.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Face tabs | Part only | Open: face split |
| Parts to split (parts, surfaces, curves) | Part to split (one part) | Partial |
| Entity to split with: plane, cylinder, mate connector, surface, face | Plane box: tree plane, Plane feature, planar face, sketch line | Partial (surfaces, cylinders) |
| Keep tools, Trim to face boundaries | — | Open |
| Keep both sides + opposite direction arrow | Keep both sides | Partial: side flip |

## Revolve (`src/features/revolve.ts`) — https://cad.onshape.com/help/Content/revolve.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin | Solid / Surface / Thin tabs | Done |
| New / Add / Remove / Intersect | New / Add / Remove (Intersect shown) | Partial: Intersect |
| Faces and sketch regions | Same | Done |
| Revolve axis: line, edge, cylindrical edge, circular entity, arc, mate connector | Sketch line, Axis feature, solid edge, principal axis | Partial: cylindrical/circular entities |
| Full revolve; Blind with angle, flip, Symmetric | Same | Done |
| Up to next / face / part / vertex | Same, both ends | Done (alpha-0.1.90) |
| Angle offset; Offset distance + flip | — | Open |
| Second end position | Same controls as the first end | Done (alpha-0.1.90) |
| Thin: Mid plane, Thickness 1/2, flip | Thin options | Check against sweep/thin module |
| Merge scope / Merge with all | Target body | Partial |

## Sweep (`src/features/sweep.ts`) — https://cad.onshape.com/help/Content/sweep.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin, operations | Tabs | Done |
| Faces and sketch regions to sweep | Same | Done |
| Sweep path + opposite direction arrow | Sweep path | Partial: flip |
| Profile control: None / Keep profile orientation / Lock profile faces / Lock profile direction | Orientation select + Up direction X/Y/Z fields | Replace with picker and a direction pick box |
| Twist: Turns / Angle / Pitch, opposite, extend | — | Open |
| Scale: scale factor | End scale | Done |
| Thin: Mid plane, thickness, Trim ends | — | Open |
| Merge scope | Target body | Partial |

## Loft (`src/features/loft.ts`) — https://cad.onshape.com/help/Content/loft.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Profiles, reorder | Sections | Partial: reorder |
| Start/End profile condition: Normal, Tangent, Match tangent, Match curvature, direction + magnitude | — | Open (kernel: loft constraints) |
| Guides and continuity, Trim guides, Trim profiles | — | Open |
| Path + section count | — | Open |
| Connections (vertex pairs) | Apex only | Open |
| Show isocurves | — | Open |
| Thin, Merge scope | — | Open |

## Hole (`src/features/hole.ts`) — https://cad.onshape.com/help/Content/hole.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Inch / Metric | Document units | Different |
| Simple / Counterbore / Countersink | Hole type select | Partial: tabs |
| Sketch points to place holes (+ implicit mate connectors) | Sketch circle regions or a face + point | Different: rework onto sketch points |
| Merge scope | Target body | Partial |
| Hole type: Drilled / Clearance / Tapped / PEM, with Standard, Size, fit, threads/inch, class | Thread profile, Size, Thread, fit, class | Partial |
| Diameter | Diameter | Done |
| Start plane: part / sketch plane / selected plane | — | Open |
| Termination: Blind / Up to next / Up to entity / Through all, flip | Depth only | Open |
| Counterbore / countersink diameter and depth or angle | Present | Check |
| Tip angle: 118 / 135 / Flat / Custom | — | Open |

## Patterns (`src/features/pattern.ts`) — linearpattern.htm, circularpattern.htm, curvepattern.htm

One window today with a Pattern type select; Onshape has three tools. Split into
`linear-pattern.ts`, `circular-pattern.ts`, `curve-pattern.ts` over one pattern core.

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Feature / Face pattern | Feature / Parts | Partial: faces |
| New / Add / Remove / Intersect | — | Open |
| Entities to pattern | Parts to pattern box + feature chips | Done (parts, features) |
| Linear: Direction (plane, face, edge, line, curve, mate connector) + flip, Distance, Instance count, Centered, Second direction, Skip instances | Direction source select + X/Y/Z fields or edge, spacing, count, second direction | Replace selects with a direction pick box; add Centered, Skip instances |
| Circular: Axis of pattern + flip, Angle, Instance count, Equal spacing, Centered, Skip instances | Axis select (X/Y/Z or edge), angle, count | Axis pick box; Equal spacing, Centered, Skip instances |
| Curve: Path, Equal spacing / Distance, Instance count, Orientation (Tangent / Normal to face / Locked + lock faces), Skip instances | Path sketch, spacing/distance, count, orientation identical/path | Partial |
| Reapply features, Merge scope | — | Open |

## Transform (`src/features/part-transform.ts`) — https://cad.onshape.com/help/Content/transform.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Entities to transform or copy | Transform part IDs (selection) | Done |
| Translate by line (line or two points) | Translate by line | Check |
| Translate by distance (direction + distance + arrow) | Translate by distance | Check |
| Translate by XYZ (fields + manipulator) | Translate XYZ + handles | Done |
| Transform by mate connectors (from / to + flips) | Align from/to (face or point) | Different |
| Rotate (axis + angle + arrow) | Rotate | Done |
| Copy in place | Copy | Done |
| Scale (uniform or XYZ, about point) | Scale | Check |
| Copy part | Copy part | Done |

## Thicken and Enclose (`src/features/surface.ts`) — thicken.htm, enclose.htm

Both live in surface.ts today; move each to its own file.

| Onshape control | Ours | Status |
| --- | --- | --- |
| Thicken: New / Add / Remove / Intersect; faces and surfaces; Mid plane; Thickness 1 / 2 + flip; Keep tools; Merge scope | Thickness, Sides, Operation | Rework to the reference layout |
| Enclose: New / Add / Remove / Intersect; Entities (surfaces, faces, planes, parts); Keep tools; Merge scope | Boundary fill | Rework to the reference layout |

## External thread (`src/features/thread.ts`) — https://cad.onshape.com/help/Content/PartStudio/external_thread.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Cylinder edges (same size) | Cylindrical face box | Different: edges |
| Standard ANSI / ISO, Size (auto from diameter), Threads per inch / Pitch | Standard, Designation, Class | Partial: auto size, pitch field |
| End type Blind / Up to next, Length | Length (blank = whole face) | Partial |
| Add chamfer (distance, angle), Add undercut (diameter, length), Split face | — | Open |

## Extrude (`src/features/extrude.ts`) — https://cad.onshape.com/help/Content/extrude.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin; New / Add / Remove / Intersect | Same | Done |
| Faces and sketch regions | Same | Done |
| End type Blind / Up to next / face / part / vertex / Through all, flip | Same | Done |
| Offset (up-to types) + distance | End offset | Done |
| Direction (axis or mate connector) | Direction subsection | Done (axis, line, edge) |
| Starting offset: Blind distance / Entity (part, face, mate connector), flip | Starting offset | Check entity picks |
| Symmetric (Blind, Through all) | Symmetric | Done |
| Draft angle + flip | Draft | Done |
| Second end position: own end type, depth, draft | Same | Done |
| Merge scope / Merge with all | Merge scope mode + parts | Done |
| Thin: Mid plane, Thickness 1 / 2, flip | Thin options | Done |

## Draft (`src/features/draft.ts`) — https://cad.onshape.com/help/Content/draft.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Neutral plane / Parting line tabs | Neutral plane only | Open: parting line mode |
| Neutral plane (face or mate connector) | Neutral plane | Check: face pick box |
| Entities to draft | Faces | Check |
| Draft angle + arrow manipulator, flip | Angle | Check: handle, flip |
| Tangent propagation | — | Open |
| Reapply fillets | — | Open (kernel) |
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

One rule, no modes: the select tool resolves by proximity to the hit point — a vertex within
6 px, else an edge within 12 px (distance to the engine's sampled polyline), else the face under
the pointer. Hovered and selected edges draw an outline; a face lights up only when the pointer
is on the face. The Selection Priority and the body / face / edge / vertex Selection Filters are
deleted (tools, commands, palette entries, help, store action). Component remains for
assemblies. Open: snapping to vertices and anchor points in sketch-on-face flows; the reported
slowdown while hovering and reselecting over time — the region-pick gate now times a hover
sweep twice and fails if the second pass is 3× slower, so a regression shows in the fixture.
