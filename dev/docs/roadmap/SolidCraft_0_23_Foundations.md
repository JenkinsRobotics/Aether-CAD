# SolidCraft 0.23.0 comparison and foundation work

Jonathan's target, 2026-10-25: comparable or better behavior across the kernel,
CAD commands, MCP agents, sketches, Parts and Assemblies, developed from the
foundations upward in maintainable modules. This is a behavior comparison, not
a requirement to duplicate SolidCraft's implementation or replace OCCT.

## Reference baseline

The supplied `reference/solidcraft-main/Cargo.toml` identifies version 0.23.0.
Its generated `docs/features.md` lists **463 command IDs**. All 398 IDs in the
previous tracker remain, with 65 additional IDs. These counts include planned
commands and capabilities outside the immediate CAD baseline; they measure
inventory, not acceptance. Existing IDs also need their contracts rechecked.

Reproduce the inventory with:

```
node scripts/audit-solidcraft-reference.mjs .verification/reference-inventory.json
```

The report records the reference document hash, IDs, categories, old tracker
labels and newly added IDs. Every entry explicitly requires workflow review;
no old label is promoted to verified 0.23.0 parity automatically.

## Foundation contracts and first increment

| Contract | Reference evidence | Aether implementation and acceptance |
| --- | --- | --- |
| Explicit input identity survives ordinary edits | `crates/engine/src/cmd/construct.rs`, `cmd/edit.rs`, `cmd/delete.rs` | `document/feature-inputs.ts` reads typed input subtrees; `feature-history.ts` owns ordered body ownership. Construction planes/axes/points, pattern axes, sweep rails, loft apexes, selected edges/faces, sheet and surface inputs participate in suppression, restoration and dependency inspection. |
| Body copies retain their source independently | `cmd/component_clone.rs`, pattern commands | Body-pattern outputs register after input resolution and do not replace the original body's producer. Regression asserts no self-dependency and independent downstream edits of original/copies. The app and packaged command finalizer validate the saved pattern copy IDs directly, instead of rejecting them as separate-extrusion outputs; suppression/restoration and saved reopen retain all three exact 500 mm³ bodies. |
| Broken references remain repairable | Reference timeline/redefine and deletion workflows | Keep lost IDs and report evaluated failure; do not reject a recoverable saved document or silently change its source. Save/reopen and source restoration are tested. |
| Published argument contracts are enforced before work | `schema/mod.rs`, `schema/check.rs`, `cmd/inspect.rs` | `automation/tool-arguments.ts` enforces CAD's published schema subset for Part, Assembly and Drawing calls. Required values, types, enums, bounds, arrays and nested unknown fields are checked before geometry/history/export. Domain validators remain authoritative for feature meaning. |
| UI, live agents and saved programs share semantics | Reference `CommandSpec` and session execution | UI uses Core history; MCP and programs use those same operations. Browser acceptance exercises UI suppression/history, live dependency inspection and refusal, restoration, and saved reopen. |

Focused modules own reference extraction and transport argument validation.
Entry points only call them. No reference source is bundled or imported by
Aether's runtime. Source checks alone do not constitute an installed release;
qualification and release evidence belongs in `../reality/STATUS.md`.

## Sequence and completion gates

1. **Foundations:** complete input/dependency contracts, command discovery and
   validation, atomic failure/cancellation, stable IDs, rollback/history,
   serialization and exact deterministic rebuild evidence.
2. **Sketches:** compare geometry creation, point identities, snapping,
   constraints/dimensions, linked projection, region splitting and repair.
   Exercise both real mouse operations and agent operations on the same saved
   document; compare solved geometry and identities, not screenshots alone.
3. **Parts/kernel:** compare input variants and topology for each solid, finish,
   pattern, sheet and surface operation. Test upstream edits and failed cases
   against analytic measurements and trusted reference fixtures.
4. **Assemblies:** preserve the delivered insert/place/mate/Part-edit workflows;
   add nested assemblies, external association, remaining mate/relation scope
   and motion with canonical saved state and exact pose comparisons.
5. **Agents and delivery:** close adapter differences as each operation lands;
   verify UI, live MCP and saved-file behavior, then publish compatible CAD-only
   alpha packages. Keep Studio, Map, other apps and user documents unchanged.

Each applicable command needs a contract mapping, implementation location,
positive/invalid/edit/reopen evidence and an installed release before its row
can be called complete. The current work does **not** establish full parity.
