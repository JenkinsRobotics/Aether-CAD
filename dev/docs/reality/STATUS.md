# Aether CAD source status

## 2026-10-24 — shared sketch-region selection for UI and agents

Source on `alpha-0.1`; this entry does not mean the installed release has changed.
The baseline goal and remaining acceptance gates are in
`../roadmap/CAD_Baseline_0_1.md`. Full SolidCraft baseline parity is not complete.

### Functional changes

- Mouse region picking classifies authored circles, arcs, elliptical arcs,
  cubic splines and rational conics using curve intersections. Display chords
  no longer decide whether a click is inside a disc or its surrounding ring.
  Boundary or numerically ambiguous points do not select a region.
- Agent Extrude and Revolve select an individual closed cell with
  `profile_point_mm` in local sketch millimeters. Extrude also accepts explicit
  `all_regions: true`. Omitting a choice on a multi-region sketch is rejected.
  Both adapters use the same persistent source references as feature dialogs.
- Agent sketch inspection pages closed-region geometry and holes alongside
  authored contours and constraints. Indices are transient, not saved references.
- Rectangle, circle and polygon agent tools accept a principal plane or an
  explicit frame with perpendicular unit axes, normal offset and local-axis
  flip. Contradictory or malformed placements are rejected without changing the
  source. Convenience tools do not yet bind live construction-plane or face
  references; body-face support remains available through the canonical profile
  contract. Associative construction-plane binding needs separate verification.
- Selected regions support exact extrude/new/add/cut/revolve, driving-dimension
  changes, stable body identities and serialization/reopen. Failed or stale
  candidates retain the existing editor/program atomic-commit boundary.

### Verification

- Full app suite: 1,771 passed, one pre-existing integration skip.
- Full engine suite: 1,114 passed. Engine type check and frontend/worker build pass.
- Eight curve-containment tests cover near-edge positions, joins, tangencies,
  reversed curves, boundaries and all supported curve families. Eleven region
  workflow tests assert analytic volumes, world bounds and stable identities.
- `node scripts/verify-sketch-regions.mjs` passes against the rebuilt packaged
  runner in fresh processes: discovery, explicit overlap selection, extrusion,
  dimension edit, reopen, explicit rotated/offset/flipped planes and qualified
  program references. No Studio connection is used.
- Two old engine test fixtures failed type checking on unchanged HEAD too.
  Their stored expression field and single-body tuple annotations now match the
  real contracts; the 58 affected tests and engine type check pass.
- The mouse workflow passes all seven steps on a disposable Studio/PostgreSQL
  instance: offset plane, overlap regions, extrusion, face cut/add, upstream edit
  and reopen. There are no browser errors. All five saved stages match analytic
  volumes; the final edited and reopened body is 4,511.327050554948 mm³ with the
  same body identity. The existing Animation client regression also passes.
- Native project/settings tests now import CAD's hash-pinned codec wheel, as the
  packaged worker does. Previously they compared against a newer editable
  Animation checkout and failed deterministic byte comparisons in 15 cases.
  The five shipped codec modules are byte-for-byte unchanged from starting CAD
  commit `67c7b6a`; no dependency or document-format upgrade was made here.
- All 258 packaged-worker tests pass with the native release gates enabled;
  the 21 project/settings checks also pass independently. Fresh-process kernel
  build, exact properties, STEP export, lazy full-kernel loading and extraction
  of the standalone zipapp pass. Final inspection metadata checks pass (15 tests).

Detailed evidence, including the initially failing curved-edge regression, is
under `.verification/baseline-2026-10-24/`. Browser and worker qualification are
complete. No live host, database, settings or other app
has been changed by this source work.

### Remaining baseline work

Drawings still have presentation and OCCT hidden-line foundations but no connected
authoring producer. Complete the real drawing workflow, assembly/agent editing
coverage, and remaining reference tool variants before claiming the baseline.
The reference command matrix contains historical claims that still need workflow
verification; an enabled control or a generic feature schema is not proof of parity.
