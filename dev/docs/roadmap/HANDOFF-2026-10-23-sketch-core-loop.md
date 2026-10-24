# Handoff — 2026-10-23: the sketch core loop

Jonathan's priority, in his words: planes first, then a sketch plane you can place
anywhere without breaking, then sketches on it that form closed contours and
identify the zones that can be extruded, then extrusions and other features from
them, then repeat on the new bodies (sketch on a face, add, remove, modify, merge).
**This loop comes before any further SolidCraft parity tools.** He reported that
sketching is broken for him on the live install; the cause is found and fixed in
source (below), but **the fix is not installed yet.**

## 1. Install the overlay fix first (r65)

- Commit `1d0b30a` on `alpha-0.1`: "Sketch: a hidden 'Use fixed plane' button
  covered the view". Root cause: the shared `.aui-button` sets `display`, which
  beats the `[hidden]` attribute, so the hidden button became a grid item of the
  full-screen `.cad-sketch-workspace` and painted an opaque grey panel over the
  viewport, feature tree and ribbon as soon as a plane was picked (and over the
  right sidebar while choosing). Clicks went through it (`pointer-events: none`),
  which is why the tools harness kept passing. Introduced in r24–r37 (`5ab2b30`).
- The r65 chain was **stopped before its build** (the engine suite had passed:
  247 files / 1083 tests; the app suite was interrupted). Run the whole chain on a
  clean `alpha-0.1`:
  ```bash
  ../AetherStudio/.verification/cad-aether-engine-2026-10-20/chain.sh r65
  ```
- `promote-r65.py` is already written in
  `../AetherStudio/.verification/cad-aether-engine-2026-10-20/` with the Map
  session's changes: access schema **26** (`f'26|{audit.access_checksum(26)}'`),
  stages from the current marker (now `aether-network-20261023-r1`, keeps its
  binary), and readiness checks use the config's origin with
  `~/Library/Application Support/Aether Studio Native/tls/aether-ca.pem` when it
  is https (the portal will switch it to `https://aetherstudio.local:8443`).
- The tools harness (`../AetherStudio/.verification/cad-tools-2026-10-20/browser.mjs`)
  now has a `sketchNotCovered` guard: any opaque element in the sketch workspace
  larger than 15 % of the window fails qualification. Verified that it catches the
  old bug and passes with the fix.

### Release chain (unchanged rules)

`chain.sh rN` (beside the promote scripts) runs all of this and promotes only when
every step passes; its harness logs go to `/tmp/claude-501/tools-rN.log` and
`models-rN.log`.

`export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8` first (the disposable PostgreSQL dies
without it). Engine suite (`cd aether-engine && npx vitest run`), app suite
(`npx vitest run src`), `npm run build > cad-build.log` and copy it to the
`cad-aether-engine-2026-10-20` folder, then `qualify.py` for `cad-tools-2026-10-20`
(retry once) and `cad-models-2026-10-20`, then `promote-rN.py stage` and `promote`
from `../AetherStudio`. Never run vitest at the same time as the harnesses. Do not
edit source between the suites and the build.

## 2. What the mouse-driven core loop shows (r64 + overlay fix)

Script: `../AetherStudio/.verification/cad-core-loop-2026-10-23/` (`run.py` starts
a disposable host with the harness's test account and runs `loop.mjs`; evidence
lands in `browser/loop/`; the run from this session is in
`evidence-r64-plus-overlay-fix/`). It uses the mouse like a user, not the
Coordinates window the tools harness uses.

Works with the fix:
- Offset Plane 30 mm from Top Plane (reference picked in the tree), applied.
- Sketch → click a plane in the view → the sketch starts on it, the grid and the
  drawn geometry are visible; a rectangle and a circle drawn with the mouse.
- Accept, Extrude (the region preview shows), Apply → a body.
- Sketch → click the body's face → "Face of Extrude …" → a circle drawn on it →
  Extrude opens with that region.

Found, not yet fixed:
- **Overlapping shapes are not split into zones.** A rectangle overlapping a
  circle lists two regions (the whole rectangle, the whole circle) instead of
  three (rectangle only, the lens, circle only). Same for a line across a
  rectangle (one region, not two) and a circle inside a rectangle (the rectangle
  stays whole instead of a ring plus a disc, unless the circle is flagged a hole).
  `aether-engine/src/document/sketch-regions.ts` lists one region per closed
  contour; `connected-sketch-regions.ts` says crossings "need the later
  planar-arrangement path", which was never built. This is Jonathan's
  "identifying zones" step.
- The sketch status line overlaps the left panel's bottom buttons (cosmetic).
- Not yet exercised by the loop: Remove (cut) on the second sketch, Merge/Boolean,
  editing an earlier feature and rebuilding (modify), planes from faces, angled
  planes, and moving a plane after sketches depend on it. Extend `loop.mjs` with
  these before calling the loop done.

## 3. Region arrangement — work in progress on `wip/sketch-arrangement`

Commit `e85860f` (branch `wip/sketch-arrangement`, off `alpha-0.1` before the
handoff doc). **Do not install from it as is.**

Done and tested:
- `aether-engine/src/sketch/regions/arrangement.ts` — `sketchArrangement(drawing)`
  is SolidCraft's `find_profiles` (`crates/sketch/src/profiles.rs`) on our exact
  curves. It splits every non-construction curve where it meets another, using
  `curveIntersections` and `subdivideSegment` (exact, degree preserving). It
  merges ends into nodes, prunes dangling curves, and traces faces by the
  first-clockwise-turn rule. Clockwise loops of other components become holes of
  the smallest face around them. Each face carries its exact boundary, holes,
  source contours, the closed contours containing it, a sample point and its
  area. It refuses conics and numerically ambiguous crossings by returning
  undefined, and the caller then keeps one region per contour.
