# Onshape feature parity — control by control

Each feature's window must carry the controls of Onshape's (Jonathan, 2026-11-02), checked
against Onshape's help pages, not memory. One table per feature; a row is Done when the
window, the document record, the kernel and the agent path (`feature_add` / `feature_update`
on the same record) all carry it. Kernel gaps name the capability OCCT lacks today.

Source pages: https://cad.onshape.com/help/Content/fillet.htm,
https://cad.onshape.com/help/Content/chamfer.htm

## Tapered shoulder picking — 2026-11-04

The cylindrical shoulder qualification did not cover the user's two adjoining
conical faces. The compact OCCT binding exposes `BRepAdaptor_Surface.Cone()` but
cannot return its unbound `gp_Cone`; topology extraction caught that error by
replacing the entire face with `UNAVAILABLE`, removing its edges from selection.
The cone frame now comes from exact surface derivatives (no mesh fitting), and
failure of optional analytic inference no longer discards measured faces or
independently available boundary edges. Cone-axis stations remain available.

A native regression fails before this repair and passes after it. Fillet and
Chamfer resolve the shared circular edge from either tapered face and preserve
it through saved rebuild. The browser check additionally uses a read-only copy
of the saved Test hybrid / Part 1 sketch and quarter-revolve, selects the marked
shoulder from both faces, changes its shared size handle, applies, reopens and
reselects the source edge while editing. The live document is not changed.
Release evidence is recorded separately in
`../reality/data/Conical_Shoulder_2026_11_04.json`; this does not close the broader
Extrude/Revolve/Chamfer/Fillet parity requirements below.

## Gaps closed — 2026-11-04 (alpha-0.1.100, continued in alpha-0.1.103; 0.1.101 and 0.1.102 were the Extrude qualification releases of the other session)

Every row below went through the same validated record (`feature_add` / `feature_update`), the
kernel and the window, with a closed-form engine check in
`aether-engine/src/kernel/parity-gaps.test.ts` and a window check in `src/features/parity.dom.test.jsx`.

