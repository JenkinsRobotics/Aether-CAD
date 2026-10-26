# SolidCraft tool review — what its tools do that ours do not (2026-10-21)

This is the historical review of SolidCraft 0.16.2. That snapshot's ZIP, archive
and scratch extraction were removed on 2026-10-25 at Jonathan's request.
The current reference is **0.23.0** in `reference/solidcraft-main/`; use it for
new comparisons. Findings below are not automatically claims of parity with
that newer version. This review read the old command registry
(`crates/engine/src/cmd/*.rs`, the `.params(...)`
strings are its contract), `docs/features.md`, `docs/face-attachments.md`, `docs/capabilities.md`,
`ROADMAP.md` and the egui Create Sketch dialog. Ours is read from `src/tools/*.ts` (the ribbon),
`aether-engine/src/document/*.ts` (the feature records) and `src/sketch-workspace.ts`,
`src/main.ts`, `src/viewer.ts` (the pick flow). The engine benchmark is settled (design doc r18);
this is about the *tool logic* on top of the engine: what each tool accepts, how it picks, how it
repairs. FreeCAD's tool logic is the next pass.

Legend: **parity** = we do what it does; **gap** = it does something we cannot; **ours+** = we do
more. "Placeholder" = a ribbon button with no action (`tool(..., undefined, solidProducer)`).

## 1. Sketch on a face, and the sketch plane in general

