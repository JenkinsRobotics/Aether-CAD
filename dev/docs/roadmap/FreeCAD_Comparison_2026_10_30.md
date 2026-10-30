# Aether CAD against FreeCAD 1.1.3 — review of 2026-10-30

Jonathan's direction: compare where Aether CAD stands against FreeCAD, close the gaps,
prove every shipped feature works, meet or beat FreeCAD's performance, then remove the
FreeCAD reference that remains. This document records the state on 2026-10-30 with the
evidence behind each claim. It supersedes the FreeCAD paragraphs of
`Aether_Engine_Design.md` as the current status; it does not change any decision there.

FreeCAD is **not** Aether's engine and never was a dependency of the shipped product.
Both run OpenCASCADE, which is why FreeCAD's answers were usable as an oracle. The
SolidCraft 0.23 comparison (`SolidCraft_0_23_Foundations.md`, `Tool_Parity_Tracker.md`)
continues separately; nothing below promotes a SolidCraft row.

## 1. What was verified today

| Check | Result |
| --- | --- |
| Engine oracle (`aether-engine/src/kernel/oracle`) | 125 fixtures build; 113 match captured FreeCAD volumes/face/edge counts exactly (1e-6 relative); 16 assembly poses match FreeCAD; 17 s |
| Engine unit suite (`aether-engine`) | 265 files, 1,194 tests pass |
| App unit suite | 348 files, 2,130 pass, 1 skipped |
| Typecheck (`npm run check`) | clean |
| Native three-way construction benchmark (other agent, `scripts/benchmarks/native/`, data `dev/docs/reality/data/Native_Comparison_2026_10_30.json`) | Aether vs FreeCAD 1.1.3 vs SolidCraft 0.23 on four fixtures; read and re-run in part below |
| Warm-process rebuild measurement (this review) | `BENCH_RUNS=6` on the built Aether runner, same fixtures; see §4 |

Not re-run today: the 33 Playwright browser gates (`scripts/verify-*-browser.mjs`). They
were all green on the disposable fixture host earlier this session after three script
fixes (d627c45); the code under them has since changed by two commits from the other agent
(1c8bfc8 playback/picking, 3be5c76 thumbnails) and one uncommitted evaluator timing hook.

## 2. FreeCAD 1.1.3 as the yardstick

Installed at `/Applications/FreeCAD.app` (1.1.3, revision 20260725). FreeCAD 1.1 was
released 24 March 2026 and added, among other things: transparent PartDesign feature
previews and draggers, a reworked Hole panel with taper and more thread profiles,
two-sided Pad, Sketcher projection/intersection/external geometry and "Make Internals",
Assembly part insertion, joint motion simulation and animation, an Assembly Bill of
Materials, TechDraw snapping and annotation work, a Transform tool overhaul, theme
editor, continued topological-naming mitigation, and faster startup.

Workbenches outside Aether's product scope and not compared: FEM, CAM/Path, BIM/Arch,
Draft (2D drafting), Robot, Points, Reverse Engineering, OpenSCAD, Inspection.
"n/a" below means exactly that, not a gap.

## 3. Capability comparison

Status words: **parity** (same answer, proven), **ours+** (we do more), **partial**
(present, named cases missing), **gap** (absent), **verify** (present, no FreeCAD
comparison evidence yet).

### 3.1 Kernel and document

| FreeCAD | Aether | Status | Evidence / missing |
| --- | --- | --- | --- |
| OCCT native (7.8/7.9) | OCCT as wasm: replicad single build (11 MB) + full opencascade.js (50 MB) loaded lazily for `BRepBuilderAPI_GTransform`, IGES, half-spaces | parity | oracle 113/113; the lazy build is a bundle cost, not a capability gap |
| PartDesign Body, Part containers, Links | Part documents, Hybrid containers, Assembly occurrences; Studio owns external links/PDM | parity | Links across files are Studio documents, not file paths |
| Topological naming (1.0+ mitigation) | References by face/edge geometric signature (`SolidFaceReference`, `SolidEdgeReference`, profile contour identities); broken references kept and repairable | ours+ | foundation browser gate; `feature-inputs.test.ts`; FreeCAD still breaks on some reorders |
| Recompute with dependency graph, partial recompute | Replay cache per feature with reuse from the first changed step; per-face signature cache | parity | edit of last bore on ten-bore plate 6 ms vs FreeCAD 19 ms (§4) |
| Expressions, Spreadsheet aliases, VarSets (1.1) | Document variables, expressions with functions, completion, users/graph, CSV/JSON import/export, configurations table | partial | no units on variables, no comments/favourites (tracker `parameters.*`) |
| Undo/redo, transactions | Undo/redo, atomic agent edits with revision guards, crash recovery | parity | |
| File formats: FCStd (zip of XML + BREP) | `.acpart` JSON, `.acad.bin` container; versioned migrations | n/a | no FCStd reader; not requested |

