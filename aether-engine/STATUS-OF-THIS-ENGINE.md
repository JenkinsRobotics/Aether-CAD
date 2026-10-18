# Aether Engine — parked, not abandoned

**Decision (Jonathan, 2026-09-12): `freecad-engine` is the default engine.
This one is kept to be built out later, to match and then surpass it.**

Aether CAD has two engines, side by side, deliberately:

| Folder | Package | Role today |
|---|---|---|
| `Aether CAD/freecad-engine/` | `aether_freecad` (Python) | **default.** FreeCAD's solver and features, behind a replaceable JSON boundary |
| `Aether CAD/aether-engine/` | `@aether/core` (TypeScript) | **ours.** Runs the app today; no new feature investment |

## What this engine still is

Not dead code, and not a prototype. 20,190 lines with **737 passing tests**,
holding capabilities the FreeCAD path does not have and may never have:

- **It runs in the browser.** OCCT compiled to WASM in a worker, so
  interactive modelling costs no server CPU and survives a lost connection.
  A server round trip per mouse-drag is not viable, so interactive preview and
  selection stay here regardless of what owns feature evaluation.
- **A stateless evaluator.** `evaluatePartDocument(document)` is a pure
  function of the feature array — no retained document, no session affinity.
- **Exact topology with stable identity.** `extractExactTopology` gives faces,
  edges and snap candidates the selection, mate and dimension model keys off.
  This is precisely what FreeCAD's `Face1`/`Face2` names cannot provide
  across rebuilds, so this code is the reference for solving that problem on
  the FreeCAD side.
- **OCCT hidden-line removal** for drawing views (`kernel/hidden-line.ts`).
- **A sketch constraint solver** with 27 constraint kinds and 5,313 lines of
  solver tests — the corpus that measured PlaneGCS.

## Why keep it

1. **The app runs on it right now.** FreeCAD is the default *engine decision*;
   it is not yet wired through the host to the browser. Until that packet
   lands, this is what boots.
2. **Interactive work belongs in the browser** whatever happens to feature
   evaluation.
3. **It is the escape hatch.** If FreeCAD's topological naming, process cost
   or licence terms become a problem, this is the thing that already works.
   The `GeometryEngine` interface in `freecad-engine/aether_freecad/protocol.py`
   is written so this engine can satisfy the same contract.

## Rules while parked

- **No new feature investment here.** Parametric features go to the FreeCAD
  path. That is the point of the decision.
- **Keep it green.** Its tests run in CI and must stay passing; a parked
  engine that rots is not an escape hatch.
- **Fixes are fine.** Bugs in what the app uses today still get fixed.
- **Mine it for reference.** The exact-topology and stable-identity work is
  the model for fixing FreeCAD's face naming.

Open question for the next session: after the host RPC lands, which
responsibilities move and which stay. Recorded in
`dev/docs/roadmap/FreeCAD_Inheritance.md`.
