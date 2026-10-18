# `freecad-engine` — Aether CAD's FreeCAD geometry engine

**Decision (Jonathan, 2026-09-12): headless FreeCAD is the baseline engine.**
Rather than reimplement parametric features, Aether CAD drives FreeCAD's own
solver and feature set through a small JSON boundary, and keeps that boundary
narrow enough to swap the engine later.

FreeCAD is LGPL-2.1-or-later, © 2001–2026 FreeCAD contributors. See
[ATTRIBUTION.md](ATTRIBUTION.md) — read it before touching this module.

## Shape of it

```
Aether UI  ──►  core/host  ──►  FreeCADEngine  ──JSON lines──►  freecadcmd worker.py
 (browser)       (Python)        engine.py                       (native adapter modules)
                                 protocol.py  ← the contract, in Aether's vocabulary
```

The process boundary:

| File | Runs in | Owns |
|---|---|---|
| `protocol.py` | both | the contract: features, jobs, bodies. **No FreeCAD types.** |
| `engine.py` | Aether's Python | worker lifecycle, JSON exchange, locating FreeCAD |
| `worker.py` and native adapter modules | inside `freecadcmd` | FreeCAD imports, modeling, assemblies, topology, import/export and analysis |

**Why this shape:** `protocol.py` is written in Aether's terms — feature kinds,
millimetres, meshes, face names — so a different engine can satisfy the same
`GeometryEngine` interface without anything upstream changing. That is the
"one day centrally replace" requirement, made structural rather than hoped for.

## Running it

```python
from aether_freecad import BuildJob, Feature, FreeCADEngine

with FreeCADEngine() as engine:
    print(engine.describe())          # {'engine': 'FreeCAD 1.1.3', ...}
    result = engine.build(BuildJob(features=[
        Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
        Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
    ]))
    print(result.bodies[0].volume_mm3)  # 8000.0
```

Native acceptance, from the repository root:

```sh
.venv/bin/python -m pytest 'Aether CAD/freecad-engine/tests' --require-freecad -q
```

The required-engine mode starts the real worker and checks its protocol before
collection. A missing/broken executable fails immediately. Some historical tests
skip without FreeCAD in ordinary mode; skipped tests never establish parity.
This suite does not itself certify frontend authoring, persistence or all of
FreeCAD's workbenches. See the current
[parity acceptance matrix](../../dev/docs/roadmap/FreeCAD_Parity_Acceptance.md).

### Finding FreeCAD

`AETHER_FREECAD_CMD` wins; otherwise `freecadcmd` on `PATH`, then the usual
macOS/Linux install paths. Keeping that override is also how we honour the
LGPL expectation that a user may substitute their own build.

On macOS the console binary is
`/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`. Note that
`Contents/MacOS/FreeCAD -c` is *not* it — that tries to start the GUI and
hangs.

## Two properties worth protecting

**Stateless per job.** The worker opens a document, builds, tessellates, and
closes it before replying. Rollback is a field on the job, not a command to a
retained document. This is what lets a pool of workers serve many users
without per-user affinity, and it is the property to defend when adding
features — an engine that remembers is an engine that needs one process per
user.

**Long-lived process.** FreeCAD costs ~0.25 s to start and ~2 ms to rebuild a
pad, so the worker is kept alive between jobs and restarted if it dies. One
worker per `FreeCADEngine`; a pool belongs in the host when request volume
justifies it, and the interface above will not change when it arrives.

## Known constraints

- **Topological naming.** `face_names` (`Face1`, `Face2`, …) are FreeCAD's own
  sub-element identifiers and are **not stable across rebuilds** — this is
  FreeCAD's long-standing topological naming problem, now ours to handle. Do
  not persist them as feature references. Aether needs its own stable identity
  mapped onto them, the way `engine/src/kernel/exact-topology.ts` does for the
  browser path. Unsolved; the first thing to design before mates or dimensions
  reference engine faces.