### 3.2 Sketcher

| FreeCAD | Aether | Status | Evidence / missing |
| --- | --- | --- | --- |
| Geometry: line, polyline, arc (3 kinds), circle (2), ellipse, ellipse arc, hyperbola, parabola, B-spline (control/knot), point, rectangle (4), polygon, slot, fillet/trim/extend/split | All of these plus conic (rho), arc slots, rounded rectangle, text, 3-tangent/2-tangent circles, blend curve | ours+ | tracker Sketch section: 105 SolidCraft commands, 0 gaps |
| Constraints: coincident, point-on-object, vertical, horizontal, parallel, perpendicular, tangent, equal, symmetric, block, lock, distance, h/v distance, radius, diameter, angle, Snell's law | Solver kinds: coincident, collinear, concentric, curvature, diameter, distance, equal, fix, horizontal, horizontal-distance, length, midpoint, normal, offset, parallel, perpendicular, pierce, radius, symmetric, tangent, vertical, vertical-distance, angle | parity | Snell's law absent (optics only); we add pierce, normal, curvature (G2), offset relation |
| Solver: PlaneGCS (DogLeg/LM/BFGS), conflict/redundant detection, DOF display | Own TypeScript solver; DOF and conflict reporting; PlaneGCS compiled to wasm exists as a spike (`sketch/solver/planegcs-spike.ts`) | verify | **no matched solver benchmark** (speed, convergence on hard cases); the native benchmark fixes every sketch deliberately |
| External geometry, Projection, Intersection (1.1) | Project, Include 3D edges, Intersect, Project to surface, Fit curves to section, Spun profile | partial | persistent links to model edges with source-edit tracking remain partial (`Model_Sketch_Projection.md`) |
| Carbon copy, Make Internals (1.1) | Copy/paste sketch entities with constraints; region selection | partial | no "carbon copy" of a whole sketch as linked geometry |
| B-spline editing: insert/remove knot, degree, show polygon/comb | Control-point and fit-point splines, degree-5, curvature comb analysis | partial | no knot insertion/removal or degree change on an existing spline |
| DXF/SVG import | DXF/SVG import, DXF export | parity | |

### 3.3 PartDesign and Part features

