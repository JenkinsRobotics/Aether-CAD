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