- **Feature coverage is a translation layer, not a port.** Native rectangle,
  circle and wire sketches, pad/pocket, revolve, mirror, fillet/chamfer, sweep,
  shell, saved STEP imports, plain/counterbore/countersink Hole, ordered Loft,
  planar Draft, linear/polar feature Pattern and multi-body Boolean exist.
  Each has a deliberately scoped option set; the parity acceptance matrix
  tracks the remaining variants. Every additional feature is a mapping from
  Aether's vocabulary onto FreeCAD's API — which is the work this decision
  buys down, since the *geometry* is already implemented.
- **Concurrency is a process-pool problem.** Each worker is a native process
  holding OCCT memory. Sizing that pool against the 200-concurrent-user target
  in `dev/docs/roadmap/Host_Scaling.md` is an open engineering task, and it is
  the main cost of this architecture.

### Saved imports, compound extrusion and analysis

### Unified CAD import

`import-cad` accepts STEP/STP, IGES/IGS and BREP/BRP solids, plus STL, OBJ, PLY
and OFF meshes through FreeCAD's public Part/Mesh APIs. STEP/IGES use file units;
BREP uses model millimeters. Meshes require explicit `mesh_units` (mm/cm/m/in/ft)
and `mesh_mode` (`reference` or `solid`). Geometry is reconstructed from embedded
`data_base64` on every rebuild; source filenames are never interpreted as paths.

Reference meshes retain triangles, body selection, appearance and STL export.
They expose no exact topology, cannot be placed in the current solid assembly
adapter, and reject solid operations, exact analysis and STEP export with a
conversion instruction. Closed-mesh conversion creates faceted B-Rep geometry,
not analytic curve reconstruction. Invalid, open, zero-volume, nested or
overlapping shells fail explicitly. IGES surface sets are sewn only when all
faces form valid closed solids; otherwise they fail rather than losing surfaces.

Limits: 3 MiB decoded source, 100,000 reference triangles and 10,000 triangles
for solid conversion. The UI additionally enforces a 4 MiB Part JSON budget and
32 files per batch. Binary and ASCII STL are accepted. Imports retain geometry;
source feature trees, assembly mates, external texture assets and per-vertex
colors are not imported. SolidWorks/Parasolid/ACIS/Inventor/CATIA native formats
need an external translator or STEP export. SVG/DXF remain Sketch import tools.

`import-step` reads `data_base64` into an exact native base feature (3 MiB source
limit). It requires valid solids and rejects mixed unsewn surfaces. The caller
persists the source and `body_id`; downstream modifications and exports rebuild
from those bytes. A multi-solid import is currently one body group.

`pad`/`pocket` with `region_mode: true` take selected `profiles` and all closed
`profile_regions` from the same sketch. Exact containment forms holes; selecting
both nested regions fills their shared area. Intersecting/duplicate contours are
refused. Legacy single-profile builds retain their original meaning.

`sketch-region` derives one exact closed wire from a `profiles` list naming two
or more earlier open sketch contours. It retains linked source sketches and
their constraints, rejects missing/duplicate sources, different frames, gaps,
branches, disconnected loops and invalid faces, and supplies an ordinary 2D
profile to native Extrude, Revolve, Sweep and Loft. The worker advertises
`sketch-connected-region`; clients must check this before submitting it.
The browser adapter in `browser/connected-sketch-regions.ts` derives matching
nonbranching boundaries and resolves stable contributor identities without
changing the saved drawing. Crossings and shared branches require a future
planar-arrangement implementation. This is a qualified geometry-job foundation;
saved Part references, viewport selection and feature-editor integration are
still pending. It does not change existing Part18 file meaning or claim that
joined regions are already selectable in the installed application.

`FreeCADEngine.analyze(job, options)` accepts `kind: section` with principal
`plane`, `offset_mm`, and optional `reverse`, or `kind: interference`. Results
include tessellated native result bodies and exact `volume_mm3` measurements.
Analysis rebuilds without changing the document. Interference compares body
features (maximum64), not internal solids of a single compound, and ignores
volumes <=1e-7 mm³. Sections include native cap faces.

`kind: properties` returns exact volume (mm³), surface area (mm²), centroid and
bounds (mm) per body without changing the viewport or document. Optional
`density_kg_m3` adds uniform-density mass (kg) and the centroidal inertia tensor
in world axes (kg·m²). No material or density is assumed when it is absent.