| FreeCAD | Aether | Status | Evidence / missing |
| --- | --- | --- | --- |
| Pad / Pocket: length, two lengths, two-sided (1.1), symmetric, up to face/first/last, offset, taper, reversed | Extrude: all of these, plus explicit target bodies, up-to-point, start reference, curved stopping faces (cylinder/sphere) | parity | oracle: 181 extrude features across fixtures; cone/torus/spline stopping faces refused (no half-space builder in the default wasm) |
| Revolution / Groove (angle, two angles, axis choices) | Revolve add/cut/new, axis from sketch line or world axis, two angles | parity | oracle 14 revolve fixtures |
| Additive/Subtractive Loft (ruled, closed) | Loft with apex point, rails; surface loft | parity | tracker `solid.loft` partial only on SolidCraft-specific options |
| Additive/Subtractive Pipe (orientation modes, auxiliary spine, scaling) | Sweep: perpendicular/parallel/fixed direction, end scale, guide rail; pipe feature | parity | |
| Additive/Subtractive Helix | Coil feature | verify | no FreeCAD oracle fixture for helices |
| Primitives (box, cylinder, sphere, cone, torus, prism, wedge, ellipsoid) | Primitive tools (box, cylinder, sphere, …), bounding solid, standard parts | verify | primitives build on the engine; add oracle fixtures |
| Hole: counterbore/countersink/counterdrill, threads (cosmetic/modeled), taper (1.1), profiles | Hole: face point or sketch points; counterbore/countersink/counterdrill; ISO metric coarse/fine, UNC, UNF profiles with tap-drill or clearance-fit diameters; cosmetic or modelled thread (depth, hand); drill-point angle; taper; ISO 4762 / ISO 10642 head presets | parity | closed 2026-10-30 (`hole-options.test.ts`, analytic volumes). Not offered: BSP/BSW/NPT profiles, thread class, a modelled thread on a face without a Hole; a pattern of a modelled-thread hole repeats the bore only |
| Fillet (constant), Chamfer (equal/two distances/distance-angle) | Fillet constant and variable (end radius), G2 option, chamfer all three modes, tangent chains | ours+ | oracle 6 fillet / 3 chamfer fixtures |
| Draft | Draft faces about a neutral plane | parity | oracle 2 fixtures |
| Thickness (shell) | Shell inside/outside/both, open faces by reference, tangent chains | parity | oracle 8 shell fixtures; toroidal-tunnel shell refused by both |
| Mirrored, LinearPattern, PolarPattern, MultiTransform | Mirror, pattern linear/polar of features or bodies | partial | MultiTransform (pattern of a pattern, mirror of a pattern) not confirmed as one feature; **verify** |
| Boolean (fuse/cut/common of bodies) | Boolean feature; scoped extrusion booleans | parity | oracle 2 boolean fixtures; scoped cut 10.9 ms vs 18.2 ms before (`History_Playback_Performance_2026_10_30.md`) |
| Datum plane / line / point, LCS | Construction planes/axes/points (offset, angle, through points, along path, centre of circle) | partial | plane/point along a curved path and centre of sphere/torus faces missing |
| SubShapeBinder / ShapeBinder | Model projection into sketches (independent copies) | partial | persistent binder with source tracking missing |
| Part: Offset (2D/3D), Thickness, offsetFaces, scale (Part Transform) | Offset/Move face incl. cylindrical/spherical faces and round neighbours; non-uniform scale via full build | partial | faces whose neighbours are cones, tori or splines refused (needs `BRepOffset_MakeOffset`, custom OCCT build) |
| Part: Defeaturing (delete face), Refine shape | Delete face; refine on booleans | parity | |
| Part: Section / Cross-sections | Section view (live clipping with caps) and sketch Intersect | parity | **Safari defect open** (§6) |
| Part: Check geometry, measurements | `kernel/analysis.ts` properties, measure, clearance, compare bodies, draft/curvature/accessibility/zebra display styles | ours+ | |
| Sheet metal (addon workbench) | Sheet base, flange, fold, hem, unfold/refold, perforate, bend table, flat DXF | ours+ | bends on bends and post-bend cut-outs missing in unfold |
| Surfaces (Surface workbench: fill, filling, sections, extend, blend) | Boundary, patch, loft, sweep, extend, blend, offset, trim, untrim, stitch/unstitch, thicken, fair, ruled, revolve | ours+ | `surface.match` is a gap (also for SolidCraft) |
| Plastic features (none in FreeCAD) | Boss, rest, lip, snap fit, plastic rules | ours+ | |

### 3.4 Assembly

| FreeCAD 1.1 | Aether | Status | Evidence / missing |
| --- | --- | --- | --- |
| Joints: fixed, revolute, cylindrical, slider, ball, distance, parallel, perpendicular, angle, rack-and-pinion, screw, gears, belt | Mates: fastened, revolute, cylindrical, prismatic, ball, distance, parallel, perpendicular, angle, planar; relations: gear, belt, screw, rack-pinion, linear/rotation motion link; cam relation kept in the file but not solved | partial | oracle 16 assembly poses match FreeCAD; the four coupled relations need pose oracles against FreeCAD joints; cam and sweep joints are gaps |
| Grounding | Grounding, auto-anchor on first insertion | parity | |
| Part insertion (1.1) | Insert Part from Files/Drive, drag, instances | parity | `verify-assembly-insert-browser.mjs` |
| Sub-assemblies | Not supported | gap | nested assemblies open since alpha-0.1.18 |
| Joint motion simulation and animation (1.1) | Motion study with keys, steps, contact sets, CSV export; Aether Animation for rendered output | partial | no GIF/video export in CAD (by design: `aether_animation`) |
| Bill of Materials (1.1) | None | gap | |
| Exploded views | Explode create/show | parity | |
| Collision/contact | Contact sets with overlap refusal | ours+ | FreeCAD has no contact sets |
| External links, update links | Studio Drive documents and versions | n/a | ownership is Studio's |

### 3.5 Drawings (TechDraw)

