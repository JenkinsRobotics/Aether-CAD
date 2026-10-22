# Aether Engine — design (2026-10-20)

Owner: Jonathan. Author: Claude. Status: draft for approval; supersedes the SolidCraft
adoption plan (`SolidCraft_Engine_Adoption.md`) and the FreeCAD-default policy in AGENTS.md.

## Intent

Aether CAD gets one parametric geometry engine of its own that runs **in the process that
shows the model** — the browser tab served to 200+ seats, the standalone desktop app offline,
and headless runners — with the **lowest latency we can reach** and **industry-standard
geometry** (OpenCASCADE). The server never computes geometry for a user.

Why now: the FreeCAD worker is a server process per build (600–900 ms floor, Python, no
offline). The SolidCraft spike proved what in-process feels like (12 ms builds, 40 ms Apply →
model) but its kernel is too young to bet the product on. We keep OpenCASCADE and build the
layer above it ourselves, taking from FreeCAD the feature semantics we already ship and from
SolidCraft the structure that made it fast and agent-friendly.

## Goals

- Every feature Aether CAD ships today keeps working, with the same geometry: the FreeCAD
  worker is the oracle while it exists, feature by feature, then it is deleted — before alpha 0.1.
- Interactive latency: a parameter edit on a typical part (≤ 20 features) shows the rebuilt
  model in under 50 ms on a laptop; previews stream while the user types; the UI thread never
  blocks on geometry.
- One validated command API used by the UI, agents (MCP/CLI) and tests alike.
- Stable identity: faces, edges and vertices keep their ids across edits so references
  (section planes, measures, up-to-face, sketch-on-face, mates) survive.
- Works offline; the same engine build runs in the desktop shell and in Node for CI.

## Non-goals (this design)

- A new document format: `.acpart` and the feature tree the user sees stay as they are.
- Replacing the viewer (three.js/WebGPU), Aether UI, Studio PDM, or the agent protocol.
- A second kernel. The engine is written so one could be added later (kernel interface in
  §Architecture), but no truck/SolidCraft code ships in the product.
- Assemblies, sheet metal, drawings beyond what exists today.

## Anti-goals (would make this a failure even if it "works")

- Any geometry computed on the server for interactive use.
- Python anywhere in the product.
- Two implementations of the modeling layer (one TS, one Rust) that must be kept in step.
- A feature "ported" without its FreeCAD-equivalence check.

## Constraints

- Kernel: OpenCASCADE compiled to WebAssembly (OpenCascade.js). replicad (already a dependency,
  0.23) may be used as a convenience wrapper where it is a straight pass-through; everything it
  cannot express is done against raw OCCT handles. The wasm is a custom build containing only
  the OCCT toolkits we use (target: well under the 10.8 MB of `replicad_single.wasm`).
- Languages, each where it is strongest (Jonathan, 2026-10-20): TypeScript for the modeling
  layer, document model, sketch solver, worker and UI — one language, one test suite, no FFI
  boundary around the kernel calls; C++ (OCCT) for geometry; Rust for the Studio server, the
  desktop shell, and any hot numeric routine that profiling shows is worth moving to a wasm
  module (a bounded, optional step — none is planned up front).
- Latency architecture: engine in a web worker (Node worker thread headless); results cross as
  transferable ArrayBuffers (no JSON for geometry); per-feature shape cache so an edit rebuilds
  from the changed feature forward; only changed bodies are re-tessellated.
- AGENTS.md ownership holds: CAD owns engine, document, command API; Studio owns PDM.

## Architecture

```
@aether/core (aether-engine/, TypeScript)
├─ document/      PartDocument, feature history, body ids, dependencies   (exists)
├─ sketch/        constraint solver (ours) + PlaneGCS (FreeCAD's solver, wasm, spiked)   (exists)
├─ kernel/        OCCT access: wasm loader, shape ownership, tessellation, exact topology  (exists, grows)
├─ engine/        NEW — the modeling layer
│  ├─ commands/   registry: id, JSON-schema params, validate, execute, undo info (UI + agents)
│  ├─ features/   one module per feature kind: build(inputs, ctx) → bodies  (ported from aether_freecad/*.py)
│  ├─ timeline/   replay with per-feature cache, rollback, suppression, previews
│  ├─ naming/     stable face/edge/vertex ids (feature + sketch curve + split index), anchors
│  ├─ analysis/   measure, section, interference, mass properties
│  └─ io/         STEP/IGES/STL/3MF in and out, DXF/SVG for sketches
└─ worker/        engine-in-a-worker: evaluate, preview, analyze, export; Node variant for CI
```

- **Kernel interface.** `kernel/` exposes the small set of operations features need (make face
  from wire, prism/revol/sweep/loft, boolean, fillet/chamfer, offset/thicken, shell, transform,
  section, distance, properties, mesh, STEP). Features never touch OCCT handles directly; this is
  the seam a second kernel would implement, and the place where shape ownership and `delete()`
  are centralized (OCCT wasm leaks otherwise).
- **Timeline.** `evaluate(document, {upTo, preview})` walks features in order. Each feature's
  inputs are hashed (its parameters + the ids of the bodies/sketches it consumes + their
  hashes); a cache keyed by that hash holds the resulting OCCT shapes and their mesh. An edit
  invalidates from the first changed feature forward. Rollback evaluates a prefix. Preview of a
  feature = base bodies (from cache) + the feature's own tool body (added/removed), as the viewer
  already expects.
- **Naming.** Faces are named by generating feature + sketch curve id (+ split ordinal), carried
  through booleans by OCCT history (`BRepTools_History` / `Generated`/`Modified`); edges and
  vertices by their adjacent faces. The ids the viewer, Measure, Section and references use
  are derived from these names, so they survive edits and reordering. Replaces the FreeCAD
  `stable_face_ids` signature approach and SolidCraft's `F2:side:l1` scheme with one of ours.
- **Commands.** One registry (`engine/commands`) with typed parameters: the feature dialogs,
  the agent runner (`src/automation`) and the test oracle all call `execute(id, params)`. The
  document is the state; a command is a validated document edit followed by evaluation.
- **Worker.** The engine runs in a worker started once per tab (or Node worker thread).
  Messages: `evaluate`, `preview`, `analyze`, `export`, `import`. No data shuttles back and
  forth (Jonathan, 2026-10-20): OCCT shapes, the feature cache and the document copy stay in
  the worker; an edit sends only the changed feature; what comes back is the mesh of the bodies
  that changed, as transferable typed arrays — a zero-copy move the viewer uploads straight to
  the GPU — never JSON geometry. The main thread keeps `HostAetherCoreClient` as the only entry,
  unchanged for callers.
- **Sketching.** The existing TS solver stays the editor's live solver; PlaneGCS (FreeCAD's
  solver, already in `sketch/solver/planegcs-*.ts` as a spike) is adopted where it is better
  (full constraint sets, DOF reporting) behind the same `solveDrawingConstraints` facade.
  Sketch-on-face resolves its frame from the engine's named faces (what `sketch_support.py` did).

## Taking from the old pipelines

