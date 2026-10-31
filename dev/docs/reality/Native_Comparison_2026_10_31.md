# Native construction against SolidCraft and FreeCAD — 2026-10-31

Aether, SolidCraft 0.23.0 and FreeCAD 1.1.3 each build the same editable
sketch/extrude/revolve histories with their own native tools. No imported solid
stands in for an authored feature. Method, limits and commands are in
`scripts/benchmarks/native/README.md`; portable results are
`data/Native_Comparison_2026_10_31.json` and `data/Front_Shell_Profile_2026_10_31.json`.

Measured on an Apple M1 Max (32 GB), five fresh-process samples per engine and
fixture, run serially, CAD commit `a440e6a`. The tree held unrelated uncommitted
example thumbnails; no engine source was modified. Other desktop work was
running, so a few experiment samples are outliers; medians are reported.

## Results (median milliseconds)

| Fixture | Features | Aether solid | FreeCAD solid | SolidCraft solid | Aether edit | FreeCAD edit | SolidCraft edit |
|---|---:|---:|---:|---:|---:|---:|---:|
| Plate | 2 | 23.4 | 2.2 | 20.0 | 1.4 | 1.9 | 0.8 |
| Ten-bore plate | 22 | 144.4 | 128.9 | 257.9 | 7.9 | 20.0 | 60.8 |
| Annular shell | 2 | 42.4 | 1.8 | 2.6 | 3.5 | 1.7 | 1.8 |
| Scifirobot front shell | 76 | **4,865** | 9,269 | failed | **130** | 571 | — |

- **Front shell:** Aether builds the full history in about half FreeCAD's time and
  rebuilds after an edit to the last feature (the gasket plane, 0.6 → 1.6 mm) about
  4.4× faster. SolidCraft fails at feature 10, "Left hub — passage"
  (`boolean Cut: the operation failed: no result`); Aether and FreeCAD complete it.
- **Small fixtures:** Aether's first construction pays a fixed ~20–40 ms that FreeCAD
  does not (first boolean/WASM code paths in a fresh process). It disappears in edits
  and in-process repeats (0.2–1.4 ms).
- **Display preparation is not a matched column.** Aether's (680 ms on the front
  shell) includes analytic faces, snapping anchors, surface and edge meshes and
  buffer copies; FreeCAD's (202 ms) is MeshPart meshing only; SolidCraft's is its
  own body meshing. It still marks Aether's display path as worth profiling.
- **Volumes:** the three simple fixtures match the analytic volumes. On the front
  shell Aether reports 8.18 mm³ (0.0026 %) more than FreeCAD; see "Face unification"
  below for where that comes from.

This reproduces the first run made by another session on 2026-10-30 at commit
`3be5c76` (Aether 4,711 ms, FreeCAD 8,282 ms, same SolidCraft failure). Its raw
samples are kept locally under `build/native-comparison/measured-2026-10-30/`.

## Warm uncached phase — 2026-10-31

`scripts/benchmarks/native/warm.py` keeps each Aether and FreeCAD process alive for four
rounds with the replay cache cleared before every round (three processes per engine,
`data/Warm_Phase_2026_10_31.json`). "First" is round 0 in a fresh process, as the table
above measures it; "steady" is the median of rounds 1–3. Nothing else ran on the machine.

| Fixture | Aether first ms | FreeCAD first ms | Aether steady ms | FreeCAD steady ms | Aether / FreeCAD (steady) |
|---|---:|---:|---:|---:|---|
| plate | 22.7 | 2.1 | **1.6** | **2.2** | 0.75× |
| ten-bores | 144.4 | 140.9 | **68.3** | **127.8** | 0.53× |
| annular-shell | 42.3 | 1.7 | **4.7** | **1.9** | 2.51× |
| robot-front | 4895.2 | 11715.2 | **4558.3** | **9217.9** | 0.49× |

- Aether's fixed first-construction cost (20–40 ms of WASM/JIT warm-up) is gone in
  the steady rows: plate 1.6 ms against 2.2, ten bores 68 against 128, the front shell
  4.6 s against 9.2 s.
- **Annular shell is the one fixture FreeCAD wins** (4.7 ms against 1.9 ms): a two-circle
  profile extruded into a tube. The ~3 ms is our sketch-region and face-building path
  before the native extrude; small in absolute terms, still open.
- Kernel startup: Aether's WASM init is 137–154 ms in Node; FreeCAD's import is
  0.4–0.7 s on the small fixtures. The FreeCAD import measured in the front-shell
  processes (12 s cold, 48–75 s warm) grows with the saved `.FCStd` files in the
  measured directory and is a harness artefact, not FreeCAD's import cost; it is not
  used in any verdict.

## Matched sketch-solver benchmark — 2026-10-31