| FreeCAD | Aether | Status | Evidence / missing |
| --- | --- | --- | --- |
| Views: projection group, section (simple/complex/offset), detail, auxiliary, active view, clip group, draft/arch views | Front/top/right/left/back/bottom/isometric, principal sections with hatching, hidden-line removal | partial | detail views, auxiliary views, offset sections missing |
| Dimensions: length, h/v, radius, diameter, angle, 3-point angle, extent, chain/coordinate (1.1 improvements) | Length and width dimensions, notes | partial | radius/diameter/angle/chain dimensions missing |
| Annotations: balloons, leaders, rich text, welding, surface finish, center lines/marks, cosmetic vertices, hatch, image | Notes, hatch on sections | partial | balloons, leaders, centre marks missing |
| BOM / spreadsheet view | None | gap | |
| Templates and editable title blocks | Sheet with frame | partial | **verify** title-block fields |
| Export SVG/DXF/PDF | SVG/DXF/PDF, save/reopen, source refresh, live agent editing | parity | `verify-drawings*.mjs`, `verify-drawing-pdf.mjs` |

### 3.6 Import and export

| Format | FreeCAD | Aether | Status |
| --- | --- | --- | --- |
| STEP | in/out | in/out | parity |
| IGES | in/out | in via full build only | partial (not in default bundle; no export) |
| BREP | in/out | — | gap (low value outside OCCT tooling) |
| STL | in/out | in/out | parity |
| OBJ / OFF / PLY | in/out | in (mesh references or faceted solids) | partial (no export) |
| 3MF, glTF, AMF | out | — | gap (glTF matters for Studio previews and Animation) |
| DXF / SVG (2D) | in/out | in/out (sketch and drawings) | parity |
| PDF (drawings) | out | out | parity |
| Images in sketches | yes | image canvases | parity |

### 3.7 Presentation, interaction, automation

| FreeCAD | Aether | Status | Evidence / missing |
| --- | --- | --- | --- |
| Coin3D/OpenGL viewport, three-point lighting (1.1) | Three.js WebGPU, WebGL2 fallback (Safari section cuts), theme tokens, display styles | verify | **no matched rendering comparison** (frame time, memory, materials) — same gap the SolidCraft review names |
| Transparent feature previews and draggers (1.1) | Live previews during edit, transform manipulator, section handles | parity | `verify-transform-manipulator-browser.mjs` |
| Transform tool overhaul (1.1) | Transform feature with handles, numeric input | parity | |
| Macro recording, Python console, FreeCADCmd headless | MCP tools, CLI, saved programs replaying the same validated operations; headless Node runner | ours+ | `scripts/verify-headless-kernel.mjs`; agent browser gates |
| Materials system (1.0): cards with appearance and physical properties | Material panel; material card schema v1 validation; appearance | verify | tracker `material.*` rows all "verify" |
| Measure tool (1.0 unified) | Measure with anchors, projected distance, section measure | parity | three measure gates |
| Addon manager | n/a | n/a | |

## 4. Performance

### 4.1 Native construction benchmark (other agent's harness, read as recorded)

Medians over five fresh processes, Apple M1 Max. "Solid" is the exact kernel build;
"display" is Aether's full display generation (faces, snap anchors, edges, buffers)
against FreeCAD's MeshPart meshing only, so the display columns are not like for like.

| Fixture (features) | Aether solid cold | FreeCAD solid cold | Aether edit | FreeCAD edit | Aether display | FreeCAD mesh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plate (2) | 22.5 ms | 2.1 ms | 1.5 ms | 1.9 ms | 24.9 ms | 0.8 ms |
| annular-shell (2) | 40.4 ms | 1.7 ms | 3.4 ms | 1.5 ms | 31.0 ms | 2.2 ms |
| ten-bores (22) | 139.6 ms | 121.2 ms | 8.0 ms | 19.2 ms | 94.1 ms | 23.1 ms |
| robot-front (76) | 4,711 ms | 8,282 ms | 116 ms | 549 ms | 649 ms | 199 ms |

Process wall including startup: plate 293 ms Aether (135 ms of it wasm init) vs 456–724 ms
FreeCAD; robot 6.3 s vs 24.3 s. SolidCraft failed the robot (boolean cut "no result"), so
the only engine that builds every fixture besides ours is FreeCAD.

### 4.2 What "cold" hides — warm-process rebuild (measured today)

The harness runs one construction per process, so Aether's "cold" includes first-call
warm-up of the wasm and JIT paths. Re-running the same runner with six rounds per process
(`BENCH_RUNS=6`, cache cleared before every round) gives the steady-state rebuild cost:

| Fixture | round 0 (as published) | rounds 1–5 solid | FreeCAD solid cold | Verdict |
| --- | ---: | ---: | ---: | --- |
| plate | 22.4 ms | 1.1–1.6 ms | 2.1 ms | Aether faster |
| annular-shell | 40.1 ms | 3.3–5.2 ms | 1.7 ms | **FreeCAD faster** (2×) |
| ten-bores | 138.4 ms | 55–66 ms | 121.2 ms | Aether faster (2×) |
| robot-front | 4,601 ms | 4,323–4,479 ms | 8,282 ms | Aether faster (1.9×), both slow |

Conclusions:

- The published cold numbers understate the engine on small fixtures by 10–20×. The
  harness needs a warm uncached phase (one more loop, no new code paths) before any
  "meet or beat" statement is made from it.
- The one case FreeCAD wins, annular-shell, is a two-circle profile extruded into a tube:
  our sketch-region and face-building path costs ~2 ms more than its native OCCT call.
  Worth profiling, small in absolute terms.
- Robot front shell: 37 cylinder extrusions (13 add, 24 cut) against a revolved shell cost
  **4,636 of 4,688 ms**; 31 of them take over 100 ms each (170 ms for the duct seats);
  sketches total 37 ms. This is OCCT's boolean against revolved/spline faces, and FreeCAD
  pays the same price twice over. It is the only place where absolute time is user-visible
  (first open of the example; edits replay from cache in 110 ms).
- Display generation is where Aether spends more than FreeCAD's meshing on every fixture
  (plate 25 ms vs 0.8 ms). It does more (topology, snap anchors, edge lines, buffer copies),
  but cold display on the robot is 650 ms, three times its meshing.

### 4.3 Startup and interaction (app side, from the reality notes)

- Wasm kernel init 132–138 ms in Node; in the browser the worker boots once per session.
- Assembly display: 1,000 occurrences of 10 definitions first display 249 ms, move 43 ms
  (`Assembly_Performance_2026_10_28.md`); 1,000 unique definitions ~4 s; 5,000 occurrences
  ~13 FPS. FreeCAD has no comparable large-assembly measurement here.
- Picking: BVH raycast 0.004–0.02 ms per ray against 3.6–5.7 ms before (`History_Playback_Performance_2026_10_30.md`).
- Budget in `Aether_Engine_Design.md` (edit to screen < 50 ms warm for ≤ 20 features) holds
  on the plate and ten-bore fixtures; the robot's 110 ms edit replay plus ~400 ms display
  does not meet it.

## 5. What of FreeCAD is still in this repository

The FreeCAD worker, translators and engine selector were deleted on 2026-10-20. What
remains, and what each needs before it can go:

| Item | Role today | Removal condition |
| --- | --- | --- |
| `aether-engine/src/kernel/oracle/freecad-references.json` (113), `freecad-assembly-references.json` (16) | Frozen measurements; the only independent truth the oracle compares against; no FreeCAD needed to run | Keep as data, renamed to reference measurements with provenance; or replace each with an analytic expectation. Never delete without a replacement truth |
| `service/tests/test_native_*.py` passing `freecadcmd` to `runner.pyz`; `AETHER_TEST_FREECAD=1` gate; `test_native_program.FREECAD` | Vestigial positional argument (the runner builds in Node; `native_worker.py` says the path is unused) and a misnamed gate | Drop the argument from the runner contract, rename the env var (e.g. `AETHER_TEST_NATIVE`), update README/RELEASING |
| `scripts/benchmarks/native/freecad.py` + README (uncommitted, other agent) | The three-way performance reference | Keep until §7's performance gate is met with a warm phase; then archive with the SolidCraft adapter |
| `PART_FORMAT.md` sections describing FreeCAD's conversion behaviour (lines ~195–401) | Historical semantics the port followed | Rewrite as Aether's own rules; keep one provenance line |
| `test-fixtures/imports/` (box fixtures generated with FreeCAD) | Independent import fixtures | Keep; provenance only |
| Docs: `Aether_Engine_Design.md`, `Tool_Parity_Tracker.md`, `SolidCraft_*`, `ClassCAD_*`, `CAD_Engine_Evolution.md`, README, ALPHA_0_1, RELEASING, `aether-engine/STATUS-OF-THIS-ENGINE.md` (still says "parked, FreeCAD default") | History and one stale status page | Update the engine STATUS page now (it is wrong); leave history docs |
| `../AetherStudio/migration/archive/freecad-reference-20261020/` (1.1 MB) | Archive | Keep outside the product |
| `/Applications/FreeCAD.app` | Benchmark and oracle capture only | User's choice after the gate |

