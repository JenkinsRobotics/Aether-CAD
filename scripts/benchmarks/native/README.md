# Native construction comparison

This is developer tooling, outside the product runtime. It constructs editable
sketch/extrude/revolve histories in Aether, SolidCraft 0.23.0 and FreeCAD 1.1.3.
No imported solids stand in for authored features. The robot front Part comes
from `public/examples/scifirobot.acad.bin`; it is never rewritten by a benchmark.

From the CAD repository, with dependencies installed:

```sh
python3 scripts/benchmarks/native/fixtures.py
node scripts/benchmarks/native/build-aether.mjs
BENCH_VARIANT=obb node scripts/benchmarks/native/build-aether.mjs
BENCH_VARIANT=no-history node scripts/benchmarks/native/build-aether.mjs
```

Build the supplied reference separately (Rust and network package access needed):

```sh
CARGO_TARGET_DIR="$PWD/build/comparison-solidcraft-target" cargo build --manifest-path reference/solidcraft-main/Cargo.toml --release --locked -p solidcraft-cli --no-default-features
python3 scripts/benchmarks/native/prepare-solidcraft.py
python3 scripts/benchmarks/native/run.py
python3 scripts/benchmarks/native/summarize.py
```

FreeCAD's Python defaults to `/Applications/FreeCAD.app/Contents/Resources/bin/python`;
set `FREECAD_PYTHON` for another installation. It must resolve that installation's
FreeCAD, Part, Sketcher and MeshPart modules. `BENCH_CASES` selects fixtures and
`BENCH_SAMPLES` changes the sample count; the qualification summarizer deliberately
requires all five samples of the four fixed fixtures. `BENCH_RUNS` controls the
standalone Aether and FreeCAD runners, not the coordinator's number of processes.

The constructor timers exclude imports, WASM initialization, input file reads,
fixture authoring and final display generation. Aether clears its replay cache;
FreeCAD recomputes a newly created Sketcher/PartDesign history; SolidCraft opens
its saved native history with `SOLIDCRAFT_NO_MODEL_CACHE=1` and must report every
feature recomputed. Each sample runs in a fresh process; cold JIT/thread-pool
costs can therefore be inside the first construction timer. Samples run serially,
with Aether/FreeCAD order alternating. Other desktop applications are not closed.

Aether's display timer includes analytic faces, snapping anchors, surface/edge
meshes and buffer copies. FreeCAD's display column is MeshPart meshing only.
SolidCraft uses its normal body mesh preparation. These columns describe different
work and are **not a matched viewport/FPS contest**. Aether and FreeCAD use 0.1 mm
maximum linear deflection and 0.2 rad angular deflection here; SolidCraft retains
its native defaults. GPU, app-shell loading, picking, RAM and large-assembly
throughput require separate matched workflows.

Aether/FreeCAD repeat is same-process cache reuse. SolidCraft cachedOpen is a new
process adopting a saved model; these are intentionally distinct series. The
same extrusion length edits are timed across the three small fixtures. The robot
edit raises its final gasket plane from 0.6 to 1.6 mm and must change volume.

All reference sketches are fixed to the supplied coordinates. The three basic
Aether fixtures are fixed too; the robot retains its existing center/diameter and
fixed-meridian constraints. This is not a matched sketch-solver benchmark.
Simple fixtures have independent analytic volume checks. SolidCraft's reported
volumes come from tessellation: the summarizer retains the actual error rather
than claiming exact equality. The robot's small Aether/FreeCAD reported-volume
difference remains an explicit limitation; no exact boolean-equivalence proof is
claimed. Failed reference commands remain failures, with their logs retained.

The OBB and no-history variants modify the **benchmark bundle only**, through a
checked Vite transform at the OCCT boolean configuration. They do not change
production defaults, tolerance, saved features or app installations. Preserve
raw evidence under `build/native-comparison/`; the portable result is `summary.json`.
