# Handoff: Onshape parity work, 2026-11-05

For the agent continuing this work and pushing it. Everything below was checked
against the checkout at the time of writing (HEAD `b5a2690`, active CAD release
`alpha-0.1.116`).

## 1. Where things stand

- Branch `alpha-0.1`, HEAD `b5a2690`. All parity work from this session is committed and
  is an ancestor of HEAD: `01437e8` (gap closures, shipped as alpha-0.1.100), `69d29fd`
  (native worker runtime), `b6f2a64` (ledger, shipped as alpha-0.1.103).
- A second session ("Release Aether CAD to 8780") kept working in the same checkout after
  that and released alpha-0.1.104 through alpha-0.1.116 (Extrude, Surface Extrude, Draft and
  selection-removal work). Its commits sit on top of ours; nothing of ours was lost.
- The checkout is dirty with that session's **uncommitted** edits (26 tracked files, plus
  untracked `aether-engine/src/kernel/native-face-axis.ts`, `extrusion-face-axis.test.ts`,
  `service/tests/test_native_extrude_face_axis.py`, `scripts/verify-extrude-face-axis-format.mjs`,
  `scripts/browser/extrude-face-axis-workflow.mjs`, `dev/docs/reality/data/Extrude_Face_Axes_2026_11_05.json`).
  Do not commit, revert or overwrite them. Message that session before touching those files.
- Untracked noise never to commit: `cad-build.log`, `.claude/`, the unreferenced
  `vendor/aether-assets-*.tgz` tarballs.

## 2. What this session shipped (alpha-0.1.100 and 0.1.103)

Each item has a kernel branch in `aether-engine/src/kernel/part-evaluator.ts` (or
`kernel/features/*.ts`), a document contract under `aether-engine/src/document/`, a window under
`src/features/`, an engine test in `aether-engine/src/kernel/parity-gaps.test.ts` (19 tests) and
a window test in `src/features/parity.dom.test.jsx` or `hole.dom.test.jsx`.

| Feature | Closed | Key files |
|---|---|---|
| Rib (new) | Normal and Parallel to sketch plane, thickness, flip | `document/rib.ts`, `features/rib.ts`, evaluator rib branch |
| Draft | Parting line mode: pull plane, parting edges, one/symmetric/two sided, second angle | `document/draft.ts`, `features/draft.ts` |
| Sweep | Path flip, Thin (open curves too), Twist by turns/angle/pitch, Lock profile faces (support face) | `document/solid-features.ts`, `features/sweep.ts`, `twistSpine`, `openWallFace` |
| Loft | Path, Connections (sketch point pairs) | `document/loft.ts`, `features/loft.ts`, `CheckCompatibility(false)` |
| Hole | Up to next, Up to face, start from plane, pipe taps, viewport sketch-point placement | `document/hole.ts`, `features/hole.ts`, `features/sketch-points-box.ts`, `viewer.ts` sketchPickPoints |
| Split | Split by any face (cylinders included), Keep tools, Trim to face | `document/split.ts`, `kernel/general-fuse.ts` `splitShapeByTool` |
| Mirror | Part mirror with New/Add/Remove/Intersect | `features/mirror.ts`, evaluator mirror branch |
| Pattern | Skip instances, result Add/Remove/Intersect, axis from face, direction from plane/line | `document/pattern.ts`, `kernel/features/pattern.ts` |
| Boolean | Offset (Subtract) | `document/boolean.ts`, `offsetSolid` in `kernel/features/boolean.ts` |
| Thicken | Second thickness, Keep tools (sheet consumed by default) | `document/surface.ts`, `features/surface.ts` |
| Transform | Translate by distance | `features/part-transform.ts` |
| Revolve | End offset; default scope now "Merge with all" | `features/revolve.ts` |
| Fillet | Radius points along an edge (variable radius law) | `kernel/features/edge-finish.ts` `filletThroughPoints` |
| Thread | Chamfer, undercut, split face, size from cylinder diameter | `document/thread.ts`, `features/thread.ts`, `radiusMillimeters` on face refs |
| Enclose | Onshape layout and naming | `features/boundary-fill.ts` |

Behaviour changes to know about: Thicken consumes its sheet unless Keep tools is on; new
Revolves merge with all parts; finished-sketch vertices and circle centres are clickable in
the viewport for Hole and every Up-to-vertex picker (8 px pick radius).

Ledger: `dev/docs/roadmap/Onshape_Feature_Parity.md`, section
"Gaps closed — 2026-11-04 (alpha-0.1.100, continued in alpha-0.1.103 …)" at line ~326.

## 3. Open gaps (ranked by value, with the approach I would take)

All are recorded in the ledger with `planned(control, reason)` on the disabled control.

1. **Partial fillet / chamfer along part of an edge.** OCCT re-chains the tangent half of a
   split edge and fillets the whole edge. Tried: splitting the edge with a face then
   filleting one half. Next try: `BRepFilletAPI_MakeFillet` with the radius law set to 0 at
   the stop point via `Add_5` (two-point law, radius 0 at one end) and check the result shape
   is valid; otherwise it stays a gap.