- `arrangement.test.ts` — 5 passing cases: separate shapes, rectangle and circle
  overlap gives 3 cells, circle in rectangle gives ring and disc, line across a
  rectangle gives 2 and a dangling line gives 1, and a triangle with a T-junction.

Started (compiles in isolation, not run through the suites):
- `profile-region-reference.ts` — the saved identity `profileRegion` gains
  optional `inside` (closed contours containing the cell) and `ordinal` (1..n
  when several cells share sources and containers, ordered by sample x then y).
  Old connected-region identities are unchanged, because `inside` is omitted when
  empty.
- `connected-sketch-regions.ts` — `sketchArrangementRegions()` returns cells when
  the arrangement is non-trivial, and `sketchFaceRegions()` returns those cells.
  Cells get a transient `contourIndex` past the last contour, `holes`,
  `insideContourIds`, `ordinal` and `cell: true`.

Still to do (in this order):
1. `aether-engine/src/document/sketch-regions.ts`
   - When `sketchFaceRegions` returns cells, list one region per cell, with
     engineId `${id}#cell#k`, `sourceContourIds`, `insideContourIds`, `ordinal`,
     `previewContour` and holes, labelled "Region n".
   - Do not list the closed contours' own regions alongside the cells.
   - Keep `includeOpen` (Thin, curves) listing contours as now.
2. `src/features/regions.ts` → `stampProfileSelections`
   - For a cell, stamp IDs on its source and inside contours.
   - Save `profileRegion: {contourIds, inside?, ordinal?}`. Omit `inside` when it
     is empty.
3. `aether-engine/src/kernel/part-evaluator.ts` (profile branch, about line 768)
   - Build each cell's drawing as boundary minus holes, using `contourDrawing`
     and `.cut`.
   - Keep cells in a separate `cells: Region[]` on the profile, not in `regions`.
     `everyRegion`, the default sole-region choice and the identity tools at
     about lines 2583 and 3250 iterate `regions`, and must keep their old meaning
     for saved documents.
   - Search `[...regions, ...cells]` in the two `profileRegion` lookups (about
     lines 656 and 2578).
   - Extend `interface Region` with `insideContourIds` and `ordinal`.
4. `src/sketch/canvas-renderer.ts` and `src/sketch/picking.ts`
   - Draw each cell fill with its holes, using an even-odd path.
   - Pick a cell when the point is inside its boundary and outside its holes.
     Today only `contour` is tested, and the smallest area wins.
5. The viewer's region picking during Extrude sends `aether-region-picked` with
   `contourIndex`. Check that it reads the same transient indices; it goes
   through `sketchRegions` and `pickSketchRegion`.
6. Run `node scripts/generate-feature-schemas.mjs` in case `profileRegion` is in
   the generated schemas.
7. Tests:
   - An evaluator test: rectangle overlapping a circle, extrude the lens only,
     check its volume.
   - Extrude ring plus disc together, which equals the whole rectangle.
   - An old document with a `profileContourId` still builds.
   - Extend `loop.mjs` to pick the lens in the view and extrude it.

## 4. Other work in flight

- **Cam joint** (SolidCraft `joint.cam`, `crates/doc/src/joints_cam.rs`).
  - Aether-Animation commit `e5bf582` on its `alpha-0.1` adds the workspace cam
    relation: kind `cam`, a 360-sample `lift` table in SI units, the `cam`
    definition stored as given, and `lift_at` monotone cubic interpolation.
  - It is validated on add and on load and is covered by a test. Animation tests
    pass, apart from two serial-port tests that need `pyserial`, which this
    Python lacks.
  - The CAD side is not started:
    - Add `"cam"` to the `AssemblyRelation` contract.
    - Add a cam branch in `assembly-solver.ts` with target `liftAt(table, x) + offset`.
    - Map it in `src/assembly-job.ts`.
    - Add a Cam option in `src/cad-relation-authoring.ts`.
    - Port the table computation in `joints_cam.rs` (`first_contact_along`,
      `touches_turning`, `table`) to TypeScript, using SolidCraft's eccentric-circle
      tests as oracles.
  - Lower priority than the core loop.
- **Remaining parity gaps:** `surface.match` and `joint.sweep`. See the tracker.
  They are lower priority than the core loop.
- `.claude/launch.json` (untracked) defines a `cad-dev` Vite server on port 5191
  for the in-app browser. Without a Studio host it opens no Part, so use the
  harness host for real checks.

## 5. Rules that still hold

- Commit locally to `alpha-0.1` in milestones. Never push or merge to `master`
  until Jonathan approves.
- Never enter credentials on the live host (localhost:8780). Real checks run on
  the harness's disposable host.
- No Python or server-side geometry.

## Codex continuation — r65 gate correction

The clean alpha engine suite passes 1,083 tests. The app suite passed 1,749 and
reported one CSS-scope guard failure: the newly positioned fixed-plane control
used the `.cad-sketch-workspace … .sketch-` geometry prefix. Its unique control
class now owns the positioning directly; hidden controls still stay hidden.
All nine in-world sketch checks pass after the correction, and the production
build passes. Browser qualification and installation continue separately.
Region work remains isolated in `wip/sketch-arrangement`.