| Feature | Closed | Still a named gap |
| --- | --- | --- |
| Thicken | Thickness 2 (the other side's own amount), Keep tools (off consumes the sheets; older records keep them) | — |
| Boolean | Subtract Offset all with its distance and flip (`BRepOffsetAPI_MakeOffsetShape`, rounded joins) | Faces to offset, Reapply fillet |
| Transform | Translate by distance (a direction line and a typed distance, flip) | Mate connectors |
| Pattern | Skip instances (instance numbers), Add / Remove / Intersect for part patterns, direction by a planar face, a tree plane, a Plane feature or a sketch line, axis by a cylindrical or conical face | Face pattern, Reapply features, mate connectors |
| Mirror | Part mirror (New with new identities; Add / Remove / Intersect into the merge scope), New and Intersect for feature mirrors | Face mirror, Reapply features |
| Split | A picked cylindrical, conical, spherical or toroidal face by its whole surface; any face (a surface body's face too) trimmed to its boundary with the general fuse (keeps both sides, exactly two pieces); Keep tools consumes a surface tool | — |
| Hole | Up to next (through the first wall), Up to entity (a stopping face), Start from part, Start from a selected plane; Straight pipe tap (BSP parallel) and Tapered pipe tap (NPT with its 1°47' taper); sketch points clicked in the viewport (the finished sketch's vertices and circle centres, within 8 px) for the holes box and every Up-to-vertex point picker | PEM fasteners |
| Revolve | Offset for the Up-to ends (the stop grown by the distance; along a vertex's arc) | Automatic merge scope default on new revolves (the window still offers it) |
| Sweep | Path Opposite direction (the curves rebuilt reversed; where the scale and twist laws start), Thin (walls around one closed curve, mid plane), Twist by turns, angle or pitch with its direction (an auxiliary spine wound round the path), Lock profile faces (OCCT's spine-support trihedron on a picked face the path lies on) | Trim ends |
| Draft | Parting line draft: pull direction plane, parting edges, One sided / Symmetric / Two sided with a second angle, flip; Tangent propagation is always on (OCCT keeps tangent faces tangent) | Reapply fillets |
| Loft | Path (OCCT's pipe shell through every section), Connections (one sketch vertex per section re-chains each boundary; OCCT's reordering off) | Start / End profile conditions, Guides, Show isocurves |
| Fillet | Points on the edge: a (position, radius) law, the same on every picked edge, from the size to the end radius | Conic / Curvature control, Asymmetric, Partial (tried: OCCT re-chains the split edge's tangent half and fillets the whole edge), Smooth transition, edges to keep, Smooth corners |
| External thread | Add chamfer (distance and angle on the start rim), Add undercut (diameter and length at the thread's end), Split face at the thread's end, Size from the cylinder's diameter (the face pick now carries its radius) | Cylinder edges as the pick (the face stands for them) |
| Rib | New feature: open curves of one sketch, Parts, Thickness, Normal to sketch plane (Extrude's centred thin wall up to the part) and Parallel to sketch plane (a band the thickness tall across the plane, filled square to the curve's chord up to the part), with the flip; merged | Draft angle, Extend profiles to part, Merge ribs off |
| Enclose | The window follows Onshape's (New / Add / Remove / Intersect, Entities, Keep tools, Merge scope), named Enclose in the ribbon | Finding the enclosed region without a point in each cell (`BOPAlgo_MakerVolume` is not in the wasm build) |

Kernel fixes on the way: the circle shortcut in `sketchWire` deleted the stored sketch plane's
normal (any later feature on a circle sketch failed with "This object has been deleted"); the
coaxial split uses the fuzzy boolean because the exact one throws on coincident cylinders.

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
| Extrude | Native handles use the resolved direction and starting offset; both symmetric ends share total depth; independent second ends keep their own value. Stop-bound ends do not show a depth control that has no effect. Starting offset uses the shared value control. Oblique extrusion and explicit-unit secondary-depth edits survive saved reopen. Native Thin plus Draft now has analytic coverage, compact shared draft rings and wall-thickness handles. | Surface mode integration; oblique draft and the remaining drafted stopping-limit combinations; complete reference-control coverage. |
| Revolve | Orbit ribbon follows the actual angle. Angular keyboard edits produce a valid native preview; cancel restores the document. Shared readout accepts complete unit expressions. | Every extent/axis/Thin combination and remaining offset controls. |
| Chamfer | A native quarter-revolved stepped shaft's circular shoulder can be selected, changed with the shared size handle, applied, reselected while editing earlier history, and saved with the exact curved-edge reference. | Second-distance and angle handles, all direction/measurement combinations and general geometry coverage. |
| Fillet | The same shoulder fixture passes selection, radius manipulation, native preview, apply, history reselection and save. | Partial/asymmetric/conic/curvature controls, shared controls for variable-radius points, overflow/corners, and general full-round geometry remain incomplete. |

History preview previously ignored mixed edge/face picking and returned a face.
It now uses the main viewport's selection rule. The browser gate checks the saved
shoulder midpoint is at z=10 mm, rather than accepting the visually overlapping
upper rim at z=25 mm. The fixture is an editable sketch and Revolve, with actual
Chamfer/Fillet features; it contains no imported solids.

The shared Section widget also passes the native robot cutaway on WebGPU and WebKit, with default-plane and face-first cuts, flip, cancel and no document writes.

Qualification evidence: [native and browser checks](../reality/data/Feature_Controls_2026_11_04.json). The actual modeling browser gate also passes sketch creation, Extrude New/Add/Remove/Intersect, Revolve, Fillet, Shell, Mirror, Pattern, Boolean, Hole, surfaces, sheet metal and 3D Sketch, with no server geometry requests.

References reviewed: [Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)
and [Fillet](https://cad.onshape.com/help/Content/PartStudio/fillet.htm). Onshape's
second-end draft controls and partial/variable fillet controls remain explicit
requirements, not optional cosmetic additions.

## Extrude release blockers — 2026-11-04

The shared-control/selection repair first shipped in CAD **alpha-0.1.99** and
UI gallery **alpha-0.1.36** (shared package alpha.275). The combined alpha-0.1.100
source included Thin + Draft, but its installed build still rejected that operation.
The complete combined source has now been rebuilt and qualified as a matching
frontend/worker pair: 2,180 frontend tests (one skipped), 1,275 engine tests,
320 native-service tests, both Home routes, shared-control workflows and all
17 modeling browser steps pass. See the Thin and Draft evidence below.
That update does **not** sign off the entire Extrude feature. Continue this
feature before granting release-ready status to Revolve, Chamfer or Fillet.

| Reference control | Current implementation | Qualification still required |
| --- | --- | --- |
| Solid / Surface / Thin | Solid and Thin in Extrude; separate native Surface Extrude operation; unified Surface tab disabled | Integrate the Surface workflow and qualify its complete extent/operation matrix. |
| New / Add / Remove / Intersect | Native body operations and explicit/all merge scopes | Selected multi-body scope, disjoint regions and failure recovery across the full extent matrix. |
| Sketch regions and planar faces | Shared native profile and planar-face selection | Multiple-source and ambiguous/upstream-changed references must be checked explicitly. |
| Blind / Symmetric / Second end | Native extents with correct shared primary/opposite handles, including resolved oblique direction and starting offset | Remaining combinations with Thin, Draft and selected scopes. |
| Up to next / face / part / vertex / Through all | Native stopping operations and validation | Drafted next/part, tilted/curved termination cases and their complete selection matrix; shared end-offset handles are implemented. |
| Direction | Sketch normal, sketch-line reference and manual unit vector | Additional axis/mate-connector selection parity; drafted oblique direction is currently refused. |
| Starting offset / entity | Blind signed offset or parallel principal/feature/face reference; shared linear offset handle | Complete reference changes, reverse/second-end combinations and interactive cancellation coverage. |
| Draft / opposite draft | Native taper for solid regions and closed/open thin walls; shared compact angle rings, separate end angles and fine keyboard adjustment | Oblique draft and drafted next/part/tilted/curved stops remain open; parallel-face draft is qualified below. |
| Thin thickness 1/2, Mid plane, Flip wall | Native closed/open curve walls with shared thickness arrows, including mid-plane scaling, zero thickness on one side and reversal | Complex contour/termination coverage and the remaining draft combinations. |
| Live preview / accept / cancel / reopen | Actual native mesh checks for oblique two-ended extrusion; unit-aware readout; saved reopen | Full matrix above must verify resulting geometry, editable history and identical UI/agent behavior. |

This inventory distinguishes an exposed control from a qualified operation.
Unsupported combinations must retain explicit validation until a native
implementation and geometry-level regression are present. A disabled tab or
an error message is not completion of its reference requirement.

### Extrude Thin and Draft — additional qualification

Thin walls now supply their real outer and inner boundaries to the existing
native taper operation. Closed rectangular and circular walls and an open
straight wall match independently integrated analytic volumes, including saved
reopen, starting offset, symmetric and independent ends, and invalid-collapse
refusal. This preserves editable Sketch/Extrude history and saved formats.

Draft uses the shared projected orbit at the neutral profile boundary, with a
compact screen radius and 1°/0.1° keyboard steps. Thickness uses the same linear
control as other feature values; Mid plane shows total wall thickness while
moving one side by half. Offset/draft and Flip wall change the actual native
control frame. One wall side may be zero; a negative thickness is refused.

The actual editor changes draft and both thicknesses, compares the rendered
top edge with the analytic taper, saves and reopens the same values. This
closes those specific blockers, not the full Extrude parity checklist above.
Evidence: [Thin and Draft qualification](../reality/data/Extrude_Thin_Draft_2026_11_04.json).


### Extrude stopping controls — additional qualification

**Activation held; CAD alpha-0.1.101 remains active.** The first broad modeling
browser run failed after adding Surface Extrude: the earlier Hole reported
“Cut removes no material.” Two repeat runs passed all 17 steps, and the saved
model plus transient preview sequence rebuilds headlessly. The cause remains
unresolved; passing retries are not a fix or release qualification.

Parallel planar Up-to-face stops now use the same native drafted solid builder
as blind extrusion. Solid and Thin, narrowing/widening, reverse, starting offset,
end offset and independent opposite-end draft have analytic volume and saved
reopen checks. Tilted/curved drafted stops and drafted Up-to-next/part still
refuse explicitly; this does not sign off those combinations.

All four stopping modes now publish shared signed end-offset handles. Face and
point handles follow the native reference; Next/Part handles come from actual
terminal contact, excluding an unrelated far face. Each end has its own value.
A positive offset stops short, and a negative one extends beyond the limit.
The actual editor changes the value through the shared manipulator, checks the
native extent, cancels an edit, and saves/reopens the feature. Agent operations
use the same Draft/Up-to-face/offset implementation and saved document.

Evidence: [stopping controls](../reality/data/Extrude_Stopping_Controls_2026_11_04.json).

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
| Variable fillet: per-vertex radii, points on edge, smooth transition | Variable fillet sub-setting: End radius, Add point on edge (position 0…1 and radius rows; one law on every picked edge); Smooth transition disabled with the gap named | Done (alpha-0.1.100); smooth transition is a kernel gap |
| Allow edge overflow (default on) + edges to keep | Allow edge overflow sub-setting, checked and disabled (always on here) with the Edges to keep box disabled | Kernel gap: keep-edge control |
| Smooth fillet corners + corners to exclude | Smooth fillet corners sub-setting with Corners to exclude, disabled with the gap named | Kernel gap: vertex blends |

Fillet and Chamfer have no Target body box (Onshape names none): the body is the picked entities' body.
Every disabled control names its kernel gap in its tooltip (alpha-0.1.98).

## Chamfer (`src/features/chamfer.ts`)

| Onshape control | Ours | Status |
| --- | --- | --- |
| Entities: edges or faces | Entities to chamfer, faces expand to their edges | Done (alpha-0.1.91) |
| Measurement: Offset / Tangent | Measurement: Offset / Tangent distance (equal distance only). Onshape's Tangent measures from the intersection of the adjacent faces' tangents (identical to Offset on planar faces); ours measures the width across the chamfer face, which is the same on planar faces too. | Partial: Tangent for the two-distance and angle types |
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
| Offset (Subtract): Offset all, Faces to offset, distance, flip, Reapply fillet | Offset sub-setting: Offset all with the distance and flip grows the tools before the cut; Faces to offset and Reapply fillet disabled with the gap named | Done for Offset all (alpha-0.1.100) |
| Surfaces as tools | — | Open |

## Mirror (`src/features/mirror.ts`) — https://cad.onshape.com/help/Content/mirror.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Feature / Face mirror | Part / Feature / Face tabs; parts picked into the box; Face disabled with the gap named | Done for parts and features (alpha-0.1.100) |
| New / Add / Remove / Intersect | New / Add / Remove / Intersect tabs, all four real | Done (alpha-0.1.100) |
| Entities to mirror | Features to mirror | Done (features) |
| Mirror plane: planar face, standard plane, Plane feature, mate connector | Plane box: tree plane, Plane feature, face | Done (no mate connectors) |
| Reapply features | Reapply features row, disabled with the gap named | Kernel gap |
| Merge scope / Merge with all | Merge with all, or the target plus additional parts (Extrude's scope, now shared by Revolve); a new revolve starts with the explicit target because the automatic scope's overlap test refused the region-pick gate's edge-touching revolve | Done (alpha-0.1.98); automatic scope on revolves open |

## Split (`src/features/split.ts`) — https://cad.onshape.com/help/Content/PartStudio/split.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Face tabs | Part / Face switch as the window's first row, opening the Face split feature | Done |
| Parts to split (parts, surfaces, curves) | Part to split (one part) | Partial: one part |
| Entity to split with: plane, cylinder, mate connector, surface, face | Plane box: tree plane, Plane feature, any face (planar through its plane; cylinder, cone, sphere, torus by the whole surface; any face trimmed to its boundary), sketch line | Done (alpha-0.1.100); mate connectors open |
| Keep tools, Trim to face boundaries | Keep tools (off consumes a surface tool), Trim to face boundaries (general fuse, keeps both sides) | Done (alpha-0.1.100) |
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
| Angle offset; Offset distance + flip | Offset sub-setting (distance, flip) for the Up-to ends: the stop grown by the distance, or a vertex's arc shortened | Done (alpha-0.1.100) |
| Second end position | Same controls as the first end | Done (alpha-0.1.90) |
| Thin: Mid plane, Thickness 1/2, flip | Thin options | Check against sweep/thin module |
| Merge scope / Merge with all | Target body | Partial |

## Sweep (`src/features/sweep.ts`) — https://cad.onshape.com/help/Content/sweep.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Solid / Surface / Thin, operations | Tabs | Done |
| Faces and sketch regions to sweep | Same | Done |
| Sweep path + opposite direction arrow | Sweep path box with the Opposite direction button (the path rebuilt reversed: where the laws start) | Done (alpha-0.1.100) |
| Profile control: None / Keep profile orientation / Lock profile faces / Lock profile direction | Profile control picker with all four; Lock profile faces takes the face the path lies on (Faces to lock to); Lock profile direction takes the up direction | Done (alpha-0.1.103) |
| Twist: Turns / Angle / Pitch, opposite, extend | Twist by Turns, Angle or Pitch with Opposite direction (an auxiliary spine wound round the path) | Done (alpha-0.1.103); extend open |
| Scale: scale factor | End scale | Done |
| Thin: Mid plane, thickness, Trim ends | Thin tab with Mid plane, Thickness 1 / 2 and the flip, for one closed or open curve (an open curve's wall is capped in its plane, as Extrude's); Trim ends disabled with the gap named | Done (alpha-0.1.103); trim ends open |
| Merge scope | Merge scope box (one part) | Partial: one part |

## Loft (`src/features/loft.ts`) — https://cad.onshape.com/help/Content/loft.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Profiles, reorder | Sections | Partial: reorder |
| Start/End profile condition: Normal, Tangent, Match tangent, Match curvature | Start and End profile condition rows, disabled with the gap named | Kernel gap: loft constraints |
| Guides and continuity, Trim guides, Trim profiles | Guides and continuity sub-setting, disabled with the gap named | Kernel gap |
| Path + section count | Path sub-setting with the path sketch (OCCT's pipe shell through the sections) | Done (alpha-0.1.100); section count open |
| Connections (vertex pairs) | Connections: one sketch vertex per section, in order (several sets allowed) | Done (alpha-0.1.100) |
| Show isocurves | Show isocurves row, disabled with the gap named | Gap: isocurve overlay |
| Thin, Merge scope | Thin tab disabled (gap); Merge scope box (one part) | Partial |

## Hole (`src/features/hole.ts`) — https://cad.onshape.com/help/Content/hole.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Inch / Metric | Metric / Inch tabs choose the standard family (ISO metric or UNC/UNF) | Done (alpha-0.1.98) |
| Simple / Counterbore / Countersink | Simple / Counterbore / Countersink tabs (a saved counterdrill keeps a fourth) | Done (alpha-0.1.98) |
| Sketch points to place holes (+ implicit mate connectors) | Sketch points to place holes: clicked in the viewport, from the list, or every point of a sketch picked in the tree; one hole per point, square to its sketch | Done (alpha-0.1.103); mate connectors open |
| Merge scope | Merge scope box (one part) | Partial: one part |
| Hole type: Drilled / Clearance / Tapped / PEM, with Standard, Size, fit, threads/inch, class | Hole type picker with all four; Standard, Size, Fastener fit, Thread class; Straight pipe tap (BSP parallel) and Tapered pipe tap (NPT, 1°47' taper); PEM refuses with the gap named | Partial: PEM |
| Diameter | Diameter | Done |
| Start plane: part / sketch plane / selected plane | Start plane picker with all three (Start from part: where the axis first meets the part; selected plane: a plane box) | Done (alpha-0.1.100) |
| Termination: Blind / Up to next / Up to entity / Through all, flip | Termination picker with all four and the flip; Up to next drills through the first wall, Up to entity stops at a picked face | Done (alpha-0.1.100) |
| Counterbore / countersink diameter and depth or angle | Counterbore diameter and depth; Countersink diameter and angle rows | Done |
| Tip angle: 118 / 135 / Flat / Custom | Tip angle style picker: 118 degrees / 135 degrees / Flat / Custom with Tip angle | Done (alpha-0.1.98) |

## Patterns (`src/features/pattern.ts`) — linearpattern.htm, circularpattern.htm, curvepattern.htm

One window today with a Pattern type select; Onshape has three tools. Split into
`linear-pattern.ts`, `circular-pattern.ts`, `curve-pattern.ts` over one pattern core.

| Onshape control | Ours | Status |
| --- | --- | --- |
| Part / Feature / Face pattern | Part / Feature / Face tabs; Face disabled with the gap named | Partial: faces |
| New / Add / Remove / Intersect | New / Add / Remove / Intersect tabs: a feature pattern repeats its feature's own result (as Onshape's); a part pattern makes new parts or adds, removes or intersects with the merge scope | Done (alpha-0.1.100) |
| Entities to pattern | Parts to pattern box + feature chips | Done (parts, features) |
| Linear: Direction (plane, face, edge, line, curve, mate connector) + flip, Distance, Instance count, Centered, Second direction, Skip instances | Direction: principal axes, a picked straight edge, a planar face, a tree plane, a Plane feature or a sketch line, with the flip; Distance, Instance count, Centered, Second direction with its own direction, flip, distance, count and Centered; Skip instances | Done (alpha-0.1.103); curves and mate connectors open |
| Circular: Axis of pattern + flip, Angle, Instance count, Equal spacing, Centered, Skip instances | Axis of pattern: principal axes, a picked straight edge, an Axis feature or a cylindrical / conical face, with the flip; Angle, Instance count, Equal spacing (off: the angle is between instances), Centered; Skip instances | Done (alpha-0.1.103); mate connectors open |
| Curve: Path, Equal spacing / Distance, Instance count, Orientation (Tangent / Normal to face / Locked + lock faces), Skip instances | Path sketch, spacing/distance, count, orientation identical/path | Partial |
| Reapply features, Merge scope | Reapply features disabled with the gap named; Merge scope box (one part) | Partial |

## Transform (`src/features/part-transform.ts`) — https://cad.onshape.com/help/Content/transform.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Entities to transform or copy | Transform part IDs (selection) | Done |
| Translate by line (line or two points) | Translate by line | Done |
| Translate by distance (direction + distance + arrow) | Translate by distance: a sketch line, edge or two points for the direction, the distance and the flip | Done (alpha-0.1.100) |
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
| Thicken: New / Add / Remove / Intersect; faces and surfaces; Mid plane, Thickness 1 / 2, flip, Keep tools, Merge scope | New / Add / Remove (Intersect disabled), Faces and surfaces to thicken, Mid plane with Thickness, else Thickness 1 with the flip and Thickness 2; Keep tools; Merge scope box | Done (alpha-0.1.100); Intersect open |
| Enclose: New / Add / Remove / Intersect; Entities (surfaces, faces, planes, parts); Keep tools; Merge scope | Enclose: the four tabs, Entities, Keep tools, Merge scope, plus a point in each region to fill | Done for the layout (alpha-0.1.100); finding the region itself is a kernel gap |

## External thread (`src/features/thread.ts`) — https://cad.onshape.com/help/Content/PartStudio/external_thread.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Cylinder edges (same size) | Cylindrical face box (one face) | Different: the face, not its edges |
| Standard ANSI / ISO, Size (auto from diameter), Threads per inch / Pitch | Standard (ISO metric, UNC/UNF, BSP, NPT), Size or "Size from the cylinder's diameter", Pitch or Threads per inch read from the size | Done (alpha-0.1.100) |
| End type Blind / Up to next, Length | End type picker Blind (Length) / Up to next | Done |
| Add chamfer (distance, angle), Add undercut (diameter, length), Split face | All three real: the chamfer on the start rim, the undercut groove at the thread's end, the face split there | Done (alpha-0.1.100) |

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
| Neutral plane / Parting line tabs | Neutral plane / Parting line tabs, both real | Done (alpha-0.1.100) |
| Neutral plane (face or mate connector) | Neutral plane box (planar face), first as Onshape's | Done (alpha-0.1.98); mate connectors open |
| Entities to draft | Entities to draft box | Done |
| Draft angle + arrow manipulator, flip | Draft angle with the flip button | Partial: handle open |
| Tangent propagation | Tangent propagation row, checked and disabled: OCCT keeps tangent faces tangent when one is drafted, so it is always on | Done (always on) |
| Reapply fillets | Reapply fillets row, disabled with the gap named | Kernel gap |
| Parting line: pull direction, parting edges, propagation, One sided / Symmetric / Two sided, flip | Pull direction (a plane or planar face), Parting entities (edges), One sided / Symmetric / Two sided with a second angle, flip | Done (alpha-0.1.100); mate connectors open |

## Body draft (reference sent 2026-11-02)

Draft scope (Parts to draft / …), Parts, Faces to exclude, Draft on self, Pull direction, Parting
entity, Angle, Symmetric, Corner type (Extend / …), Keep material. Not implemented; needs a
parting-entity draft in the kernel. Status: Open.

## Rib (`src/features/rib.ts`?) — https://cad.onshape.com/help/Content/rib.htm

| Onshape control | Ours | Status |
| --- | --- | --- |
| Sketch profiles (rib centrelines) | Sketch profiles: the open curves of one sketch (all, or ticked) | Done (alpha-0.1.100) |
| Parts | Parts box (one part) | Done |
| Thickness | Thickness, centred on the curve | Done |
| Parallel / Normal to sketch plane + flip | Rib direction picker with the flip; both build | Done (alpha-0.1.103) |
| Draft angle + flip | Present, disabled with the gap named | Kernel gap: drafted thin extrusion |
| Extend profiles to part | Present, disabled with the gap named | Gap |
| Merge ribs | Checked and disabled: ribs always merge | Done (always on) |

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
