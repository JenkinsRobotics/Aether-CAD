# Native construction benchmark

This is developer tooling, outside the product runtime. It times editable
sketch/extrude/revolve histories on the Aether engine. The FreeCAD 1.1.3 and
SolidCraft 0.23.0 reference runners were retired on 2026-11-12 (archives:
`../AetherStudio/migration/archive/freecad-benchmarks-20261112.tar.gz` and
`solidcraft-benchmarks-20261112.tar.gz`); their recorded results stay in
`dev/docs/reality/data/`. No imported solids stand in for authored features. The
robot front Part comes from `public/examples/scifirobot.aethercad.bin`; it is
never rewritten by a benchmark.

From the CAD repository, with dependencies installed:

```sh
python3 scripts/benchmarks/native/fixtures.py
node scripts/benchmarks/native/build-aether.mjs
BENCH_VARIANT=obb node scripts/benchmarks/native/build-aether.mjs
BENCH_VARIANT=no-history node scripts/benchmarks/native/build-aether.mjs
BENCH_VARIANT=no-simplify node scripts/benchmarks/native/build-aether.mjs
python3 scripts/benchmarks/native/run.py
python3 scripts/benchmarks/native/summarize.py
```

The sketch-solver benchmark solves the same constrained sketches (a dimensioned
rectangle plus 0, 20 and 100 circles with radius and two distances) after a
width edit, in our solver and in FreeCAD's PlaneGCS compiled to wasm;
`BENCH_CIRCLES` and `BENCH_RUNS` change the sizes and rounds:

```sh
npx vite-node scripts/benchmarks/native/solver.ts
```

`BENCH_CASES` selects fixtures and `BENCH_SAMPLES` changes the sample count; the
summarizer deliberately requires all five samples of the four fixed fixtures.
`BENCH_RUNS` controls the standalone Aether runner, not the coordinator's number
of processes.

The constructor timers exclude imports, WASM initialization, input file reads,
fixture authoring and final display generation. Aether clears its replay cache.
Each sample runs in a fresh process; cold JIT/thread-pool costs can therefore be
inside the first construction timer. Samples run serially. Other desktop
applications are not closed.

Aether's display timer includes analytic faces, snapping anchors, surface/edge
meshes and buffer copies, at 0.1 mm maximum linear deflection and 0.2 rad
angular deflection. It is **not a viewport/FPS measurement**. GPU, app-shell
loading, picking, RAM and large-assembly throughput require separate workflows.

Repeat is same-process cache reuse. The same extrusion length edits are timed
across the three small fixtures. The robot edit raises its final gasket plane
from 0.6 to 1.6 mm and must change volume. Simple fixtures have independent
analytic volume checks.

The OBB, no-history and no-simplify variants modify the **benchmark bundle only**, through a
checked Vite transform at the OCCT boolean configuration. They do not change
production defaults, tolerance, saved features or app installations. Preserve
raw evidence under `build/native-comparison/`; the portable results are `summary.json`
and `front-shell-profile.json`, copied into `dev/docs/reality/data/` for each report
(`dev/docs/reality/Native_Comparison_2026_10_31.md`).