`scripts/benchmarks/native/solver.ts` and `solver-freecad.py` solve the same constrained
sketch after a width-dimension edit, six rounds alternating 60.5 and 61 mm: a dimensioned
rectangle (closed, fixed corner, horizontal/vertical, width, height) plus a grid of circles,
each with a radius and two distances to the corner. Ours is the damped least-squares solver
the editor uses; FreeCAD's is its Sketcher `setDatum` (which solves) on the same geometry.
Constraint counts differ by the four coincidences FreeCAD needs to close the rectangle.
Raw samples: `data/Solver_Aether_2026_10_31.json`, `data/Solver_FreeCAD_2026_10_31.json`.

| Sketch | Constraints (ours / FreeCAD) | Aether median ms | FreeCAD median ms | Aether / FreeCAD |
|---|---|---:|---:|---|
| 0 circles | 8 / 12 | 0.4 | 0.4 | 1× |
| 20 circles | 68 / 72 | 8.1 | 1.1 | 7× |
| 100 circles | 308 / 312 | 566.0 | 18.5 | 31× |

- Equal at the size of a typical hand-drawn profile; at 68 constraints FreeCAD is already
  several times faster and at 308 constraints 20–40×. Our solve cost grows roughly with the
  cube of the constraint count (a dense Jacobian and no partitioning into independent
  groups), FreeCAD's PlaneGCS partitions and uses sparse methods. This is the one solver
  gap the comparison has found; it matters for sketches of a few hundred constraints,
  not for the fixtures above.
- The PlaneGCS wasm spike (`sketch/solver/planegcs-spike.ts`) returned the sketch unchanged
  for this fixture (the width edit did not apply), so it is not measured here; it is a spike,
  not a product path.

## Where the front shell's time goes

The evaluator's optional observer (`evaluatePartDocument(…, { observe })`) times
every replayed feature. Of 4,886 ms:

| Operation | Count | Total ms |
|---|---:|---:|
| Duct and hub passages (cut) | 12 | 1,624 |
| Recessed mounting seats (cut) | 10 | 1,493 |
| Mounting bosses (fuse) | 12 | 1,463 |
| Everything else (spherical wall revolve, gasket plane, spigot clearance, seating face, 38 sketch profiles) | 42 | 306 |

Each boss, passage or seat costs 80–190 ms because it is a full boolean against
the whole 90-face shell, whose spherical wall every tool intersects. The revolved
wall itself takes 15 ms. Sketch solving is negligible (42 ms for 38 profiles).

## Experiments (benchmark bundles only; production unchanged)

| Variant | Median solid ms | Result |
|---|---:|---|
| Normal build (paired control) | 5,007 | 94 faces, 329 edges, 318,197.08 mm³ |
| No per-boolean face unification | 4,980 | 149 faces, 481 edges, 318,188.94 mm³ |
| Oriented bounding boxes (`SetUseOBB`) | 4,981 | No gain against 4,865 |
| No boolean history (`SetToFillHistory(false)`) | 6,476 (noisy, 3 samples) | No measurable gain; history is needed for stable references anyway |

**Face unification is not the cost.** Every boolean calls
`SimplifyResult(true, true, 1e-3)` on its whole result. Removing it saves nothing
measurable and leaves 55 extra faces, so it stays.

It does explain the volume difference. Without unification Aether's volume
(318,188.94 mm³) matches FreeCAD's (318,188.90 mm³) to 0.04 mm³. The 1e-3 mm
unification tolerance moves merged faces by up to that amount, adding 8.14 mm³ over
this model. That is a lead to examine, not a proven defect: changing the tolerance
alters topology and stable references, so it needs its own correctness checks.

## How to make the front shell faster

In order of expected value for a person editing this Part:

1. **Keep exact solids across opens.** Reopening already reuses cached *display*
   meshes (zero builds, see `Document_Opening_2026_10_29.md`), but the exact solids
   are not kept, so the first edit after opening replays all 76 features (~4.9 s)
   instead of only the changed tail (~130 ms here). Serialising each feature step's
   OCCT B-rep (binary `BinTools`) into the same bounded, source-and-engine-keyed
   IndexedDB cache would make that first edit an incremental one. SolidCraft's
   equivalent cached open measures 0.2–0.5 ms. Cost: storage size per step and the
   same validation the display cache already has.
2. **One boolean for consecutive independent tools.** OCCT's boolean builder takes
   many tools at once and intersects the shell with all of them in one pass. The 34
   duct operations run in runs of disjoint bosses, passages and seats. When
   consecutive features of the same operation have disjoint tools (checkable from
   bounds), they commute and can be one multi-tool cut or fuse. The result and
   per-feature references must be identical; this is a hypothesis to measure, not a
   measured gain.
3. **Profile display preparation.** 680 ms after construction, more than three times
   FreeCAD's meshing-only figure, though it includes more work. Splitting analytic
   faces, anchors, meshing and buffer copies will show what can be deferred or
   cached.
4. **Native OCCT for the worker.** The native worker runs the same OCCT WASM build in
   Node. A native OCCT build, and the planned Rust engine direction, would remove
   WASM overhead and allow OCCT's parallel booleans. Untested here.

Not worth pursuing on this evidence: oriented bounding boxes, disabling boolean
history, or removing face unification.
