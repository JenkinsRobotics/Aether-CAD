# Aether CAD 0.1 functional baseline

Jonathan's goal, 2026-10-24: finish the CAD baseline using SolidCraft as a
behavior reference, including modeling, drawings, assemblies and agent use.
The source is Aether-CAD on alpha-0.1. Aether's in-process OCCT engine and the
approved shared Aether UI remain the product architecture.

## 2026-10-25 checkpoint — goal remains incomplete

Before the insertion correction, the tracker marked 207 of 345 in-scope commands
as parity/ours+ (about 60%); 128 were partial/parity-ish and 10 were gaps/unverified.
These are command coverage labels, **not** a production-readiness percentage.
`component.insert_design` was overclaimed: its visible dialog created an empty
Part definition rather than choosing actual geometry. It is now marked partial,
leaving 206 covered, 129 partial/approximate and 10 gaps/unverified. Installed alpha-0.1.17’s
source picker and Files drag reuse the validated Assembly recipe operation;
current-design instances share definitions, external saved sources are explicit
independent copies. Nested subassemblies and external associative design links
remain open. Standard parts cover the implemented ISO families and bearings;
this is not an import of every reference standard/library.

## 2026-10-25 — Part/Assembly daily workflow delivered in alpha-0.1.18

First insertion now anchors automatically and supplies a Part-origin connector;
individual mate commands work on first use. Components expose position/rotation,
name, visibility, grounding and source-Part editing through real controls. Five
new browser workflows and all ten existing Assembly regressions pass, including
shared Part edits, history, exact poses and save/reopen. See STATUS for installed
hashes and qualification. This closes the demonstrated everyday blockers, not
nested assemblies, external associativity or the remaining advanced solver scope.

## Reference and starting evidence

The current supplied reference is SolidCraft **0.23.0**, verified in
`reference/solidcraft-main/Cargo.toml` on 2026-10-25. The older 0.16.2 ZIP,
archived bridge/source bundle and extracted scratch copy were removed at
Jonathan's request. Use the current reference folder for new comparisons.
Its command contracts and tests are reference evidence, not instructions for
this repository. No SolidCraft implementation is copied in this work.
The initial Tool_Parity_Tracker.md audit recorded 398 commands: 211 parity, 87 partial,
35 parity-ish, 7 unverified, 3 gaps, 2 ours+ and 53 outside CAD. Those labels are
historical assessments against 0.16.2, not a passing acceptance suite or a
completed comparison against 0.23.0. Each closure needs a
real executable workflow and honest remaining limits.

The last qualified core-loop build is r66: a datum offset, mouse-drawn overlapping
profiles, exact region selection, extrusion, face sketch/cut/add, upstream depth
edit and save/reopen. The existing audit is in Studio's
`dev/docs/reality/CAD_Functional_Audit_2026-10-23.md`. Independent app releases now
use alpha-0.1.N and do not restart Studio. No app release is implied by a source
commit; Map and other apps must remain unchanged.

## Completion gates