## 6. Open functional defects (user-facing)

1. **Section view in Safari on the live host**: the plane and hatched cap appear but the
   half is not removed. Proven correct in Chromium and Playwright WebKit (10/10 pixel
   checks, `verify-assembly-section-browser.mjs`); a6f7d27 switched Safari to WebGL2 for
   cuts and the user still sees the failure on alpha-0.1.58. Diagnostic page prepared
   (`scripts/browser/section-check.html`, uncommitted); needs one run in real Safari.
2. Standalone "Open example" (no Studio) opens an empty editor without a message.
3. File tray closed by default with its toggle hidden in drawing and sketch mode; no
   create path from the Files panel in drawing mode (gate worked around via localStorage).
4. Picking a sketch in the tree and pressing Apply does not enter editing.
5. Stray example PNGs in `public/examples/` (uncommitted, modified by the other agent).

## 7. Plan: close the gaps, then retire the reference

Order by user impact, each with the evidence that closes it.

**P1 — correctness and the benchmark itself**

1. Fix the Safari section cut from a real-Safari reproduction; add a WebKit run of the
   assembly section gate to the release checklist.
2. Benchmark harness: add the warm uncached phase (§4.2) and a display-only phase that
   separates meshing from topology/anchors; publish the corrected table in
   `dev/docs/reality/`. Add a matched sketch-solver benchmark (ours vs PlaneGCS wasm spike
   vs FreeCAD's Sketcher solve on the same constrained sketches). Add a matched rendering
   scene (same model, same resolution) for frame time and memory.
3. Boolean hotspot (robot): profile the cylinder-into-revolved-shell cut; try fuzzy value,
   `SetNonDestructive`, `SetRunParallel` is unavailable in single-threaded wasm; try
   wasm threads (SharedArrayBuffer needs COOP/COEP headers from Studio); evaluate merging
   consecutive independent cuts of one body into a single multi-tool boolean with
   intermediate bodies materialised lazily for rollback/playback. Target: robot cold
   ≤ 2.5 s, every fixture ≤ FreeCAD including annular-shell.
4. Display generation: tessellate only faces whose signature changed; defer snap anchors
   and edge lines until the pointer needs them. Target: robot display ≤ 200 ms.

**P2 — FreeCAD 1.1 features we lack**

5. Assembly BOM (table from occurrences and Part metadata; also a drawing view).
6. Drawing dimension types (radius, diameter, angle, chain), detail and auxiliary views,
   balloons and centre marks, title-block fields.
7. ~~Hole: modeled threads and taper; thread profiles beyond ISO metric.~~ Done 2026-10-30 (BSP/NPT profiles and thread class still open).
8. Exports: glTF (Studio previews, Animation), OBJ, 3MF; IGES in/out without the lazy
   50 MB build (custom OCCT wasm, also unlocks `BRepOffset_MakeOffset` for the last
   offset-face refusals).
9. Nested assemblies; coupled relations (gear, belt, screw, rack-and-pinion) verified
   against FreeCAD joint poses as new assembly oracle fixtures.

**P3 — parity polish**

10. Sketch: persistent model links (external geometry), B-spline knot/degree editing,
    carbon copy; MultiTransform-equivalent patterns of patterns verified.
11. Materials rows from "verify" to evidence; variables with units.
12. Primitives and helix oracle fixtures (analytic volumes, no FreeCAD needed).

**Gate to remove the FreeCAD reference** (replaces the 2026-10-20 gate, which was met):

- every row above marked gap or partial that FreeCAD 1.1 provides is closed or recorded
  as a deliberate non-goal in AGENTS.md;
- the corrected benchmark shows Aether ≤ FreeCAD on construction for every fixture
  (warm uncached), edit replay, and display within a stated multiple, plus the solver and
  rendering comparisons recorded;
- oracle truth no longer depends on capturing new FreeCAD answers: each new feature kind
  ships with analytic or self-consistency expectations;
- the vestigial `freecadcmd` argument and `AETHER_TEST_FREECAD` gate are gone from the
  service runner and tests;
- then `scripts/benchmarks/native/freecad.py` is archived beside the SolidCraft adapter
  and FreeCAD may be uninstalled from the Mac.