- From `freecad-engine/aether_freecad/*.py` (56 modules, the product's real semantics): each
  module becomes the spec for one `engine/features/*` module and its tests — extrusion ends
  (blind, symmetric, through-all, up-to-next/face/part/vertex, offsets, drafts, thin, automatic
  scope, direction references, start references), revolve extents, loft, sweep, hole, pattern,
  mirror, draft, shell, boolean, offset-face, move-face, face-extrude, transform, pierce,
  fixed sketches, feature previews, analysis, export, import. The Python is deleted module by
  module as each port passes its equivalence check.
- From SolidCraft (reference only, no code): command registry with self-describing params,
  stable naming by feature + curve, replay timeline with checkpoints, oracle-style tests
  (volume/area/bbox per feature), `inspect.*` style analysis commands.
- From the parked `@aether/core`: `exact-topology.ts`, `hidden-line.ts`, `part-geometry.ts`,
  the OCCT worker, and the evaluator loop are the starting point of `kernel/` and `engine/`.

## Equivalence and the FreeCAD removal gate

- Oracle: for every ported feature, a fixture set of documents is built on both engines and
  compared: body count and ids, volume, surface area, bounding box (tolerance 1e-3 mm³ / mm),
  face count by surface type, and the viewer-facing topology ids that references depend on.
  Plus every `.acpart` in the Studio library and `examples/` rebuilt on both.
- Gate to delete the FreeCAD worker and `/api/cad/*` geometry services (my call unless
  overridden): both — every feature kind in the port table at parity **and** every library
  document rebuilding within tolerance. Alpha 0.1 ships without FreeCAD.
- The SolidCraft bridge installed in `cad-solidcraft-20261020-r1` stays only until the new
  engine passes the same five CAD e2e checks, then `engine-solidcraft/` and
  `src/engine/solidcraft/` are removed (the decision record in AGENTS.md is amended).

## Performance budget and bottleneck checks

- Edit → model on screen: < 50 ms warm for ≤ 20 features; preview debounce ≤ 100 ms; 60 fps held.
- Cold load: wasm fetch cached; engine ready < 1 s on a warm cache.
- Known risks and their answer: single-threaded wasm (worker; OCCT pthreads build later if a
  boolean exceeds budget); wasm memory growth (centralized ownership, periodic worker restart
  on a document switch); first-paint size (custom OCCT build, brotli).
- Every phase lands with the `cad-rebuild-timing` harness run on the GPU and its numbers in the
  briefing.

## Phases (each: port, equivalence check, e2e, install; one feature at a time)

0. Foundation — kernel loader (custom OCCT build), worker with transferable results,
   timeline with cache, naming, command registry, oracle harness. Sketch (circle/polygon/wire
   incl. ellipse, bezier, conic) + extrude blind/symmetric/through-all/cut/intersect, separate
   bodies; the five CAD e2e checks; `cad-rebuild-timing` ≤ SolidCraft's numbers.
   Status 2026-10-20: landed in `aether-engine/src/kernel` — typed errors (`UnsupportedFeature`
   → the policy tries FreeCAD in Automatic, `FeatureFailure` names the feature), separate
   bodies, blind/symmetric/through-all/reversed extrudes, previews (base + the feature's own
   material), stable face ids (geometry signature), face/edge measurements, `measureDistance`
   (BRepExtrema), per-feature replay cache with mesh cache (identical re-evaluation 0.3 ms,
   Apply after preview 0.4 ms), adaptive mesh tolerance, worker protocol with `measure-distance`.
   App side: `src/engine/evaluate-part.ts` policy (`auto` = Aether → FreeCAD fallback; `aether`,
   `solidcraft`, `freecad` forced), `src/engine/aether/`; warm-ahead: after a preview settles the
   complete document is built in the background so Apply is a cache hit (`feature-preview.ts`).
   Equivalence oracle: `aether-engine/src/kernel/oracle/` — 18 fixtures built on the engine, 17
   compared with FreeCAD's own answers (`freecad-references.json`, captured by
   `AetherStudio/.verification/cad-engine-oracle-2026-10-20`): volume to 1e-6, face and edge
   counts exact, separate-body ids identical (`:solid-<sha256 of region keys>`); what the oracle
   caught and fixed: cuts go behind the sketch unless reversed (FreeCAD's rule; the wheel example
   files were updated), replicad's `CYLINDRE`, mesh groups named by kernel hash. Still FreeCAD's:
   mirror-cut (not translatable there), everything the engine refuses. Not yet: custom OCCT
   build, batched booleans, history-based naming, command registry, open-profile diagnostics.
   Benchmark (`.verification/cad-engine-benchmark-2026-10-20`, GPU, Apply measured from the
   click; previews draw only their overlay, the result mesh is not built): plate preview 75–88 ms
   / Apply 18 ms (SolidCraft 77–82 / 56, FreeCAD 621 / 515); ten-hole plate preview 81–88 /
   Apply 147 (SolidCraft 76–81 / 1,256; FreeCAD 612 / 807). Engine share of a preview: 9–14 ms.
   Installed `cad-aether-engine-20261020-r3` (all six CAD e2e suites pass on the engine), then r4
   with sketch-on-face (FreeCAD's rule: the unique planar face of the body after the source
   feature, by outward normal and anchored centre/area; frames returned as `sketchFrames`),
   oracle 18/18 including it; then r5 with boolean (union/cut/intersection, tools consumed unless
   kept), shell (closed = minus the inward offset solid; open faces by plane) and revolve extents
   (reversed, symmetric, two angles) — oracle 25 FreeCAD references matched; then patterns (linear /
   polar, count includes the original, full turns spaced over 360°), region selections (the UI's
   `profileSelections` / contour ids; nothing named = the whole sketch), automatic extrusion scope
   (cut / intersect every overlapped part, add merges touching parts; `scopeResolutions` returned).
   The separate "Cut" ribbon tool and `feature-cut` command were removed: removing material is
   Extrude's operation (Onshape), not a feature. Per-tool UI harness:
   `AetherStudio/.verification/cad-tools-2026-10-20` (sketch on plane, rectangle and circle by
   coordinates, extrude new / remove, revolve, fillet, shell, mirror, pattern, boolean, hole); a
   fallback to FreeCAD is logged in the console as `[engine] … cannot build feature … yet`.
   Then hole (PartDesign::Hole: plain / counterbore / countersink, blind / through-all, reversed)
   and transform (translate / rotate / uniform scale / copy with recorded copy ids) — 42 oracle
   fixtures, 41 compared with FreeCAD. The per-tool UI harness runs sketch, extrude new / remove,
   revolve, shell, fillet, mirror, pattern, boolean and hole on the engine with no server builds;
   later also extrude Add / Intersect and revolve Remove (12 steps).
   Display quality (Jonathan, 2026-10-20: true to the CAD file, Onshape-comparable, never
   pixelated): solids are exact B-rep (oracle-proven), tessellated at a chord deflection never
   coarser than the FreeCAD worker's 0.1 mm and finer on small parts (0.12 % of the diagonal,
   floor 0.01 mm; a Ø20 pin at 0.034 mm), angular step 0.2 rad; the WebGPU renderer runs MSAA
   with the device pixel ratio (capped at 2, Settings render scale 0.5–1.5), ACES tone mapping,
   shadow maps, and anti-aliased screen-space fat lines for edges. Previews mesh 3× coarser.
   Models harness `AetherStudio/.verification/cad-models-2026-10-20` (r9/r10): a 90° bracket
   (L profile on Front, through-all holes removed from the base, fillet), a bent pipe (ring
   extruded, offset plane, ring revolved 90° about the sketch X axis and added to the straight
   run) and a table (top, four legs, fillet) built feature by feature through the ribbon on the
   engine, 0 server builds, 105–132 ms engine time per feature, framed screenshots. What it
   caught: a revolve whose profile straddles its axis came back from OCCT as an empty solid;
   the engine now refuses it ("Revolve profile crosses its axis") instead of building nothing
   (revolve axes are the sketch's own X/Y/Z through its origin, so the profile is drawn
   beside the axis at the bend radius). Feature-window notices (errors, "cannot build yet")
   float above the window (`.aui-feature-notices`, @aether/ui 0.2.0-alpha.199) so a message
   never moves the fields. Installed r9 (notices, plane pick from the tree), r10 (revolve check).
   Extrude extents (r11), each with FreeCAD's rule from `freecad-engine/aether_freecad/
   extrusion_*.py`: starting offset and starting references (principal plane, plane feature,
   parallel face), custom direction vectors (depth measured along the vector, so the solid
   shears), two-sided ends (legacy opposite depth, independent second end, symmetric and
   symmetric-through-all: distance-type ends on both sides merge into one prism through the
   sketch plane), end offsets, up-to-vertex (sketch point or solid vertex), up-to-face (planar:
   a plain prism when parallel, otherwise the prism kept on the near side of the plane with
   the "nothing behind the start" check), up-to-next (every boundary patch the probe meets
   casts a forward shadow that is cut away, so stepped stops across parts work and a
   coincident start face is skipped) and up-to-part (the piece of the trimmed prism still
   touching the whole start, which must stop at the part — curved boundaries included).
   Face-and-solid intersections use BRepAlgoAPI_Common directly. Sketch primitives are run
   through ShapeUpgrade_UnifySameDomain: replicad draws a circle as two arcs, so a bare
   cylinder had two lateral faces (booleans had been merging them silently); now every body
   has FreeCAD's face count. Oracle: 60 fixtures, 60 FreeCAD references matched on volume
   (1e-6), face counts, body ids and bounding boxes; edge counts exact on 58, the other two
   differ by FreeCAD's own seam placement (tolerance ±2 kept). Still refused (FreeCAD builds
   them): thin walls, draft angles, direction references (sketch lines), several target
   bodies, curved stopping faces. Known ponytail: a solid-vertex stop is found by its
   recorded position, not followed by signature after an edit.
   Then (r12) drafts, thin walls and direction references: a drafted extrusion is the ruled
   loft between the profile's end sections, each the outer wire offset by -t·tan(angle)
   (holes the other way) with OCCT intersection joins, the sketch plane neutral and each side
   lofted on its own so two-sided drafts narrow away from the sketch (FreeCAD's rule, which it
   checks its PartDesign::Draft against); thin walls offset a closed curve both ways and cut
   (thickness 1 outside), or offset an open curve on each side with OCCT's open result and cap
   the strip with straight lines, the chosen sign matched against the curve's end tangents;
   direction references take a line of an earlier sketch in that sketch's frame. Lone circles
   are one full-circle edge, so an oblique or drafted cylinder is one face as in FreeCAD.
   Open-only sketches now register (walls and direction lines use them). Oracle: 73 fixtures,
   72 FreeCAD references matched. Extrude gaps left: several explicit target bodies, curved
   stopping faces, drafts to a face/next/part, drafted thin walls.
   Then (r12): Push/Pull (face-extrude: the unique planar face by outward normal and anchor,
   prism along its normal, fused or cut), the Draft feature (BRepOffsetAPI_DraftAngle on the one
   planar face in the face plane, pulled along the neutral plane's normal, Reversed flips the
   angle), loft (BRepOffsetAPI_ThruSections over closed section wires, smooth or ruled), sweep
   (BRepOffsetAPI_MakePipeShell, standard mode, transformed transitions, along one curve of
   another sketch), shell open faces by reference (planar by normal, curved by surface type, on
   the current solid) and transforms by reference (two points, a solid edge by its endpoint
   anchors, or a sketch line; scale about a referenced point). Lone circles are single edges
   in lofts and sweeps too. A closed shell's inward offset is re-oriented when OCCT hands it
   back inside out (a plate with a side pocket). Oracle: 88 fixtures; 85 FreeCAD references
   matched; two scenarios are refused by both (a shell through a toroidal tunnel, FreeCAD
   "Null shape"); one FreeCAD answer is wrong (its worker keeps a shell face named by
   reference) and the fixture carries the right volume instead. Oracle bounding boxes are now
   optimal (a plain Bnd_Box is loose around a sweep's spline surfaces). Still refused:
   offset-face/move-face (needs BRepOffset_MakeOffset, not in the stock wasm), non-uniform
   scale (BRepBuilderAPI_GTransform, same), several explicit target bodies, curved stopping
   faces, patterns of intersect features, imports; analyses and exports stay on the services.
   Then: analyses on the engine (`kernel/analysis.ts`, FreeCAD's `analysis.py`/`properties.py`
   rules): physical properties (exact volume, surface area, centroid, optimal box; with a density,
   mass and the inertia tensor about the centroid in world axes — gp_Mat is not bound in the wasm,
   so the tensor comes from moments about six axes), capped sections (the body intersected with a
   box clamped at the plane, rendered) and pairwise interference (overlap volumes, rendered);
   STEP and STL export (`kernel/export.ts`: exact B-rep STEP, binary STL at the chosen chord
   tolerance, 0.35 rad); STEP imports and STL-as-solid imports as features (`kernel/import-shape.ts`,
   unsewn files refused, mesh units applied). The app routes all of them through the engine
   policy (`part-analysis.ts`, `part-export.ts`), FreeCAD only when chosen or as the fallback for
   what the engine refuses (mesh references, IGES/BREP/OBJ/PLY/OFF). Unit tests check the exact
   numbers (a 60×40×20 plate's mass and inertia, half sections, a 4000 mm³ overlap) and a STEP
   round trip. Feature-window notices now live in the document body with fixed placement
   (@aether/ui alpha.201): the window clips its overflow, so the floating messages had never
   been visible. The tools harness fillets (2 mm) before it shells (1.5 mm): both engines refuse
   1 mm fillets on every edge of a 1.5 mm shell, and the same for a shell through a torus.
   Then explicit extrusion scope (`targetBodyIds`, FreeCAD's `extrusion_scope.py`): Remove and
   Intersect meet each named part on its own (a part the tool misses is kept), Add joins the
   named parts and the tool into one solid under the first identity. Oracle: 93 fixtures, 90
   FreeCAD references matched (the other three are the shared refusals and FreeCAD's wrong
   shell-by-reference). What FreeCAD still builds that the engine refuses: offset/move face and
   non-uniform scale (BRepOffset_MakeOffset and BRepBuilderAPI_GTransform are not in the stock
   replicad wasm — a custom OCCT build, already planned, unlocks both), curved stopping faces
   (extrusion_surface_limit: needs BRepPrimAPI_MakeHalfSpace on an untrimmed surface), mesh
   references (the engine's bodies are B-rep only), IGES/BREP/OBJ/PLY/OFF imports, patterns of
   intersect features (FreeCAD's PartDesign cannot pattern those either).
   Then (r13): curved stopping faces for cylinders and spheres (the untrimmed surface as an
   exact primitive solid, the side holding a start vertex kept, FreeCAD's connectivity and
   escape checks; cones/tori/splines refused since the wasm has no half-space builder);
   Offset / Move face for planar faces with planar neighbours (FreeCAD's offsetFaces extends
   the neighbours: here the region between the old and new planes inside the neighbours'
   half-spaces is added or removed, which is the same answer, proven on a wedge's slanted
   face and a tilted move); mesh imports in every format FreeCAD's Mesh module read (STL
   ASCII/binary, OBJ, OFF, PLY ASCII/binary, `kernel/mesh-formats.ts`): as faceted solids
   (closed-mesh and 10,000-triangle rules) or as mesh references the viewer draws and
   features refuse as targets. Oracle: 104 fixtures, 100 FreeCAD references matched (FreeCAD's
   Mesh module cannot read a quad-face ASCII PLY the engine reads). Left on FreeCAD: non-uniform
   scale and IGES (BRepBuilderAPI_GTransform and IGESControl_Reader are absent from the stock
   replicad wasm; a custom OCCT build needs Docker, which this machine does not have; the full
   opencascade.js build has them but is 64 MB against 11 MB), curved offsets/neighbours in
   Offset face, cone/torus/spline stopping faces. Patterns of intersect features: refused by both.
   Three-way benchmark rerun on r13 (`.verification/cad-engine-benchmark-2026-10-20`, headed,
   Apple Metal, Apply measured from the click): plate — Aether preview 84–90 ms / Apply 20 ms
   (engine 13–16 ms), SolidCraft 80 / 56, FreeCAD 616 / 529 cold (14 warm: its server cache,
   not a build); ten-hole plate — Aether 88 / 136, SolidCraft 75–80 / 1,249, FreeCAD 627 / 846
   cold (18 warm). Aether is the fastest on every Apply and at parity on previews, where the
   viewer's overlay dominates (the engine's share is 10–16 ms against SolidCraft's 3 ms: the
   worker round trip and preview mesh; in Node a plate builds in 8 ms cold, 0.1 ms warm).
   Installed r13. Headless (SwiftShader) numbers are ~5× larger across the board and are not
   comparable. Reference deletion stays gated on the FreeCAD-only list above.
   Then (r14) the extended kernel (`kernel/extended-kernel.ts`): the full OpenCascade.js build
   (50 MB wasm, `opencascade.js@2.0.0-beta`), fetched by the worker only when a document uses
   what the stock replicad build lacks, so ordinary modelling pays nothing. Shapes cross over as
   files: BREP into it (topology order kept), STEP back (exact for B-rep). It gives non-uniform
   scale (gp_GTrsf + BRepBuilderAPI_GTransform, FreeCAD's transformGeometry), IGES import
   (IGESControl_Reader, surface-only files sewn and closed into solids) and stops at any other
   surface (cone, torus, spline, extrusion, revolution): the face's untrimmed surface, its
   infinite parameters clamped to the tool's reach, splits the prism (BRepAlgoAPI_Splitter — a
   half-space solid did not cut) and the piece holding the whole start is kept; a double cone's
   lumps are separated by shell. Oracle: 107 fixtures, 103 FreeCAD references matched; a
   column through a cone's apex is refused by both. What no build without BRepOffset_MakeOffset
   can do (it is absent from the full build too): Offset/Move face on a curved face or with
   curved neighbours — the one FreeCAD-only item left; a custom OCCT wasm (Docker) adds it.
   Apply cost on the ten-hole plate, profiled in Node: one automatic-scope cut no longer runs a
   separate overlap boolean (a box test and the cut's own volume change decide), and the
   geometry of the result splits as face signatures 9 ms, topology measurements 13 ms, mesh
   12.5 ms, edges 6 ms — the next optimisation is caching per-face signatures and measurements
   across evaluations, since unmodified faces keep their OCCT identity through booleans.
   Offset / Move face now covers cylindrical and spherical faces too: the face moves as its
   primitive solid (an offset changes the radius, towards the material for a hole and away for
   a boss; a move carries the axis or centre), bounded by its planar neighbours on the side the
   face lies on — the neighbour's material side across a convex edge, the other side across a
   concave one (a boss on a plate). Oracle: 111 fixtures, 106 FreeCAD references matched;
   FreeCAD's worker refuses moving a curved face ("Translate and Rotate currently require planar
   faces") where the engine slides the hole. The last FreeCAD-only case is an offset of a face
   whose neighbours are curved (a face next to a fillet): BRepOffset_MakeOffset, in no prebuilt
   wasm. Every other FreeCAD feature builds in-process, most of them proven equal on the oracle.
   Benchmark on r14 (headed, Apple Metal): plate preview 75–92 ms / Apply 20 ms (engine 16),
   SolidCraft 77–82 / 58, FreeCAD 627 / 538 cold (13 warm); ten holes 87 / 122–128 (engine
   117–124), SolidCraft 76–81 / 1,235, FreeCAD 615 / 789 cold (17 warm). Installed r14 (the
   bundle now carries the 50 MB full build as a lazy asset beside the 11 MB kernel).
   Then (r15): Offset / Move face with round neighbours — a cylindrical or spherical neighbour
   extends as its primitive solid, exactly as FreeCAD's offsetFaces extends the surface, and the
   side kept is decided at the shared edge (this face's inward direction, found by probing the
   face itself across the edge, against the neighbour's material side); a region that shares a
   cylinder with the part it joins is fused in glue mode (BOPAlgo_GlueShift), since the exact
   boolean throws on coincident surfaces. Oracle: 114 fixtures, 109 FreeCAD references matched.
   A face next to a fillet is refused by FreeCAD as well (the tangent neighbour cannot meet the
   moved plane), so the only faces the engine refuses that FreeCAD's offsetFaces might accept
   are ones whose neighbours are cones, tori or splines. Per-face topology (measurements,
   candidates) is cached by geometric signature across rebuilds: an edit of the last hole on the
   ten-hole plate re-evaluates in 63–69 ms in Node (cut, mesh, edges, signatures).
   Assemblies (`kernel/assembly-solver.ts`): mates are solved in-process. An instance is a rigid
   pose; a mate constrains the two connector frames' relative pose (fastened: equal frames;
   revolute: coincident origins and z axes; cylindrical: origin on the axis, z aligned;
   prismatic: that plus no turn; ball: coincident origins; distance: origin distance;
   parallel / perpendicular / angle: z axes), solved by Levenberg–Marquardt on six numbers per
   free instance with numeric Jacobians; grounded instances stay, nothing grounded holds the
   first and warns (FreeCAD's rule), every mate is checked after the solve (FreeCAD's
   acceptance), and a failed solve publishes no placements. The four coupled kinds (gears,
   belt, screw, rack and pinion) are refused with a clear message and no fallback: the
   workspace can author only fastened, revolute and prismatic mates, and the FreeCAD worker
   created the coupled joints without their coupled-joint references or ratio, so FreeCAD
   failed to converge on gears and belt and solved screw and rack-and-pinion as if the coupling
   were not there (fixtures `coupled-*`, captured 2026-10-20). Nothing is lost by refusing. The app's mate availability lists the nine; `main.ts` routes the solve through the
   engine policy. Fixtures: `kernel/oracle/assembly-fixtures.json`, FreeCAD's answers captured by
   `AetherStudio/.verification/cad-assembly-oracle-2026-10-20` (both solutions must satisfy the
   mates; fully constrained jobs must place instances where FreeCAD did).

   FreeCAD's answers for the twelve assembly fixtures were captured; the in-process solver
   satisfies every mate FreeCAD's placements satisfy, and places the fully constrained jobs
   (fastened stacks and chains, nothing-grounded) where FreeCAD did. Benchmark on r15: ten-hole
   Apply 108–129 ms. Deletion step one done: the 21 browser sketch-maths modules moved from
   `freecad-engine/browser` to `aether-engine/src/sketch/reference` (exported as
   `@aether/core/sketch/reference/*`); `pierce-native` and `wire-geometry` stay with the
   translator. Installed r16.
   Then (r17): `sketchRegions` moved to the document package (deletion step two); coupled mates
   refused on both engines, FreeCAD fallback removed (the proof is in the assembly oracle, below);
   the worker warms the kernel up after loading (twelve small previews in idle slices) because in
   Node a plate preview edit costs 3.6 ms (fully cached 1.2 ms, preview mesh 0.9 ms, full mesh
   2.0 ms) and a ten-hole preview 8.9 ms, while the first browser previews measured 12–17 ms:
   the wasm baseline tier and cold JS, not the build. Benchmark on r17 (headed, Apple Metal):
   plate preview 83–88 ms / Apply 20–21 ms (engine 10.8–11.7 / 16), SolidCraft 80–81 / 56–59
   (engine 3 / 53–56); ten holes preview 83–89 / Apply 114–121 (engine 10–11 / 110–116),
   SolidCraft 76–80 / 1,241–1,247. Previews are now within 3–8 ms of SolidCraft's total with the
   engine's share down from 13–17 ms to 10–11 ms; every Apply is ours by a wide margin. Installed r17.
   Then (r18), profiling the benchmark documents in Node: (1) a new extrusion with separate
   bodies re-extruded every sketch region and intersected each output solid with it to name the
   solids; with one region the name is known, so the preview of the plate fell from 8.8 ms to
   1.7 ms; (2) replicad's fuse / cut / intersect construct the OCCT operation with the two-shape
   constructor, which already runs it, then call Build again, so every boolean ran twice —
   `kernel/booleans.ts` builds once with the same result simplification (a hole cut 8–20 ms →
   4–11 ms, a boss fuse 7–21 → 4–12, an intersect 4 → 2.4); (3) each face signature took two
   surface-property passes (centre, area) — one pass now (listing the ten-hole body's faces
   12 ms → 3.5 ms; its full mesh + topology 27 → 19 ms). The ten-hole plate's full rebuild after a
   plate edit went 144 → 133 ms in Node, where the cuts and the final mesh extraction (replicad
   walks triangulation nodes one wasm call at a time, 10 ms for 16 faces) now dominate; the warm-up
   runs forty rounds over the benchmark's feature shapes. Benchmark on r18 (headed, Apple Metal):
   plate preview 76–78 ms / Apply 20–21 ms (engine 2.4–3.4 / 16–17), SolidCraft 80–81 / 55–59
   (engine 3–3.6 / 52–55); ten holes preview 76–79 / Apply 50–62 (engine 2.9 / 45–59),
   SolidCraft 77–81 / 1,224–1,242 (engine 2.8–2.9 / 1,220–1,236). Aether is now the fastest on
   every measurement, previews included; FreeCAD stays at 615–630 / 530–840 cold (r15). Installed
   r18 (both UI harnesses pass). SolidCraft deleted afterwards (archived).
   Then (r19): offset / move face with cone and torus neighbours and on cone and torus faces,
   without BRepOffset_MakeOffset. gp_Cone and gp_Torus are not bound in the stock wasm, so the
   parameters are read by sampling the surface's own parametrisation (apex, axis and half-angle
   from three points; centre, axis and both radii from four); the surfaces become solids (a torus
   primitive, a cone as a revolved triangle) and join the planar / cylindrical / spherical
   neighbour sides. Two further rules came out of the fixtures: the probe that decides which side
   of a neighbour the face lies on is projected back onto the face (a straight step along a
   tangent fillet's edge lands on the neighbour's own surface), and every neighbour's surface must
   cross the moved surface, or the offset is refused — a plate top beside tangent fillets cannot
   rise, a chamfered boss top cannot rise past the cone's apex, a fillet tube cannot shrink away
   from what it blends. FreeCAD returns "Null shape" for exactly those three; the fourth (the
   chamfer's cone face moved 1 mm) matches FreeCAD's volume to 48750.073 mm³. The bounded regions
   use fuzzy booleans without glue (tangent tubes against their planes). Fixtures `offset-*-fillet*`,
   `offset-*-chamfer*`. Free-form neighbours (splines, extrusions, surfaces of revolution) are
   handled next, within what a finite surface patch can bound: the analytic sides bound the
   moved regions first; material removed is then kept within the body (which bounds it) and
   trimmed by each free-form neighbour's patch with the full build's splitter; material added
   must be cut in two by every such patch, or the offset is refused (a patch ends at its face,
   so nothing bounds a face raised beside a spline). A document that needs this raises
   `UnsupportedFeature.fullBuild`; the worker loads the 50 MB build once and retries, so no
   document pays for it up front. Fixture `offset-top-of-loft` (a three-section loft's top
   lowered 3 mm beside four B-spline sides: 6 faces, −1,674.9 mm³) — FreeCAD's per-face offset
   fails this loft with BOP check errors, so the fixture carries the volume. Moving a free-form
   face itself stays refused: its offset surface is as finite as the face. 119 fixtures. Installed
   r20 (both UI harnesses pass).
   Then (r21, installed): exact rho conics (rational quadratic B-splines, as FreeCAD's conic_wire;
   fixtures `conic-*` match FreeCAD), connected sketch regions as profiles for extrude / revolve /
   loft / sweep, sweep paths of one unnamed curve, Pierce constraints resolved in the evaluator,
   a shell whose opening plane matches no face refuses, and every body's topology carries vertex
   and straight-edge anchors (FreeCAD's checked references: signature-first resolution, exact
   point only when several vertices look alike). The CAD product worker builds with the Aether
   engine in its Node runner (`src/automation/engine-node.ts`); FreeCAD left the product.
   Then (r22): the FreeCAD reference deleted from the app (`freecad-engine/`, translator, clients,
   engine selector; archived) and the Scifirobot example — 120 features, 39 bodies, authored and
   proven on FreeCAD — rebuilt tip by tip on the Aether engine: all 66 tips match FreeCAD's
   recorded volumes and face counts (`kernel/scifirobot-proof.test.ts`). The one tip that first
   failed, a fillet selected by an XZ edge plane, exposed that replicad's named XZ plane pins y
   to the opposite sign of FreeCAD's `_edges_in_plane`; fillet and chamfer edge planes now pin
   the world coordinate exactly as FreeCAD did. The example's exporter runs on the engine in Node.
   After the removal the app suite stands at 1,720 passing tests across 270 files; the six
   failures left are the pre-existing environment-preset, viewport-theme and panel tests.
   Engine suite: 228 tests, 124 fixtures (113 with FreeCAD references); CAD service: 248.
   Benchmark on r22 (headed, Aether alone now): plate preview 68–79 ms / Apply 20–21 (engine
   2.3–2.5 / 16–17), ten holes 75–80 / 60–63 (engine 2.8–3.1 / 55–59). Both UI harnesses pass.
   Installed r22: the live app runs with no FreeCAD code, worker or selector.
   Then (r23): moving a free-form face (translate / rotate) joins its offset: the extended surface
   patch, transformed by the move with the full build, cuts the column (fixture
   `move-extrusion-face`, 49,600.03 mm³, 6 faces; FreeCAD fails the family). Offset / move face
   now covers every surface kind on both the moved face and its neighbours; the last refusal is a
   neighbour patch that cannot reach the moved surface, which FreeCAD refuses too. The archives
   were restored into scratch and checked: 2,399 files, all 114 Python modules parse, the
   translator and bridge sources intact. The host binary with the optional FreeCAD path was
   built, but the Studio server tree also carries other sessions' unreleased work (store, schema,
   uploads, Drive copies, admin directory) and that binary's own `verify-store` refuses the live
   store, so it was not promoted; the installed host keeps accepting a configured FreeCAD path
   that the worker ignores. Nothing in the product calls FreeCAD. Installed r23 (both UI
   harnesses pass). The four stale appearance tests (presets, panels) now assert the current
   defaults-based recipe; the suite viewport theme test uses an appearance without manual colours,
   since a manual colour outranks the theme. Final app suite after r23: 274 files, 1,726 tests pass,
   1 skipped, 0 failures. Installed r19 (both UI harnesses pass);
   benchmark r19 (headed): plate preview 75–79 / Apply 19–21 (engine 2.3–2.6 / 16), ten holes
   74–78 / 61–65 (engine 3.1–3.4 / 56–60); FreeCAD 616–636 / 528–835 cold, 14–17 warm from its
   server cache.
   Feature by feature (the twelve-tool UI harness, each Apply a full rebuild of the growing
   history, engine ms as the app reports them; FreeCAD run with the engine forced,
   `AETHER_TOOLS_ENGINE=freecad`, two host builds per Apply):

   | Tool | Aether | FreeCAD |
   |---|---|---|
   | Extrude (new) | 114 | 875 |
   | Extrude (remove) | 130 | 1,192 |
   | Extrude (add) | 138 | 1,351 |
   | Extrude (intersect) | 133 | 1,376 |
   | Revolve (new) | 135 | 1,588 |
   | Fillet | 164 | 1,616 |
   | Shell | 163 | 2,217 |
   | Mirror (add) | 181 | failed: "mirror did not produce a valid solid" |
   | Pattern (linear) | 161 | failed: its source is the mirror, which FreeCAD had not built |
   | Boolean (union) | 169 | 5,699 |
   | Hole | 167 | 2,673 |
   | Revolve (remove) | 170 | 3,564 |

   FreeCAD cannot mirror the shelled, filleted body the harness builds (its run continued past
   the failure with `AETHER_TOOLS_TOLERANT=1`, so the later tools are measured on the un-mirrored
   body); Aether completes all twelve, 5–34× faster per Apply. Six app tests unrelated to the engine
   (environment presets, suite viewport theme, material and visualization panels) were already
   failing before this work and still are.

## What the references carried (deletion inventory, 2026-10-20 — closed)

Deleting FreeCAD and SolidCraft means more than the geometry kernel:
- `freecad-engine/browser/*` (23 TypeScript modules: conics, pierce, regions, fixed geometry)
  are the product's own sketch and document maths, imported by 66 files; they move into
  `aether-engine/src` first.
- `sketchRegions` moved out of `src/freecad-translate.ts` into `aether-engine/src/document/sketch-regions.ts`
  (`@aether/core/document`); the feature dialogs, the region picker and the sketch workspace no
  longer import the translator. `translateDocument` goes with the worker.
- Assemblies: now in-process (above); coupled mates are refused on both engines (proved, above).
- Offset / move face: planar, cylindrical, spherical, conical and toroidal faces and neighbours
  in-process (r19); free-form neighbours through the full build's splitter where a patch can
  bound the region (r20). Refused on Aether: moving a free-form face, and raising a face beside
  a free-form neighbour. FreeCAD's BRepOffset_MakeOffset is the reference for those and failed
  the loft cases tried (BOP check errors); no proven loss either way.
- Automation (done, r21): the CAD product worker (`service/aether_cad_service`, the Python
  archive the Rust host spawns) no longer builds with FreeCAD. The Node runner
  (`src/automation/runner.ts`, `engine-node.ts`) carries the Aether engine with its wasm beside
  the bundle and answers `build`, `analyze`, `export`, `assembly_solve` and `engine` phases;
  the Python side orchestrates commands, programs, assemblies, projects and settings and asks
  the runner for every geometric answer. The host's `/api/cad/geometry`, `export` and `analysis`
  routes answer 410: the editor builds in-process. The host no longer needs a FreeCAD path
  (`AetherStudio/crates/server/src/products.rs`). Ports found on the way: exact rho conics,
  connected sketch regions as profiles, sole-curve sweep paths, pierce resolution in the
  evaluator, and a shell whose opening plane matches no face now refuses. Service suite:
  programs, verify, topology, pierce, conics, connected profiles, ellipse manipulation and
  projects pass through the Aether-backed worker; the feature-list geometry service tests
  were archived (`AetherStudio/migration/archive/retired-service-tests-20261020`). With no server-side geometry (the
  rule), agent programs must build in the live workspace (`automation/live-workspace.ts`
  already does) and the host runner's build phases are retired with the service.
- Studio: the `/api/cad/*` product service, the CAD worker admission and settings
  (`crates/server/src/native/product_services.rs`, `admission.rs`, `cad_settings*.rs`,
  `products.rs`), their tests and the FreeCAD worker config in installations.
- SolidCraft: deleted after r18 (archived in `AetherStudio/migration/archive/solidcraft-bridge-20261020.tar.gz`);
  the benchmark harness now compares Aether and FreeCAD.
- Settings → Modeling engine selector and the translator-contract tests: deleted with the
  FreeCAD reference (r22). Tests that mixed document behaviour with translation kept their
  document half; the translator-only ones were archived. App tests that pinned FreeCAD now run
  the Aether engine in-process under Node (`kernel/in-process-client.ts`).
1. Extrude complete (up-to-*, offsets, drafts, thin, scope, references) · revolve · hole.
2. Fillet, chamfer, shell, draft, mirror, pattern, boolean, transform, offset/move-face,
   face-extrude, loft, sweep, pierce, fixed sketches, sketch-on-face.
3. Analysis (measure, section, interference, properties), import (STEP/IGES/mesh), export.
4. Delete FreeCAD worker, Python runner, `/api/cad/*` geometry routes, SolidCraft bridge.
5. Desktop shell (Rust) hosts the same worker; Node headless runner for agents and CI.

## Left to the builder

- OCCT toolkit list and build recipe for the custom wasm; whether replicad stays as a thin
  helper or is dropped once raw-OCCT helpers cover its use.
- Cache eviction policy and memory ceiling per document.
- Exact naming scheme encoding and migration of ids in saved references (saved documents hold
  FreeCAD-era face ids; a one-time remap on first rebuild, verified by the oracle).
- Order of ports within phases 1–2 (suggest: by frequency in the library).

### r24 (2026-10-21): individual edge and face picks, after the SolidCraft tool review

Installed r24 on 2026-10-21 (both UI harnesses pass; engine suite 986, app suite 1,729).

SolidCraft's tool contracts (`dev/docs/roadmap/SolidCraft_Tool_Parity.md`, tracker in
`Tool_Parity_Tracker.md`) pick edges and faces one by one; ours pinned a plane. r24 adds:

- Fillet and chamfer take `edges: EdgeFinishEdge[]`: a straight edge by its two vertex anchors
  (signature first, exact position as the tie-break, as the stopping vertex already did), any
  other edge by midpoint and length in body coordinates. A pick that no longer matches refuses
  ("changed or is missing. Reselect"), never the nearest edge. The plane pin stays for saved files.
- Fillet also takes a radius per pick and a variable radius (`endRadiusMillimeters`); chamfer a
  second distance or an angle with a reference face (picked, or the adjacent face facing up most),
  through replicad's radius configuration (OCCT `Add_3` / `AddDA`).
- Draft takes `faces: SolidFaceReference[]` (several planar faces tilted together) and
  `neutralFace` (a picked planar face; the pull direction points from it into the part, so the
  bottom of a box drafts exactly as the XY plane does). Shell takes `direction` inside / outside /
  both: outward walls are built with OCCT's intersection join so corners stay sharp, and "both"
  fuses an inward and an outward half wall. Shell's dialog offers the face references its
  evaluator already resolved.
- Mirror takes `mirrorPlane` (a plane feature or a picked planar face, `MirrorPlaneReference`), and
  a `mirror` transform kind mirrors whole parts into new bodies (ribbon: Mirror › Mirror parts),
  reusing the transform feature's copy outputs so every body-history site already understands it.
- Pattern takes a `direction` (vector or picked straight edge) and a `second` row, `alignment`
  (original first, middle or last), and a polar `axisReference` (line or picked edge); references
  resolve through the transform's own line resolver, so a moved edge follows or refuses the same way.
- One picked-references box (`src/features/picked-references.ts`) serves the dialogs; the
  viewer builds every reference (`selectedFinishEdges`, `selectedOffsetFaces`).
- Also carried: the Part list toggle uses the folder icon (cross-app standard set this morning).
- Proof: `part-evaluator.test.ts` "finishes only the picked edges" (box edge, cylinder rim,
  stale pick refused) and "drafts and shells by picked face references"; the shipped examples
  build on the engine (`src/modeling/examples-build.test.ts`); the Scifirobot proof still 66/66.

### r25 (2026-10-21): revolve axis, sweep options, loft apex

Installed r25 on 2026-10-21 (both UI harnesses pass).

- Revolve takes `axisReference` (a picked straight edge, a sketch line, two points, or a line given
  outright) in place of the principal axis through the origin.
- Sweep takes `orientation` (square to the path, as drawn, or square with a fixed up direction),
  `endScale` (a linear `Law_Linear` along the path) and one `rail` (OCCT's auxiliary spine), built on
  `BRepOffsetAPI_MakePipeShell` directly when any option is set. Loft takes `startPoint` /
  `endPoint` apexes (a picked vertex, sketch point or a given point).
- Proof: "revolves about a picked straight edge or a given line" (ring volumes) and "sweeps with a
  fixed orientation and an end scale, and lofts to an apex point" (7/3 law volume, pyramid volume).
  Engine suite 988, app suite 1,729 on this source.

### r26 (2026-10-21): construction axis feature

Installed r26 on 2026-10-21 (both UI harnesses pass).

`aether-engine/src/document/construction-axes.ts`: an `axis` feature with SolidCraft's four
constructions (through a straight edge, through two points, normal to a plane through a point,
where two planes meet), resolved by `resolveAxisLine` against the features before it, the way plane
features resolve. Picked edges and points are captured at pick time (the plane feature's rule).
Revolve and pattern accept `{kind: "feature", featureId}` axis references. The viewport draws each
axis as a dashed line through the model; the tree names the method; `src/axis-window.ts` authors it
with the plane window's pick events (ribbon: Solid › Construction › Axis …). Not yet: an axis through
a cylinder, cone or torus (needs the curved-face axis from the kernel) and point features.

### r27 (2026-10-21): hole placement, split body, replace face, delete face

Installed r27 on 2026-10-21 (both UI harnesses pass; engine suite 991, app suite 1,729).

- Hole: `placement` (a point on a picked planar face, drilled into the part) and `allCircles` (one
  hole at every circle of the sketch); the sketch becomes optional.
- Split (`split`): the plane's two half-spaces as boxes turned onto the plane; the negative piece
  keeps the target's identity, the positive one takes a recorded copy identity, so every body-history
  site treats a split like a transform copy.
- Replace face: `offset-face.replaceWith` (a parallel plane); the distance is computed at build from
  the first face's centre, then the offset path runs unchanged.
- Delete face (`delete-face`): OCCT `BRepAlgoAPI_Defeaturing` in the full build (lazy, as for
  non-uniform scale); faces are found again in the converted shape by their centres of mass.
- Proof: "drills a hole at a picked face point, and one at every circle of a sketch" and "splits a
  body, replaces a face with a plane, and deletes a face" (volumes 2000/4000, 9000, 6000 healed).

### r28 (2026-10-21): pipe, bounding solid, cosmetic thread

Installed r28 on 2026-10-21 (both UI harnesses pass; engine suite 993, app suite 1,729) — see the chain record.

- Pipe (`pipe`): a circle square to the path at its start swept along the sketch curve, hollowed by
  the same sweep at the inner radius; new / add / cut through the tool chain.
- Bounding solid (`bounding-solid`): the box around every part (or a chosen list) grown by a margin,
  as a new part.
- Thread (`thread`): cosmetic only, an ISO metric designation on a cylindrical face; no geometry,
  listed in the tree. Rib and web are SolidCraft's names for a thin extrusion of open curves up to
  the next face, which Extrude already does.
- Proof: "builds a pipe along a path, a bounding solid, and a cosmetic thread" (π·25·40, hollow
  π·16·40, 32×22×12).

### r29 (2026-10-21): sketch variants, collinear, AutoConstrain, DXF export

Installed r29 on 2026-10-21 (both UI harnesses pass; engine suite 998, app suite 1,729).

- Six point-driven shapes in the core variant table (`aether-engine/src/sketch/primitives.ts`): 2-point
  circle, rounded rectangle (corner radius input), edge polygon, and three slots (centre to centre,
  overall, centre point; a width input). The drawing tool, preview and workspace pass the two new
  settings; the ribbon lists each under its family.
- `collinear` constraint: parallel plus b's start on a's line (two residuals), in the catalogue.
- AutoConstrain (`autoConstrainDrawing`): horizontal/vertical within 2°, coincident open endpoints
  within 0.05 mm, each relation once; ribbon Constrain group.
- Save as DXF (`sketchDrawingToDXF`): lines, circles and arcs exact, other curves as polylines,
  construction geometry on its own layer; round-trips through our DXF import.
- Intersect and Include 3D edges (`sketchSectionContours`, a `sketch-section` kernel request): the
  part's section at the sketch plane (`BRepAlgoAPI_Section` with the plane) or the body edges lying
  in it, returned as exact sketch contours (lines, circles, arcs; other curves sampled) and inserted
  by the Project tool's variants. Non-associative, as a first step.
- 2- and 3-tangent circles: a circle placed near the picked curves, tangent relations to each (and
  the radius for the two-curve form) composed through the constraint path and solved; no new
  geometry code, the solver does the placement.

### r30 (2026-10-21): the rest of SolidCraft's construction planes

Installed r30 on 2026-10-21 (both UI harnesses pass; engine suite 1,000, app suite 1,730).

`PlaneDefinition` gains `perpendicular` (holds an edge, square to a plane), `two-edges`, `tangent`
(a `SurfacePointReference`: the clicked point on a curved face and the mesh normal there, captured at
pick time like the plane window's other picks) and `along-path` (a straight edge at a fraction
along it; `AxisReference.lengthMillimeters` now rides with edge picks). The plane window lists all
eight methods; the viewer remembers the last face hit for the tangent pick.

Point features (`aether-engine/src/document/construction-points.ts`, `point` type): at a vertex,
through two edges (closest points), through three planes, at a circle's centre, at an edge and a
plane, along a straight edge; drawn as markers, authored in `src/point-window.ts` (the axis
window's anatomy). A circular edge pick now carries the circle's axis (`measurements.axisDirection`),
so Axis Through Cylinder is the axis window's edge method with a rim pick.
- Coil (`coil`): replicad's helix swept with a round section (Frenet frame). Remove part
  (`remove-body`): bodies leave the history from the feature on (consumed in body history). Mirror
  transform `combine` joins the image with the original. Pattern type `path`: copies at equal arc
  length along a sketch curve, kept as drawn or turned to the path's tangent.

### r31 (2026-10-21): the smaller parameters SolidCraft's tools carry

Installed r31 on 2026-10-21 (both UI harnesses pass; engine suite 1,002, app suite 1,730).

Draft `pullDirection` (the mould opening direction, separate from the neutral plane), hole
`direction` (a drill vector, mirrored into the face when it points out), split by a sketch line
(`MirrorPlaneReference` kind `sketch-line`: the plane through the line along its sketch's normal),
the chamfer reference-face pick, the replace-face target-face pick, and the bounding solid's chosen
part list. Proof: "drafts with a pull direction, drills along a direction, and splits by a sketch line".
- Tangent chains: edge finishes follow edges tangent-continuous with a pick (OCCT already does
  this for fillets; `tangentChain` makes it explicit), and Shell opens faces joined smoothly to a
  picked face, one hop (a round is smooth to both its neighbours, so following further would open
  the whole part). Pattern takes `bodyIds` + `copyBodyIds`: every placement of every chosen part is
  a new part `${copy}:${i}`, and body history treats a part pattern as a producer.
- Installed as r32 on 2026-10-21 (both UI harnesses pass; engine suite 1,004, app suite 1,730).
- Align (transform kind `align`): the from face's centre and normal (or a point) brought onto the
  to face (or point); faces are turned to face each other, or the same way with `flip`. Loose
  ends (`looseEnds`): open path ends nothing touches or ties, selected for the user. Change sketch
  plane is now a ribbon command (the plane chip's × did this unseen).

### r33 (2026-10-21): analysis display modes

Zebra and draft analysis as display styles (`CADDisplayStyle`): TSL node graphs on the part
materials' `colorNode` (`src/viewport/surface-appearance.ts`; the viewer renders with three/webgpu,
where `onBeforeCompile` shader patches do nothing, which the first r34 harness run showed as an
unchanged viewport), stripes from the reflected view vector, draft colouring from the world normal
against +Z within 1°. The harness step now asserts the viewport pixels change. View tab, command palette and the tools
harness (`display-analysis` step with screenshots) carry them. r33 was held back by that step: the
camera menu's style table had no entry for the new styles and its label lookup blanked the shell;
the table now lists them and the lookup is safe, with a test that every accepted style is labelled.

### r34 (2026-10-21): plastic boss and rest

`aether-engine/src/document/plastic.ts`: Boss (a round post on a picked face point, drafted as a
frustum, optionally bored from its top) and Rest (a round pad, or a rectangular one lofted between
its base and drafted top), fused into the face's part. Rib and Web stay Extrude › Thin to the next
face. Proof: "raises a plastic boss and a rest on a picked face point" (exact volumes).
- Sketch window: "Use fixed plane" when a face cannot be attached durably (the refusal now carries
  the face's frame), and "Project face edges on start" (the Include 3D edges request run as
  construction geometry when a sketch starts on a face).

### r35 (2026-10-21): analysis overlays drawn by the WebGPU renderer

Installed. r33's zebra and draft views set `onBeforeCompile`, which `three/webgpu` ignores, so the
viewport did not change (r34 held the same bug). The overlays are now TSL node graphs on the
material (`colorNode`: stripes from the reflected view vector, draft tint from the world normal),
and the tools harness asserts that switching to each analysis style changes the canvas pixels and
that "Shaded with Edges" restores them.

### r36 (2026-10-21): the eight kinematic mates

Installed.

The in-process solver gains planar (origin in the plane, normals aligned) and pin slot (a revolute
that also slides along the slot's x), eleven kinds in all. The Assembly workspace codec
(`Aether-Animation/aether_animation/aether_workspace.py`, the Python that stores assemblies; it
computes no geometry) now accepts and advertises every kinematic `JointType` — fastened, revolute,
prismatic, cylindrical, ball, planar, pin_slot, parallel — instead of the three of Assembly v1, so
the mate dialog, the ribbon and saved assembly recipes offer all eight. Distance, perpendicular and
angle still solve but have no workspace record, so their buttons stay greyed with that reason; width
and tangent need surface geometry the solver does not hold. The picker/workspace/ribbon contract test
(`service/tests/test_mate_capability_contract.py`) pins the three lists to each other.

Also in r36: SolidCraft's sketch `flip`. A profile may carry `flip: "x" | "y"`, a half turn about its
own axis applied on top of whatever frame it has (principal plane and offset, an explicit frame, or
a followed face), so the normal and the default extrude direction reverse. One frame authority
(`flipSketchFrame`/`profileFrame` in `construction-planes.ts`) serves the evaluator, which now records
every sketch's frame for the features that read it, and the region picker, plane geometry and the
sketch window's surface; the window has a "Flip sketch plane" box.

Also in r36: SolidCraft's two arc slots. `center-arc-slot` (centre, start, end direction) and
`three-point-arc-slot` (start, through, end on the centre arc) build a path of two concentric arcs
and two semicircle caps from the slot width box, like the straight slots; the through point or the
clockwise option chooses the way round.

Also in r36, four sketch tools from SolidCraft's list: **Break** (the clicked curve split at every
crossing with another curve, circles included, each split applied as Split does so point constraints
survive), **Infinite line** (selected single lines become construction lines drawn across the whole
view; the segment itself stays the solver's and the picker's), **Chain** (select every edge joined end
to end to the selected one, along and across paths) and the **Polygon** constraint (the lines of one
closed chain get equal sides and every corner coincident with one construction circle; the solver
places the rest). Each is one operation in `aether-engine/src/sketch/operations/` with a test, a
selection command and a ribbon button.

### r37 (2026-10-21): Finish with AutoConstrain, @aether/ui alpha.203

Installed.

One button runs AutoConstrain then the sketch's own Finish (SolidCraft's `finish_auto_constrain`).
The shared UI moves from alpha.201 to alpha.203: right-click "Toolbar settings" (density radios and
more-items) on the classic workspace ribbon as well as the Studio bar, per Jonathan's direction that
the standard/compact/expanded density reach every toolbar including CAD; the folder icon change
rides along. Vitest's hook and test timeouts were raised (60 s / 30 s) because the dom suites' heavy
workspace imports timed out under full-suite load and refused the build twice; no test logic changed.
Two things the bump surfaced: alpha.203's FeatureWindow floats its notices (`.aui-feature-notices`)
above the panel in `document.body` instead of inside it, so the dom tests that read a window's error
now read the page (product code never read the element; the models harness already reads the page).
And a root `npm install` re-resolved the engine's `opencascade.js` from `^2.0.0-beta.b5ff984` to a
newer beta with a different file layout (no `dist/node.js`), which broke every full-build test; the
engine now pins the exact build and the root lock names it, so installs stay on the proven wasm.

### r38 (2026-10-22): surface modeling, first slice

Installed (promoted with a failing tools harness; r39 corrected that).

Sheets (zero-thickness surface bodies) are shells in the same body map, tree and body list as
solids (`aether-engine/src/document/surface.ts`): Surface Extrude, Surface Revolve, Surface Loft,
Patch, Surface Sweep and Offset Surface make one; Thicken turns sheets into a solid (new, add or
cut); Stitch sews sheets into the first (a solid when they close); Unstitch publishes a body per
face; Reverse Normal turns a sheet over. Built on OCCT calls proven in a spike against the single
wasm (`BRepPrimAPI_MakePrism`/`MakeRevol` on wires, `BRepOffsetAPI_ThruSections`, `MakeFace`,
`BRepBuilderAPI_Sewing`, `MakeOffsetShape`, `MakeThickSolid.MakeThickSolidBySimple`,
`TopoDS_Builder` for a one-face shell). The spike also showed what this build will not do: a
boolean between a shell and a solid returns nothing (so Trim, and later Untrim and Split Face,
wait for `BRepAlgoAPI_Splitter`/`BRepFeat_SplitShape`, which the build lacks), and
`MakeThickSolidByJoin` on a sheet with a sharp corner yields an open shell, so Thicken uses the
simple offset and leaves such corners unjoined. The viewport's part material was already
double-sided, so sheets draw from both sides. Tests: `surface-features.test.ts` (areas, bounds,
a box sewn from walls and two patches reaching 1000 mm³).

### r39 (2026-10-22): Ruled and Extend surfaces; every dialog's button connected

Installed; the tools harness now creates a sheet and thickens it in the browser.

Ruled Surface lofts each picked edge (ruled) to its own copy moved by the reach — square to the
surface at the edge, continuing the surface away from it, or along a given direction — and sews
the strips; Extend sews tangent strips past a sheet's picked boundary edges in place. The r38 tools
harness caught a bug older than the surface work: feature commands were registered from a
hardcoded list of types, so the ribbon buttons of every dialog added since (pipe, coil, boss, rest,
thread, bounding solid, remove body, split, delete face, and the surface tools) read "Command is
not connected" in the live app. Registration now covers every editor in `src/features/`. r38 had
already been promoted because the chain did not gate the promote on the harness exit; it does now.

### r40 (2026-10-22): Boundary, Blend and Untrim surfaces

Installed.

Boundary fills one face across a loop of two to four picked body edges (replicad's
`makeNonPlanarFace`, OCCT `BRepOffsetAPI_MakeFilling`, position continuity); Blend fills one face
between two picked edge chains, closing the loop with two straight lines on the side that keeps
them apart; Untrim rebuilds a picked face from its outer wire (`BRepTools.OuterWire`) so its
holes close, and sews the body's other faces back around it (a one-face sheet is its own
target). The tracker marks all three partial: no tangency continuity, no sketch-curve loops for
Boundary, no chosen-holes-only Untrim. Fair and Match stay gaps (no fairing in the build; Match
needs the continuity machinery). Picked-edge resolution is now one helper (`pickedEdgesOf`) shared
by Ruled, Extend, Boundary and Blend.

### r41 (2026-10-22): sheet metal, first slice

Installed; the harness makes a sheet metal plate and runs the flat pattern export. The browser also
caught that new-body surface and sheet features were missing from the dependency graph's list of
body producers (so the sheet base read as a modifier of a missing body); every feature with
`operation: "new"` is a producer now, pinned by `new-body-producers.test.ts`.

The rule (thickness, inner bend radius, K factor) lives on the sheet metal base, a plate extruded
from a sketch by the thickness. Flange and Hem bend from picked edges of a flat face: the bend's
cross-section (an annular sector of inner radius r and outer r + t, then the straight leg) is drawn
in the plane square to the edge and extruded along it, fused into the body; a hem is the same bend
at 180° with the gap as inner radius. Unfold rebuilds the body from the base plate plus each bend
laid flat as a strip of leg + bend allowance (angle · (r + K · t)); Refold restores the folded body
from the cached step before the unfold. Flat pattern DXF sections the sheet at mid-thickness in the
base's sketch plane and writes the outline with the sketch DXF writer. Tests pin the volumes
(plate + annular sector × edge length + leg) and extents. Not built: contour/base flanges, reliefs,
folds along a sketch line, bends on bends in the flat pattern, a named rule library, perforate,
the bend table. Lesson from the tests: replicad's `Plane(origin, xDir, normal)` has y = normal × x,
so a section whose y must be the face normal takes the edge direction reversed as its normal.

### r42 (2026-10-22): Fold along a sketch line

Installed.

Fold splits the sheet with three slabs along the line's normal: the fixed side, a strip one bend
allowance wide, and the moving side. The strip is replaced by the bend sector over its span along
the line; the moving side slides back by the strip's width and turns about the bend's axis. A fold
leaves the flat pattern as the plate, so Unfold ignores it. Known limit: a cut-out crossing the
strip is not carried into the bend. The bend section's plane now takes `o × n` as its normal so
its y axis is the face normal whichever way the edge or line runs (the flange code had relied on
the pick's orientation).

### r43 (2026-10-22): Configurations

Installed. The first harness run failed at the hole step ("Cut removes no material" in the dialog's
preview) and passed unchanged on the rerun: the hole dialog's preview can lag the harness's value
changes, a timing flake to watch rather than a regression.

A configuration table on the part document (`aether-engine/src/document/configurations.ts`):
columns are variables (their expressions) or features (suppressed or not), rows are named value
sets taken from the current design; activating a row writes its values back (suppression through
`setFeatureSuppressed`, so dependents follow) and the table records the active row and whether the
design still matches it. The Manage tab's Configurations button opens a compact window over the
table; edits are a draft committed with Apply. Not built: material and appearance columns,
preview-without-applying, and configuration rules.

### r44 (2026-10-22): Inspect — clearance, compare, curvature map, accessibility

Installed.

Two engine analyses beside interference: Clearance measures each body pair's shortest distance
(`measureDistanceBetween`, zero when they overlap) and Compare splits two bodies into only-in-A,
only-in-B and shared volumes, showing the differences and calling the bodies identical within a
tolerance. Two display styles beside zebra and draft: a curvature map (the screen-space turn of
the world normal, blue through green to red) and accessibility for a +Z tool (reachable faces
green, undercuts red, walls yellow). Both are TSL node graphs like the earlier overlays.

### r45 (2026-10-22): driven mate values and DOF relations in the solver

Installed.

The in-process assembly solver now holds a mate's driven degree-of-freedom values (the workspace's
DOF Value: a rotation in degrees about, or a travel in millimetres along, one axis of the mate's
first frame) and couples mates through the workspace's relations — gear (rotation to rotation),
rack and pinion and screw (rotation to travel), linear (travel to travel): driven = ratio · driver
+ offset, reversed negating the ratio. The job builder carries the values and relations across
with the unit change (radians and metres to degrees and millimetres); the Gears, Rack and Pinion
and Screw buttons open the Relation dialog. Values and relations are residuals beside the mate
residuals, so the acceptance check covers them. A rotation driven to exactly 180° sits on the
angle wrap and may not converge.

### r46 (2026-10-22): exploded view and motion study

Installed.

Explode solves the assembly and shows every instance pushed away from the centre of the placements
by its own offset; Explode again reassembles (display only, the design keeps its placements). The
motion study window drives one mate degree of freedom from a start to an end value over N steps,
solves each step in-process through the driven-value residuals of r45, plays the placements in
the viewport and exports a CSV of every step. Both sit on `src/startup/assembly-motion.ts`, pure
over a solver job and tested there.

### r47 (2026-10-22): parameters — comments, favourites, order, exchange, users, graph, completion

Installed (the tools harness passed on its retry; the hole step flaked once more).

Variables carry a comment and a favourite flag. `aether-engine/src/document/variable-tools.ts`
answers who uses a variable (parameters and features whose expressions mention `#name`), builds
the dependency graph with cycles and unknown references, reorders variables, exports and imports
CSV or JSON, and completes an expression prefix with parameters, the expression language's ten
functions, units and constants. The sketch variables panel shows the comment and star per row,
the count of users, Export and Import CSV, and a completion datalist on each expression field.
The timeline folder rows were stale: the feature tree has created, renamed and dissolved folders
since the tree organization landed; they are marked parity-ish (no agent command).

### r48 (2026-10-22): timeline copy and paste

Installed; the hole step passed first time with the fresh-preview change.

`copyFeatures` clones chosen features under new identities and inserts them at the marker in
timeline order; every string in a clone that names a copied feature, or a body one of them made,
is rewritten to the copy, so a pasted extrude points at the pasted sketch while references outside
the set stay. Copy features / Paste features commands act on the feature selection. No translate
yet, and no pasting across documents. The tools harness's hole step now asks for a fresh preview
after its last value, which is the flake's likely cause.

