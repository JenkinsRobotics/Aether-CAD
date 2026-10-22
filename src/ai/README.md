# Aether CAD agent authoring

CAD owns this module, its tool catalog, modeling operations and verification.
Studio supplies per-user provider connections, permission checks and transport.
The same operations run in the open editor and in saved-file programs; neither
path evaluates arbitrary model-generated JavaScript or shell commands.

## Existing-sketch skill

1. Inspect the Part and retain original feature/body identities.
2. Inspect the selected sketch's geometry, plane, local coordinates, constraints,
   dimension IDs and dependents. Page large sketches instead of guessing IDs.
3. For a rectangle with bounds `(xmin,ymin)` to `(xmax,ymax)`, its local center is
   `((xmin+xmax)/2,(ymin+ymax)/2)`. Translate the existing sketch by the negative
   center. Preserve its dimensions, identities and dependent extrusion.
4. To change a driving dimension, use its existing dimension ID. This calls the
   editor's dimension solver. Expressions and reference dimensions remain guarded.
5. Rebuild through the native engine before committing. Verify exact bounds,
   center and volume, then inspect the viewport preview. A sketch's local origin
   is not necessarily the world origin on offset or attached planes.
6. Use normal save, Undo and Redo. Never claim a save or measurement without a
   receipt. A failed/stale/cancelled rebuild must not apply an edit.

`aether_cad_docs` exposes guidance and current schemas. The open editor provides
`aether_cad_sketch_inspect`, `aether_cad_sketch_translate` and
`aether_cad_sketch_dimension`. Moves retain constraints; a fixed or external
anchor can reject the move. Projected geometry must be edited at its source.

External MCP clients discover `cad_sketch_inspect`, `cad_part_docs`,
`cad_part_runprogram` and `cad_part_verify`. Saved programs use the same
`aether_cad_sketch_translate` / `aether_cad_sketch_dimension` steps. They require
write access and an expected revision. An open editor must reload saved-file
edits; live-editor access is a separate, explicit connection.

## Canonical feature operations — 2026-10-19

Agents can author any of the 20 canonical feature types with `aether_cad_feature_add`,
`_update`, `_delete` and `_move`, after reading the exact declaration from
`aether_cad_feature_schema` (generated from the Core source). These produce the same
records the feature editors commit, pass the Core validator, rebuild natively, and
commit as one undo step — live, inside `run_program`, and on saved files. Missing
body/feature references are currently rejected by the native rebuild, not by the
Core validator.

## Tested boundary

Creation tools cover rectangle/circle/polygon sketches, five solid primitives,
extrude and revolve; existing edits cover sketch translation/driving dimensions,
extrusion depth and suppression, plus bounded atomic programs. Discovery reports
what is executable. This is not parity with every manual CAD command, arbitrary
Python/JavaScript, drawing or export capability.

`src/automation/sketch-edit.test.ts` covers identity preservation, constraints,
legacy rectangles, polygon/circle placement and bad input. The packaged native
program tests verify centering, driving dimensions and exact saved/reopened solids.
Studio's `dev/rebuild/cad_existing_sketch_browser.mjs` runs opt-in real-provider
inference against disposable documents; `cad_sketch_mcp_browser.mjs` verifies
OAuth, tool discovery, saved editing, exact proof, stale revisions and revocation.