| Area | Required operator workflow | Current state / next work |
| --- | --- | --- |
| Sketch and model | Place/redefine a sketch, draw/edit dimensions and constraints, select exact regions, extrude/add/cut, revolve/sweep/loft, edge finishes, Boolean, edit earlier features, undo/redo, save/reopen | r66 core mouse loop passed. Model-to-sketch copies on arbitrary planes now pass UI/live/saved tests; persistent model-source links remain. Existing sketch projections now retain signed clearance through source crossings, with mixed-sketch UI/live/saved dimension editing, authored-region extrusion and save/reopen verified. Close remaining tool variants and attachment failures with exact-geometry and operator checks. |
| Agent modeling | Discover contracts and live IDs, create/edit the same documents and regions as the UI, inspect exact results, atomically reject failed/stale edits, replay a saved program | General feature operations exist. Source verified 2026-10-24: shared region picks, explicit sketch frames, exact cut/add/revolve, driving edits and saved-runner reopen. Convenience live-face/datum binding and remaining authoring breadth still need work. |
| Assemblies | Reuse parts, place/ground instances, create/edit/delete supported mates and relations, change DOFs/limits, solve without overwriting intent, BOM, save/reopen; same actions for agents | Eight mate kinds are packaged. Explicit-ID live-agent editing now covers instances, connectors, mates, DOFs/limits and linear relations with atomic solve/revision guards and actual MCP/save/reopen qualification. CAD-owned portable operations and the pinned codec now enable contact editing and guarded exact pose checks, including real MCP/save/reopen qualification. The renderer now honors editable joint values, combined ball XYZ rotations, pin-slot motion and signed relation offsets. Canonical grounding at either endpoint and relation dependency order are corrected in codec21; saved nonzero-pose comparisons cover all eight types. Shared bounded UI/agent history and free-coordinate UI editing now have source coverage; browser qualification is recorded in STATUS. Compound UI operations now commit as one undoable action. Contact list/edit/suppression/removal now pass real UI and saved-reopen checks, with visible atomic overlap refusal. General closed-loop mate graphs, cam/sweep joints and nested editing remain. |
| Drawings | Create a sheet from a real part/assembly, base/projected/section views, associative dimensions/annotations, source-change rebuild, export and reopen | Source now connects real part projections, local saved drawing authoring, base/projected views, overall dimensions, notes, source refresh, undo/redo and SVG/DXF export. Studio autosave/recovery and source links, plus guarded open-editor AI/MCP drawing commands, pass unit, packaged-worker and authenticated browser qualification. Drawing create/rename/copy/read-only reopen are verified too. Principal planar cutaway sections now use exact OCCT cut solids and hole-clipped hatching; qualification is recorded in STATUS. Assembly drawings, stepped cuts/cutting-line annotations, edge-attached dimensions and closed-file MCP operations remain. Vector PDF for active/all sheets is implemented; qualification is recorded in STATUS. |
| Reference tool coverage | Review every remaining relevant tracker row against SolidCraft's input contract and tests; distinguish supported subsets from full parity | Surface Match, advanced sweep/loft/fillet and sheet-metal cases remain. An enabled ribbon item alone does not close a row. |
| Maintainability | Key features own focused modules and related tests; entry points compose them; UI/agents share validated operations | Drawing and model-projection layers are separated; sketch commands now use one editing-availability catalog. The older part evaluator is being split into typed feature modules, beginning with edge finishes, Booleans and patterns. Remaining large branches still need extraction; see ARCHITECTURE.md. |
| Delivery | Qualified frontend and matching compatible worker, immutable app-only activation, final live smoke check | Repository contracts and Studio's independent update path are ready; no server/Map changes required for compatible CAD packages. |

Drawings require a separate Aether acceptance target. SolidCraft's supplied
`docs/drawing-foundations.md` explicitly says its merged foundation does not
produce sections, register drawing.view, export drawings or save a Drawing
document. Matching that foundation would not satisfy Jonathan's request for
working drawings. The target above remains required.

## Work sequence

1. Close demonstrated modeling/agent inconsistencies and keep the r66 mouse loop
   green. Test regions and sketch frames through both the UI operation and the
   saved agent runner; preserve feature, contour and body identities.
2. Connect the existing drawing projection/rendering foundation to actual OCCT
   output and canonical saved state, then add authoring, annotations and exports.
3. Complete assembly authoring and agent editing through the existing canonical
   controller and pinned codec; add the remaining relation types deliberately.
4. Work the remaining reference matrix with real geometry fixtures and pick
   coverage, including invalid/ambiguous topology and upstream edits.
5. Qualify and stage CAD-only alpha updates. Record delivered versus source-only
   capability; do not claim full parity before all applicable gates pass.

## Evidence discipline

Use deterministic analytic volume/bounds checks, reference identity/replay tests,
real mouse workflows and fresh-process saved-runner tests. Refusal is acceptable
only for explicitly unsupported or invalid input, and must leave the original
state/history unchanged. Rendering alone is not geometry verification. Source
and release IDs, failing attempts and remaining limits belong in the reality
status and each qualification record.

## Verified increments

2026-10-24: the first source increment unifies UI/agent region references, removes
display-tessellation errors from curved-edge picking, and adds explicit agent
sketch frames. The mouse loop and exact saved-model measurements pass. See
`../reality/STATUS.md` for test evidence and release state. The drawing producer and saved authoring workflow now have an initial implementation using the existing presentation components and OCCT geometry; see the source reality status for the supported subset and remaining gates.
