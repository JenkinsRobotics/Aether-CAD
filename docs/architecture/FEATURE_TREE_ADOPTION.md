# Shared feature tree adoption — 2026-10-17

CAD consumes `@aether/ui` alpha.135 / assets24. The feature and parts menus use
`featureTreeActions` and `featureTreeMenuItems`; labels/order/icons are shared.
`feature-tree-commands.ts` maps their requests to existing CAD operations. No new
model evaluator, dependency rules or document representation was added.

Default geometry is named consistently. Typed feature icons preserve sketch,
revolve, fillet, chamfer, extrude and other shared artwork; status badges no longer
replace every feature with a cube. Hidden, suppressed and rolled-back states stay
distinct. Visibility uses existing reference/import/body commands. Authored-feature
visibility, sketch copy/dimensions, dynamic suppression, comments, normal view and
dependency inspection stay disabled where CAD has no connected operation.

Rollback uses canonical document history order even when folders group rows.
Reorder/folder/suppression/delete/edit/rename continue through the existing validated
CAD controller. The rollback line additionally supports arrows/Home/End. References
cannot be dragged into history; filtered drag operations are rejected. Existing
parts appearance and placement controls are preserved.

Session150 is a peer-only repack of149 for UI135/assets24; all32 runtime files are
byte-identical. The shared window listener uses its document's AbortController so
CAD's isolated DOM contexts remain compatible. Shared header settings and accessory
state assertions were updated to the already-approved UI behavior.

This is source/package adoption only. CAD's native frontend, workers and backend
installation were not switched. Production build and affected integration checks
pass; full suite passes1941 tests with35 configured skips (269 files pass,7 skip).
Evidence is recorded in the platform evidence directory:
`../AetherStudio/.verification/feature-tree-standard-2026-10-17/`.
