# SolidCraft engine adoption

Owner decision: Jonathan, 2026-10-20 (AGENTS.md "Engine decision"). Status: phase 0 done, phase 1 in progress.

## Why

Measured on Jonathan's M1 Max, same part (80×50 mm plate, extrude 12, depth edited to 20, Ø16 through cut):

| Path | Sketch + extrude | Parametric edit | Boolean cut | Where it runs |
|---|---:|---:|---:|---|
| FreeCAD worker (today) | ~800 ms per request | ~800 ms | ~800 ms | Studio host, new Python + FreeCAD process per request |
| SolidCraft native CLI | 15 ms | 0.8 ms | 14 ms | any machine, no server |
| SolidCraft engine, wasm in V8 | 12 ms | 1 ms | 40 ms | the browser tab (31.9 MB wasm, 7.0 MB gzip, 4.4 MB brotli) |

Evidence: `engine-solidcraft/spike/` (`batch.json`, `native-run.json`, `spike.mjs`); the FreeCAD numbers in
`AetherStudio/.verification/cad-rebuild-timing-2026-10-19/`. Volumes match analytic values (48 000, 80 000, 75 979 mm³).

SolidCraft's method matches our own rules: one validated command surface for UI, scripts and agents; a layered engine
(geom → sketch/kernel/render → doc → io → engine) whose kernel (truck, Apache-2.0, with SolidCraft's blends) hides
behind an API; 83/83 reference parts checked against analytic or FreeCAD values; ~5 000 tests. Its own words: "early
but usable for simple parts" — general fillets, sheet metal and assemblies are in progress upstream.

## Architecture

- `engine-solidcraft/` (Rust, wasm32): `aether-solidcraft-bridge` — `Engine.execute(id, json)` and `Engine.scene()`
  over `solidcraft_engine::Session`. Built by `npm run build:engine` into `public/engine/solidcraft/`
  (wasm + bindings), shipped with the frontend. Upstream source: `solidcraft-main/` (vendored snapshot; its
  `[patch.crates-io]` fixes are mirrored in the bridge's Cargo.toml).
- `src/engine/solidcraft/`: loads the module once per tab, one `Engine` per open document, and adapts the scene to
  the viewer's `PartGeometryData` (vertices, normals, triangles, face ranges, edge lines, topology candidates).
- The evaluator seam stays: `worker.evaluatePart(document)` is the only entry the app uses. Phase 1 translates our
  `PartDocument` features to engine commands; phase 2 makes the engine's design (timeline, parameters, naming) the
  document of record, with `.acpart` migrated by replaying it as commands.
- Studio keeps PDM/versions/comments/Drive. Thumbnails render from the viewer or `solidcraft-cli render` headless;
  the FreeCAD worker and `/api/cad/*` geometry services retire when nothing calls them.
- Agents: our tools map onto engine commands directly (see `solidcraft-main/skills/` for how its agents model).

## Phases (one tool at a time; each lands with its browser check and install)

0. Spike — done: engine built natively and for wasm, timings above, bridge crate.
1. Engine in the app — landed 2026-10-20 (`cad-solidcraft-20261020-r1`):
   - `npm run build:engine` (`engine-solidcraft/build.sh`) → `public/engine/solidcraft/` (web, wasm-opt, 16 MB /
     4.3 MB brotli) and `engine-solidcraft/pkg-node/` (Node bindings the vitest engine tests run on). Both are build
     outputs, not committed.
   - `src/engine/evaluate-part.ts` is the one build entry (`HostAetherCoreClient.evaluatePart` and the library
     preview call it). `src/engine/engine-choice.ts` holds the per-browser setting (Settings → Renderer → Modeling
     engine: Automatic / SolidCraft / FreeCAD; Automatic = SolidCraft when the translator can express every feature,
     else FreeCAD; changing it rebuilds the open Part).
   - `src/engine/solidcraft/translate.ts` maps the engine-neutral feature list (what `freecad-translate` already
     resolves: rollback, suppression, regions, body ids) to commands: sketches as explicit `{origin,x_dir,y_dir}`
     frames (SolidCraft's named XZ faces the other way from ours), circle / polygon / line-and-arc wires, extrude
     new / join / cut / intersect, blind / through-all / symmetric, reversed, separate bodies (`<body>:solid-N`
     outputs, cuts and joins routed to them). Refused by feature (→ FreeCAD in Automatic, a named feature error when
     forced): sketches on faces or construction planes, bezier / ellipse / conic curves, joined regions, thin, start
     and end references, direction references, two-sided, up-to-* ends, offsets, drafts, every other feature kind.
   - `src/engine/solidcraft/scene.ts` turns `scene()` + `model.faces` + `model.edges` into `PartGeometryData`:
     per-face index ranges, seams dropped from edge lines, face ids hashed from SolidCraft's stable face names,
     candidates (face-center with planar normal and area, edge-midpoint with length / direction / fitted circle,
     circle-center, vertices) so Measure, Section and sketch-on-face pick engine faces unchanged.
   - `src/engine/solidcraft/evaluator.ts` replays the document from `file.new` per build (milliseconds), returns
     the FreeCAD-shaped `ImportedModelData`; preview = the feature built again as its own body over the design
     before it (`edit.undo` the feature, extrude as `preview:added|removed:<body>`), so blue/red deltas work.
   - Checks: `src/engine/solidcraft/*.test.ts` (translator; evaluator on the real engine), e2e
     `AetherStudio/.verification/cad-solidcraft-2026-10-20` (opens on SolidCraft with no `/api/cad/geometry`
     request, live preview with deltas, Apply, Measure face pick, Automatic fallback for thin, forced-engine error).
   - `src/engine/solidcraft/measure.ts`: Measure's exact minimum distance (`inspect.measure` by face id / edge
     index / vertex / body), routed with the same policy (`onEngine` in `evaluate-part.ts`) so a Part is built and
     measured by one engine. Measured on the Apple GPU (`cad-rebuild-timing`, run-solidcraft-headed.log): depth
     edit Apply → model 135 ms cold / 40 ms warm at 60 fps, no `/api/cad/geometry` calls (FreeCAD was ~230 ms).
   - Still on FreeCAD: section / interference / mass-properties analyses, STEP/STL export (`part-export`), and
     everything the translator refuses. Next: phase 2.
2. Sketching through the engine: sketch commands + constraint solver (`sketch.*`, `sketch.dimension`), our sketch
   workspace rendering engine sketch state; sketch-on-face.
3. Features: revolve, fillet, chamfer, shell, hole, pattern, mirror, draft, boolean, transform, planes (`solid.*`,
   `construct.*`), each replacing the FreeCAD translation for that feature.
4. Tools: measure (`inspect.measure`), section (`inspect.section`), interference, mass properties; STEP/3MF/STL
   in and out (`file.*`).
5. Document of record = engine design; parameters and configurations panels; migration of saved `.acpart` files.
6. Assemblies/joints, sheet metal, drawings as upstream matures.

## Risks and limits

- Kernel maturity on hard geometry (complex fillets, surface work) is below OpenCASCADE's; upstream tracks it in
  ROADMAP.md M2/M3/M8. Keep FreeCAD selectable until phase 3 parity is checked by the oracle-style tests.
- wasm download (4–7 MB compressed) and single-threaded evaluation on the UI thread; large models need a worker
  (upstream's `docs/web-runtime.md`).
- Two document models during phases 1–4; the translator is the seam that keeps the UI untouched meanwhile.