2. **Boolean "Faces to offset".** Needs the Move-faces (offset-face) code lifted out of the
   evaluator into a helper so Boolean can call it per face before subtracting.
3. **Loft end conditions, guides, isoparametric curves.** `BRepOffsetAPI_ThruSections` has no
   tangency control; guides need `BRepOffsetAPI_MakePipeShell` with multiple `Add_1`
   sections, which the twist branch already drives. Start with guides.
4. **Enclose without one point per region.** Needs cell enumeration from the general fuse
   result (`general-fuse.ts`); `BOPAlgo_MakerVolume` is absent from the binding.
5. **Face patterns and face mirrors.** Would need Move-faces applied per instance (same
   helper as item 2).
6. **Conic / curvature / asymmetric fillets, smooth corners, edges to keep.** Binding lacks
   `ChFi3d_FilletShape`; asymmetric chamfer exists (`AddDA`) but its Tangent variant does
   not. Leave disabled.
7. **Reapply features (pattern/mirror), mate connectors, PEM holes, sweep Trim ends, rib
   draft/extend, Revolve and Thicken Intersect.** Each is a named gap; none has a kernel path
   yet.

Still open from earlier rounds: pocket outer-edge pick repro needs Jonathan's wheel
`.aethercad`; stale gates `verify-toolbar-presets`, `verify-assembly-insert`,
`verify-part-assembly`; section-view X orbit; modeling-gate replay flake.

## 4. Verify before you change anything

```sh
cd aether-engine && npx vitest run            # engine, 1289 passed at 0.1.103
```
```sh
npx tsc -b && npx vitest run                  # app, 2179 passed at 0.1.103
```
```sh
AETHER_TEST_NATIVE=1 ../AetherStudio/.venv/bin/python -m pytest service/tests -q   # 321 passed
```
Browser gates for this area: `scripts/verify-modeling-browser.mjs`,
`verify-region-pick-browser.mjs`, `verify-feature-controls-browser.mjs`,
`verify-edge-finish-browser.mjs`, `verify-home-browser.mjs` (run through the disposable
fixture host; see RELEASING.md and the "Browser gate fixture" memory). Never use the live
host at `aetherstudio.local:8780` for sign-in or test credentials.

After touching any `document/*.ts` contract: `node scripts/generate-feature-schemas.mjs` and
commit `src/operations/feature-schemas.generated.ts`, or the schema test fails.

## 5. Release recipe (the checkout is shared and dirty)

`app_update.py stage` refuses a dirty checkout, so build from a worktree:

```sh
git worktree add --detach /tmp/cad-release HEAD
```
Symlink `node_modules` and `aether-engine/node_modules` into it, `mkdir build`, run
`npm run build` and the gates there (`AETHER_QUALIFY_FRONTEND=<W>/build/release-dist`,
`AETHER_QUALIFY_WORKER=<W>/service/aether_cad_service/runtime/native-worker.json`), then:

```sh
git -C /tmp/cad-release checkout -f --ignore-other-worktrees -B alpha-0.1 <commit>
```
```sh
cd ../AetherStudio && python3 dev/rebuild/app_update.py stage --app cad --repo /tmp/cad-release --frontend /tmp/cad-release/dist --worker /tmp/cad-release/service/aether_cad_service/runtime/native-worker.json --backward-compatible
```
Then `app_update.py status`, and `activate --app cad --release alpha-0.1.N --sha256 <sha>
--expected-current alpha-0.1.116` (use whatever `status` reports as current; activating a
lower number over a higher one is refused). Never commit inside the worktree. Notify the
peer sessions "Aether UI: docked and floating ribbon toolbars" and "Release Aether CAD to
8780" after activation.

## 6. Pushing: what blocks it and what is approved

- `origin` is `github.com/JenkinsRobotics/Aether-CAD`. There is **no** `origin/alpha-0.1`;
  the nearest remote branch is `origin/codex/alpha-0.1` (`cbbe734`), which is an ancestor of
  HEAD. HEAD is 232 commits ahead of it.
- Jonathan approved pushing `alpha-0.1` to its own remote branch (2026-11-01). Pushing or
  merging to `master` is **not** approved.
- GitHub rejects the push (GH001, 100 MB limit): `vendor/aether-assets-0.2.0-alpha.29.tgz`
  (125 MB) was committed in `5ab2b30` and is in every tree since. Fixing that means
  rewriting those 232 commits (git filter-repo to drop the blob, or migrate it to Git LFS)
  and re-aligning the other session's checkout and the three `qualified/*` branches. That is
  Jonathan's call; do not rewrite unasked.
- Second trap for a fresh clone: `package.json` references
  `vendor/aether-assets-0.2.0-alpha.32.tgz` (125 MB, untracked) and
  `vendor/aether-session-0.2.0-alpha.192.home.6.tgz` (untracked). Only `aether-ui-0.2.0-alpha.277.tgz`
  is tracked. A clone cannot `npm install`. The assets package is over the GitHub limit either
  way, so the real fix is LFS for `vendor/*.tgz` or installing `@aether/*` from a registry.
  Decide that together with the history rewrite above, in one pass.

Suggested push command once the history is clean and Jonathan has agreed:

```sh
git push -u origin alpha-0.1
```