| Aspect | SolidCraft (`sketch.create`, `sketch.redefine`) | Ours | Verdict |
|---|---|---|---|
| Plane sources | `XY\|XZ\|YZ`, a construction plane by name or id, an explicit `{origin, x_dir, y_dir}`, a face `{face:[x,y,z], body, index, path, fixed?}` | Principal planes, plane features, a picked planar face | gap: no explicit frame for agents; otherwise parity |
| Offset from the plane | `offset: expr` (along the unflipped normal) | `offsetMillimeters` | parity |
| Flip | `flip: true\|"x"\|"y"` (half turn about the plane's own axis; reverses the normal and the default extrude direction) | none | **gap** |
| Project the face outline | `project_edges?: bool` at creation; the projected boundary is live (follows the face) | manual Project tool inside the sketch; `projection` profiles follow their source | gap at creation, parity afterwards |
| Face identity | Construction certificates first (box faces; extrude caps named by the profile's curve ids, thin-wall caps by the curves they follow; straight sketch sides; STEP faces by payload digest + entity), then kernel lineage names (`F5:top`, `F7:blend:…`, pattern copies `F4:top@F6.2`, pieces qualified by neighbours), sheet panels by name | Source feature of the body (`sourceFeatureForBody`), the face normal, and when several coplanar faces exist an anchor of (centre, area); solid vertices carry a 64-hex signature | gap: our anchor is geometric (centre+area), theirs is topological (which curves made the cap). An edit that moves or resizes the face loses ours; theirs survives until the cap's curve set changes |
| Ambiguous or uncertified face | Refuses with the reason; the dialog offers **Use fixed plane** (`fixed:true`, freezes the current plane, no following) | Refuses: "This face cannot be distinguished from the other planar faces" / "Select a face on an earlier body" / "Select a flat face first"; no fallback | **gap**: the user is stuck instead of offered a fixed plane |
| Lost attachment after an edit | Reported by name ("the top cap of Extrude1 on Body1"); the saved plane is a visible repair guide only; **Redefine Sketch Plane** rebinds with a reviewable draft, keeps geometry, ids and dimensions; a nearby face is never used automatically | `supportIssue` shown in the sketch window; the rebuild throws "support plane was not resolved. Reselect a planar face"; reselection happens by reopening the sketch | partial: we have the message, not a Redefine command with a draft |
| Cap identity after the profile is edited | Falls back to the cap of the same extrude, same end, same sketch whose outline shares at least half the stored curves; warns until redefined | no equivalent (centre+area anchor) | gap |
| Face picking in the viewport | Selection carries the world body, face index, occurrence path and a point in the face | `cadSelection` item (part, face id) → `selectedSketchFrame()` + `selectedFaceAnchor()` | parity in principle; **the live app currently refuses the top face of a fresh extrusion (bug under reproduction, see §6)** |

What to take from it, in order:

1. **Fixed-plane fallback.** When the face cannot be attached durably, offer "Use fixed plane" in
   the sketch window: a `profile` with `frame` set and no `support`. Our document already allows
   that shape (a datum-plane sketch is exactly that), so this is UI only.
2. **Flip.** Add `flip?: boolean` to `ProfileFeature` (half turn about the frame's x axis), read
   by `principalFrame`/`constructionPlaneFrame` consumers and the extrude default direction.
3. **Redefine sketch plane.** A command on an existing profile that opens the plane chooser, keeps
   the drawing, and replaces `plane/frame/support` in one undo step. The automation side should
   accept the same (`sketch-edit` with a `plane` argument).
4. **Stronger face certificate.** Store, with the support, which feature's cap/side it is and the
   contour ids that bound it (we already have `profileContourIds` and stable contour ids on the
   extrude), and resolve by that first, by (centre, area) second. This is the one that makes
   face sketches survive a resized plate.
5. `project_edges` at creation: one checkbox that inserts a `projection` of the picked face's
   outline as construction geometry.

## 2. Construction geometry

| SolidCraft (`construct.*`) | Ours (Solid › Construction) |
|---|---|
| Planes: offset, at angle, midplane, three points, **tangent** (to a cylinder/cone/sphere/torus at a point), **along path** (square to a curve at *t*), **perpendicular** (holds a line, square to a plane), **two edges** | Planes: offset, at angle, midplane, three points (`PlaneDefinition`) |
| Axes: through edge, normal to face through a point, through two planes, through two points, through a cylinder/cone/torus | none as features (`AxisReference` exists only inside the angle-plane definition) |
| Points: at vertex, two edges, three planes, centre of circle/sphere/torus, edge∩plane, along path | none as features (`PointReference` only inside the three-point plane) |
| References: `{face|edge|vertex|point: [x,y,z]}`, `{plane: …}`, `{axis: …}`, `{sketch, point|curve}`, picked faces and edges stored by persistent name | References: principal, plane feature, face (part+face id+frame), point/axis candidates (part+candidate id) |

Gaps: four plane methods, every axis and point feature. Axes matter beyond construction: the
revolve axis and the pattern axis are `X|Y|Z` in our records (§3) because there is no axis feature
to point at. Recommended order: axis feature (edge, two points, cylinder) → revolve/pattern take an
axis reference → tangent and perpendicular planes → points.

## 3. Solid tools, one by one

| Tool | SolidCraft contract (from `.params`) | Ours (feature record) | Verdict |
|---|---|---|---|
| Extrude | distance or through_all; taper; profiles by index, by curve set, by point; a planar body face or coplanar faces as the profile; operation; targets | distance; end type blind / symmetric / through-all / symmetric-through; direction vector or sketch-line reference; thin; end to face / vertex with offset; start reference + offset; second end; draft angle; reversed; operation; targets; scope "all" | **ours+** on ends; parity on profiles (we pick regions by contour ids too); gap: extrude a face without a sketch is Push/Pull here, fine |
| Revolve | axis: sketch line, sketch x/y, world X/Y/Z; angle, angle2, symmetric; **to object** (face/vertex/point); face as profile | axis X/Y/Z only; angle, second angle, symmetric, reversed; operation | gap: sketch-line axis, to-object, face as profile |
| Sweep | profile + path; orientation perpendicular / parallel / fixed vector; **twist**; **scale**; **guide rails** | profile + path | gap: orientation, twist, scale, rails |
| Loft | 2–50 sections, an apex point as a section, 1–2 guide rails, rail fit | sections, ruled | gap: apex, rails |
| Box / Cylinder / Sphere / Torus | size; corner/centre/base; axis; operation; targets | `create-box/cylinder/cone/sphere/torus` commands (ours adds Cone) | parity for primitives; check that ours record operation and placement the same way (not verified here) |
| Fillet | edges picked individually (point on edge or body+index), tangent chains, radius per edge; types constant / curvature (G2) / chord / variable / spline | one radius; edges chosen by **plane pin** (`edgePlane`: every edge in that plane) | **gap**: no individual edge pick, no chains, no variable radius |
| Chamfer | edges as above; distance; distance2 or angle; flip | one distance; plane pin | **gap**: two distances / angle, individual edges |
| Shell | faces to remove by point or name; thickness; direction inside / outside / both; tangent chain | thickness; removed faces by plane pin or face reference | gap: direction, tangent chain |
| Draft | faces; angle; neutral plane; pull direction | face plane; neutral plane; angle; reversed | gap: individual faces, pull direction |
| Hole | position: a point on a face (follows expressions), sketch points (one hole each), or the whole sketch; flip; single; direction | a sketch's circles; diameter; blind / through-all; plain / counterbore / countersink | gap: hole at a picked face point without a sketch; flip; direction |
| Rectangular pattern | features, bodies or components; dir1/dir2 vectors; counts; spacings; alignment; reversed | one direction X/Y/Z; count; spacing; reversed; features only | gap: second direction, arbitrary direction, bodies, alignment |
| Circular pattern | axis X/Y/Z or origin+dir; count; angle; alignment; reversed | axis X/Y/Z; count; angle; reversed | gap: arbitrary axis |
| Pattern on path | features/bodies along sketch curves; spacing or distance; orientation | none | gap |
| Mirror | features or bodies; plane: principal, construction plane, `{origin, normal}` or frame; combine | one feature; principal plane + offset; operation add/cut | gap: mirror bodies, mirror about a construction plane or face |
| Combine (Boolean) | target, tools, join/cut/intersect, keep tools, new component | union/cut/intersection, keep tools | parity |
| Move / Copy | translate, rotate about axis, copy | translate / rotate / scale / copy (`transform`) | parity |
| Scale | factor or per-axis factors; origin | uniform and per-axis (extended kernel) | parity |
| Offset face | faces by point or name; distance | faces; distance or free transform (Move faces) | ours+ |
| Press Pull | face + distance, or edges + distance (= fillet) | Push/Pull on one planar face | parity on faces; edges route absent |
| Split body / Split face | by plane, by a face's surface, by a sketch line | placeholder | gap |
| Replace face / Delete face | faces → plane or parallel face; delete | placeholders | gap |
| Thread | cosmetic or modelled ISO metric on a cylindrical face | placeholder | gap |
| Rib / Web / Emboss / Pipe / Coil / Boundary fill / Bounding solid / Align | present | none | gap (Rib, Pipe and Emboss are the ones users reach for) |

The one structural difference that drives most of the gaps: SolidCraft picks **individual faces
and edges** (by a world point or a persistent name) for fillet, chamfer, shell, draft and hole;
our edge-finish and shell records pin a **plane** and take every edge or face in it. That was
the FreeCAD-port shape (`_edges_in_plane`). An `EdgeReference` (source feature + the two face
signatures it lies between, or our vertex-signature pair) plus per-edge radius would close fillet,
chamfer and shell at once.

## 4. Sketch tools

SolidCraft registers 103 sketch commands, ours 43 ribbon tools. The differences that matter:

- **Circles and arcs**: they add 2-tangent and 3-tangent circles; we have centre, 3-point.
- **Rectangles**: rounded rectangle; our Aligned rectangle covers their 3-point.
- **Slots**: five variants (centre-point, centre-to-centre, overall, arc centre, arc 3-point); we have one Slot.
- **Polygon by edge** (we have inscribed and circumscribed).
- **Splines**: control-point degree 3 and 5, fit-point; ours: cubic Bézier, fit-point, insert point.
- **Modify**: Break, Scale, Intersect, Intersection curve, Isoparametric curve, Project to surface, Include 3D geometry, Loose ends (find and tie), Infinite line, Centerline, Blend curve. Ours: Trim, Extend, Split, Offset, Fillet, Chamfer, Transform, Project.
- **Constraints**: AutoConstrain (and from datum, and on finish); driven-dimension toggle; dimension-text move. Ours: constraint editor, unfix, variables.
- **3D sketch** (line3d, point3d, spline3d) — none here.
- **Insert**: DXF and SVG (ours DXF; our Vector tools cover SVG-like editing in-sketch).
- Ours only: Vector tools, Elliptical arc, Conic (theirs too), Text (both).

Nothing here blocks a part; the slot variants, tangent circles, AutoConstrain and Scale are the
ones a Fusion user reaches for first.

## 5. Agent and test surface

- SolidCraft: one registry; the toolbar, scripts, CLI, control channel and MCP run the same
  command with the same JSON, each with a self-describing `params` string. Ours: the ribbon runs
  commands through `cadCommands`, agents through `src/automation/live-commands.ts`; coverage is
  not one-to-one yet (the contributor contract calls for it).
- SolidCraft's **action matrix** tries every ordinary action on every face, edge, vertex and body
  of a corpus and ratchets a baseline. We have the oracle (125 fixtures), the Scifirobot tip-by-tip
  proof and two UI harnesses; nothing that sweeps *picks*. The face-sketch bug in §6 is exactly
  the class an action matrix catches. Recommended: a vitest sweep that, for each body of each
  example document, tries "sketch on this face", "fillet this edge", "shell removing this face" and
  records pass/refuse, with a committed baseline.

## 6. Reported: sketch on the top face of Part 1 is refused (2026-10-21)

Reproduced against the r23 build with a Playwright harness
(`../AetherStudio/.verification/cad-sketch-face-repro/`, first run compiles the Rust test
server, about nine minutes; reruns take two). A plate (rectangle on Top Plane, extruded 12 mm),
then Sketch and a click on the plate in the viewport:

| Scenario | Result |
|---|---|
| S0 Sketch, click the top face / the front wall | sketch opens on "Face of Extrude 2" |
| S1 face selected first, then Sketch | sketch opens on that face at once |
| S2 Extrude opened and cancelled, then Sketch, click top face | opens on the face |
| S3 **sketch already started on Top Plane**, click the top face | nothing: the click is forwarded to the open sketch |
| S4 after a fillet, Sketch, click top face | opens on "Face of Fillet 3" |
| unit (`src/modeling/sketch-on-face.test.ts`) | frame, anchor and source feature all resolve for the plate |

So the pick path works when the sketch is still asking for a plane. The failing state is S3: once
a sketch has a plane (a plane row clicked in the tree, or a datum selected before pressing Sketch),
the viewport belongs to the sketch and a face click cannot move it. That is SolidCraft's
**Redefine Sketch Plane**, which we lack (§1). Also: while choosing a plane nothing highlights on
hover, so a user has no sign that faces are pickable.

## 7. Order of work

1. Fix §6 and add the face-sketch step to the tools harness.
2. §1 items 1–3 (fixed plane, flip, redefine) — small, UI and document only.
3. Individual edge/face references for fillet, chamfer, shell, draft; chamfer distance2/angle;
   variable fillet.
4. Axis feature; revolve and pattern take an axis reference; arbitrary pattern directions and a
   second direction; mirror about a plane feature or face; mirror bodies.
5. Tangent, perpendicular, along-path and two-edge planes; point features.
6. Sweep orientation/twist/scale/rails; loft apex and rails; revolve to-object.
7. Split body/face, replace face, delete face, thread, rib, pipe, emboss.
8. Sketch: slot variants, tangent circles, AutoConstrain, Scale.
9. Pick sweep test (action matrix) with a committed baseline.
10. Then the same review against FreeCAD's PartDesign tool logic.
